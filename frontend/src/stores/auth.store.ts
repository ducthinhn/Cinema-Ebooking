import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserProfile } from '@/types/auth.types'
import type { LoyaltyAccountSummaryResponse } from '@/types/loyalty.types'
import { apiClient } from '@/api/axios'
import { userApi } from '@/api/user.api'
import { loyaltyApi } from '@/api/loyalty.api'

export const useAuthStore = defineStore('auth', () => {

    const user = ref<UserProfile | null>(null)

    const accessToken = ref<string | null>(localStorage.getItem('accessToken'))
    const refreshToken = ref<string | null>(localStorage.getItem('refreshToken'))

    const loyaltyAccount = ref<LoyaltyAccountSummaryResponse | null>(null)

    const setAuth = (userProfile: UserProfile, access: string, refresh: string) => {
        user.value = userProfile
        accessToken.value = access
        refreshToken.value = refresh
        localStorage.setItem('accessToken', access)
        localStorage.setItem('refreshToken', refresh)
        window.dispatchEvent(new CustomEvent('auth:login', { detail: { accessToken: access } }))
    }

    const setLoyaltyAccount = (loyalty: LoyaltyAccountSummaryResponse | null) => {
        loyaltyAccount.value = loyalty;
    };

    const logout = async () => {
        try {
        const refresh = localStorage.getItem('refreshToken')
        if (refresh) {
            // Fire-and-forget — không await, không để lỗi API block việc clear state
            apiClient.post('/auth/logout', { refreshToken: refresh }).catch(() => {})
        }
        } finally {
        clearLocalState()
        }
    }

    const isLoggedIn = computed(() => !!accessToken.value)
    const isAdmin = computed(() => user.value?.role === 'ADMIN')
    const isActive = computed(() => user.value?.status === 'ACTIVE')

    const updateUserProfile = (updatedData: Partial<UserProfile>) => {
        if (user.value) {
            user.value = { ...user.value, ...updatedData }
        }
    }

    const updateLoyalty = (updatedData: Partial<LoyaltyAccountSummaryResponse>) => {
        if (loyaltyAccount.value) {
            loyaltyAccount.value = { ...loyaltyAccount.value, ...updatedData }
        } else if (updatedData) {
            // Trường hợp chưa có loyalty (lần đầu)
            loyaltyAccount.value = updatedData as LoyaltyAccountSummaryResponse
        }
    }

    const refreshUserProfile = async () => {
        try {
            const response = await userApi.getMe(accessToken.value)
            user.value = response
        } catch (error) {
            console.error('Refresh profile failed', error)
        }
    }

    const refreshLoyaltyAccount = async () => {
        try {
            const res = await loyaltyApi.getMySummary()
            loyaltyAccount.value = res
        } catch (error) {
            console.log('refresh loyalty failed', error)
        }
    }

    const fetchMe = async () => {
        try {
        const response = await userApi.getMe(accessToken.value)
        user.value = response
        } catch {
        // Nếu fetchMe fail (token vừa được refresh nhưng user không tồn tại), clear state
        clearLocalState()
        }
    }

    const setTokens = (access: string, refresh: string) => {
        accessToken.value = access
        refreshToken.value = refresh
        localStorage.setItem('accessToken', access)
        localStorage.setItem('refreshToken', refresh)
    }

    const _clearStateOnly = () => {
        user.value = null
        accessToken.value = null
        refreshToken.value = null
        loyaltyAccount.value = null
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        delete apiClient.defaults.headers.common.Authorization
    }

    const clearLocalState = () => {
        _clearStateOnly()
        window.dispatchEvent(new CustomEvent('auth:logout'))
    }

    return {
        user,
        accessToken,
        refreshToken,
        loyaltyAccount,
        setAuth,
        setLoyaltyAccount,
        setTokens,
        logout,
        isLoggedIn,
        isAdmin,
        isActive,
        updateUserProfile,
        updateLoyalty,
        refreshUserProfile,
        refreshLoyaltyAccount,
        fetchMe,
        _clearStateOnly, clearLocalState,
    }
},{
    persist: {
        key: 'auth',
        paths: ['user', 'loyaltyAccount'],   // chỉ persist user, token đã tự lưu localStorage thủ công
    }
})