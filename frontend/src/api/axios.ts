import axios, { AxiosError } from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import type { LoginResponse } from '@/types/auth.types'
import type { ApiResponse, ApiError } from '@/types/common.types'
import { mapFieldErrors } from '@/utils/errorMapper'


export const BASE_URL = 'http://localhost:8080/api/v1'

export const apiClient = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
})

class TokenRefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly REFRESH_BEFORE_SECONDS = 90

  /**
   * Decode JWT payload mà KHÔNG verify signature (client-side chỉ cần đọc exp)
   */
  private decodeExp(token: string): number | null {
    try {
      const payload = token.split('.')[1]
      // Base64url → Base64 → JSON
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
      return typeof json.exp === 'number' ? json.exp : null
    } catch {
      return null
    }
  }

  /**
   * Schedule proactive refresh dựa vào exp của access token hiện tại.
   * Gọi lại mỗi khi có access token mới.
   */
  schedule(accessToken: string) {
    this.cancel() // cancel cái cũ trước

    const exp = this.decodeExp(accessToken)
    if (!exp) return

    const nowSeconds = Math.floor(Date.now() / 1000)
    const secondsUntilRefresh = exp - nowSeconds - this.REFRESH_BEFORE_SECONDS

    if (secondsUntilRefresh <= 0) {
      // Token sắp hết hạn hoặc đã hết hạn — refresh ngay
      this.doRefresh()
      return
    }

    this.timer = setTimeout(() => {
      this.doRefresh()
    }, secondsUntilRefresh * 1000)
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async doRefresh() {
    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) return

    try {
      const { data } = await axios.post<ApiResponse<LoginResponse>>(
        `${BASE_URL}/auth/refresh_token`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } }
      )

      if (!data.success || !data.data?.accessToken || !data.data?.refreshToken) return

      const { accessToken: newAccess, refreshToken: newRefresh } = data.data
      localStorage.setItem('accessToken', newAccess)
      localStorage.setItem('refreshToken', newRefresh)

      // Update store user nếu cần
      try {
        const { useAuthStore } = await import('@/stores/auth.store')
        useAuthStore().setTokens(newAccess, newRefresh)
      } catch {}

      // Schedule lần tiếp theo
      this.schedule(newAccess)

      // Dispatch để các component biết token đã được refresh ngầm
      window.dispatchEvent(new CustomEvent('auth:token-refreshed', {
        detail: { accessToken: newAccess }
      }))
    } catch {
      // Proactive refresh fail — không làm gì, reactive interceptor sẽ xử lý
      // khi request tiếp theo bị 401
    }
  }
}

export const tokenRefreshScheduler = new TokenRefreshScheduler()

// Khởi động scheduler nếu đã có token trong localStorage (page reload)
const existingToken = localStorage.getItem('accessToken')
if (existingToken) {
  tokenRefreshScheduler.schedule(existingToken)
}

// Lắng nghe auth events
window.addEventListener('auth:login', (e: Event) => {
  const token = (e as CustomEvent).detail?.accessToken
  if (token) tokenRefreshScheduler.schedule(token)
})
window.addEventListener('auth:logout', () => {
  tokenRefreshScheduler.cancel()
})


const PUBLIC_ENDPOINTS = [
  '/auth/login',
  '/auth/register',
  '/auth/verify-otp',
  '/auth/resend-otp',
  '/auth/forgot_password',
  '/auth/verify-forgot-otp',
  '/auth/reset_password',
  '/auth/refresh_token'
]

const PROTECTED_GET_REGEX = [
  /^\/users\/me(\/|$)/,
  /^\/loyalty\/my-account(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/bookings\/me(\/|$)/,
    /^\/bookings\/\d+\/qr-code$/,
    /^\/bookings\/admin\/all(\/|$)/,
    /^\/refunds\/me(\/|$)/,
]

const isPublicEndpoint = (url?: string): boolean => {
  if (!url) return false
  return PUBLIC_ENDPOINTS.some(publicPath => url.includes(publicPath))
}

const isProtectedGetRequest = (config: InternalAxiosRequestConfig): boolean => {
  if (config.method?.toUpperCase() !== 'GET') return false
  const url = config.url || ''
  return PROTECTED_GET_REGEX.some(regex => regex.test(url))
}

// Helper function to check if a request is a true public GET (not protected)
const isPublicGetRequest = (config: InternalAxiosRequestConfig): boolean => {
  if (config.method?.toUpperCase() !== 'GET') return false
  const url = config.url || ''
  return !PROTECTED_GET_REGEX.some(regex => regex.test(url))
}

// ================= REQUEST =================
apiClient.interceptors.request.use((config) => {
    if (isPublicEndpoint(config.url)) {
        delete config.headers.Authorization
        return config
    }
    const token = localStorage.getItem('accessToken')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
})

// ================= RESPONSE =================


let isRefreshing = false
let failedQueue: Array<{
    resolve: (value?: any) => void
    reject: (reason?: any) => void
    config: InternalAxiosRequestConfig
}> = []

const processQueue = (error, token) => {
    failedQueue.forEach(({ resolve, reject }) => {
        error ? reject(error) : resolve(token)  // resolve với token
    })
    failedQueue = []
}

const logout = async () => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    tokenRefreshScheduler.cancel()
    try {
        const { useAuthStore } = await import('@/stores/auth.store')
        useAuthStore()._clearStateOnly()
    } catch {}
    window.dispatchEvent(new CustomEvent('auth:logout'))
}

apiClient.interceptors.response.use(
  (response) => {
    const res: ApiResponse<any> = response.data
    if (res && typeof res.success === 'boolean') {
      if (!res.success) {
        const apiError: ApiError | undefined = res.error
        const mapped = mapFieldErrors(apiError ?? null)
        return Promise.reject({
          type: 'api',
          fieldErrors: mapped.fieldErrors,
          globalErrors: mapped.globalErrors,
          code: apiError?.code ?? null,
          message: apiError?.message ?? 'Lỗi từ server',
          raw: apiError,
        })
      }
      return res.data
    }
    return response.data
  },

  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    const status = error.response?.status
    const apiError: ApiError | undefined = (error.response?.data as any)?.error
    const url = originalRequest?.url

    const rejectMapped = (type = 'http') => {
      const mapped = mapFieldErrors(apiError ?? null)
      return Promise.reject({
        type,
        fieldErrors: mapped.fieldErrors,
        globalErrors: mapped.globalErrors,
        code: apiError?.code ?? null,
        message: apiError?.message ?? 'Đã có lỗi xảy ra',
        status,
        raw: apiError,
      })
    }

    if (status !== 401) return rejectMapped('http')
    if (isPublicEndpoint(url)) return rejectMapped('api')
    if (isPublicGetRequest(originalRequest)) return rejectMapped('api')

    if (originalRequest._retry) {
      logout()
      return rejectMapped('api')
    }

    if (url?.includes('/auth/refresh_token')) {
      logout()
      return rejectMapped('api')
    }

    originalRequest._retry = true

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject, config: originalRequest })
      }).then((token) => {
        if (token) originalRequest.headers.Authorization = `Bearer ${token}`
        return apiClient(originalRequest)
      }).catch(err => Promise.reject(err))
    }

    isRefreshing = true

    const refreshTokenValue = localStorage.getItem('refreshToken')
    if (!refreshTokenValue) {
      isRefreshing = false
      logout()
      return rejectMapped('api')
    }

    try {
      const { data } = await axios.post<ApiResponse<LoginResponse>>(
        `${BASE_URL}/auth/refresh_token`,
        { refreshToken: refreshTokenValue },
        { headers: { 'Content-Type': 'application/json' } }
      )

      if (!data.success || !data.data?.accessToken || !data.data?.refreshToken) {
        throw new Error('Invalid refresh response')
      }

      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = data.data
      localStorage.setItem('accessToken', newAccessToken)
      localStorage.setItem('refreshToken', newRefreshToken)

      // Schedule proactive refresh cho token mới
      tokenRefreshScheduler.schedule(newAccessToken)

      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`

      try {
        const { useAuthStore } = await import('@/stores/auth.store')
        await useAuthStore().fetchMe()
      } catch {}

      processQueue(null, newAccessToken)
      return apiClient(originalRequest)
    } catch (refreshError) {
      processQueue(refreshError)
      logout()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  }
)

export default apiClient