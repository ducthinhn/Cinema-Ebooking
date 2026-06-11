<template>
  <div class="flex flex-col gap-6 py-6">
    <div class="flex flex-col gap-4 pr-6">
      <div class="flex items-center text-sm">
        <span class="font-medium text-text-admin-primary">Operations</span>
        <span class="mx-2 text-text-admin-tertiary">/</span>
        <span class="text-text-admin-tertiary">Check-in</span>
      </div>
      <div>
        <h1 class="text-lg font-semibold text-text-admin-primary">Check-in vé</h1>
        <p class="text-sm text-text-admin-tertiary">
          Quét mã QR hoặc nhập mã booking để check-in khách hàng
        </p>
      </div>
    </div>

    <div class="grid gap-6 pr-6 lg:grid-cols-2">
      <div class="flex flex-col gap-4">
        <div class="rounded-xl border border-slate-200 bg-white p-6">
          <h2 class="mb-4 text-sm font-semibold text-slate-800">Quét mã QR</h2>

          <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-slate-100">
            <video
              v-if="isCameraActive"
              ref="videoRef"
              class="h-full w-full object-cover"
              autoplay
              playsinline
              muted
            />
            <canvas v-if="isCameraActive" ref="canvasRef" class="hidden" />

            <div v-if="isCameraActive" class="pointer-events-none absolute inset-0">
              <div class="absolute inset-0 bg-black/40" />
              <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div class="h-48 w-48 rounded-2xl border-2 border-white/80 shadow-2xl">
                  <div
                    class="absolute -left-1 -top-1 h-6 w-6 border-l-4 border-t-4 border-accent rounded-tl-xl"
                  />
                  <div
                    class="absolute -right-1 -top-1 h-6 w-6 border-r-4 border-t-4 border-accent rounded-tr-xl"
                  />
                  <div
                    class="absolute -bottom-1 -left-1 h-6 w-6 border-b-4 border-l-4 border-accent rounded-bl-xl"
                  />
                  <div
                    class="absolute -bottom-1 -right-1 h-6 w-6 border-b-4 border-r-4 border-accent rounded-br-xl"
                  />
                </div>
              </div>
            </div>

            <div
              v-if="!isCameraActive"
              class="flex h-full flex-col items-center justify-center gap-4"
            >
              <Camera class="size-16 text-slate-300" />
              <p class="text-sm text-slate-400">Bật camera để quét mã QR</p>
            </div>
          </div>

          <div class="mt-4 flex gap-3">
            <button
              v-if="!isCameraActive"
              class="flex-1 rounded-lg bg-accent py-2.5 text-sm font-medium text-text-on-accent transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              @click="startCamera"
            >
              Bật camera
            </button>
            <button
              v-else
              class="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              @click="stopCamera"
            >
              Tắt camera
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-6">
          <h2 class="mb-4 text-sm font-semibold text-slate-800">Hoặc nhập mã booking</h2>
          <div class="flex gap-3">
            <input
              v-model="manualCode"
              type="text"
              placeholder="Nhập mã booking, ví dụ: BK-ABC123"
              class="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-slate-100"
              @keyup.enter="lookupManual"
            />
            <button
              class="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-text-on-accent transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="!manualCode.trim() || isLoading"
              @click="lookupManual"
            >
              <Search class="size-4" />
            </button>
          </div>
        </div>

        <div
          v-if="cameraError"
          class="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600"
        >
          {{ cameraError }}
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <div
          v-if="!booking && !isLoading"
          class="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center"
        >
          <QrCode class="size-16 text-slate-200" />
          <p class="mt-4 text-sm font-medium text-slate-400">Chưa có thông tin booking</p>
          <p class="mt-1 text-xs text-slate-300">Quét QR hoặc nhập mã để tra cứu</p>
        </div>

        <div
          v-if="isLoading"
          class="flex flex-1 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-12"
        >
          <Loader2 class="size-10 animate-spin text-accent" />
          <p class="mt-3 text-sm text-slate-400">Đang tra cứu...</p>
        </div>

        <div v-if="booking && !isLoading" class="rounded-xl border border-slate-200 bg-white p-6">
          <div class="mb-4 flex items-start justify-between">
            <div>
              <h2 class="text-sm font-semibold text-slate-800">Thông tin booking</h2>
              <p class="mt-0.5 font-mono text-xs text-slate-400">{{ booking.bookingCode }}</p>
            </div>
            <span
              class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
              :class="bookingStatusClass(booking.status)"
            >
              {{ bookingStatusLabel(booking.status) }}
            </span>
          </div>

          <div class="space-y-3 text-sm">
            <InfoRow label="Phim" :value="booking.movieTitle" />
            <InfoRow label="Rạp" :value="booking.cinemaName" />
            <InfoRow label="Phòng" :value="booking.roomName" />
            <InfoRow label="Suất chiếu" :value="formatDateTime(booking.showtimeStartTime)" />
            <InfoRow label="Ngày đặt" :value="formatDateTime(booking.createdAt)" />
            <InfoRow label="Tổng tiền" :value="formatCurrency(booking.finalAmount)" />
          </div>

          <div class="mt-4 rounded-lg bg-slate-50 p-4">
            <p class="mb-2 text-xs font-medium text-slate-500">
              Ghế đã đặt ({{ booking.seats?.length ?? 0 }})
            </p>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="seat in booking.seats"
                :key="seat.showtimeSeatId"
                class="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm"
              >
                {{ seat.seatName }}
                <span class="text-slate-400">({{ seat.seatType }})</span>
              </span>
            </div>
          </div>

          <div v-if="booking.combos?.length" class="mt-3 rounded-lg bg-slate-50 p-4">
            <p class="mb-2 text-xs font-medium text-slate-500">
              Combo ({{ booking.combos?.length }})
            </p>
            <div class="space-y-1 text-xs text-slate-600">
              <div
                v-for="combo in booking.combos"
                :key="combo.comboId"
                class="flex justify-between"
              >
                <span>{{ combo.comboName }} x{{ combo.quantity }}</span>
                <span class="font-medium">{{ formatCurrency(combo.totalPrice) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="error"
          class="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-600"
        >
          {{ error }}
        </div>

        <div v-if="booking && !isLoading && checkInResults.length > 0">
          <div
            class="flex items-center justify-center gap-3 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm font-medium text-emerald-700"
          >
            <CheckCircle2 class="size-5 shrink-0" />
            <span>Check-in thành công!</span>
          </div>
        </div>

        <div v-else-if="booking && !isLoading">
          <button
            v-if="booking.status === 'CONFIRMED'"
            class="w-full rounded-lg bg-emerald-500 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="isCheckingIn"
            @click="confirmCheckIn"
          >
            <span v-if="isCheckingIn" class="flex items-center justify-center gap-2">
              <Loader2 class="size-4 animate-spin" />
              Đang check-in...
            </span>
            <span v-else class="flex items-center justify-center gap-2">
              <CheckCircle2 class="size-4" />
              Xác nhận check-in
            </span>
          </button>

          <div v-else class="rounded-lg bg-slate-50 p-3 text-center text-sm text-slate-400">
            {{
              booking.status === 'PENDING'
                ? 'Booking chưa thanh toán, không thể check-in'
                : 'Booking đã bị hủy'
            }}
          </div>
        </div>

        <div v-if="checkInResults.length" class="rounded-xl border border-slate-200 bg-white p-6">
          <div class="mb-4 flex items-center gap-2">
            <h2 class="text-sm font-semibold text-slate-800">Kết quả check-in</h2>
            <span
              class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
            >
              {{ resultsSummary.successCount }}/{{ resultsSummary.total }} thành công
            </span>
          </div>

          <div class="space-y-2">
            <div
              v-for="ticket in checkInResults"
              :key="ticket.ticketId"
              class="flex items-center justify-between rounded-lg border px-4 py-3"
              :class="
                ticket.success ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
              "
            >
              <div class="flex items-center gap-3">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full"
                  :class="ticket.success ? 'bg-emerald-100' : 'bg-red-100'"
                >
                  <CheckCircle2 v-if="ticket.success" class="size-4 text-emerald-600" />
                  <XCircle v-else class="size-4 text-red-600" />
                </div>
                <div>
                  <p class="text-sm font-medium text-slate-800">{{ ticket.seatName }}</p>
                  <p class="text-xs text-slate-400">{{ ticket.seatType }}</p>
                </div>
              </div>
              <div class="text-right">
                <p
                  class="text-sm font-medium"
                  :class="ticket.success ? 'text-emerald-700' : 'text-red-700'"
                >
                  {{ ticket.success ? 'Thành công' : 'Thất bại' }}
                </p>
                <p class="text-xs text-slate-400">{{ ticket.message }}</p>
              </div>
            </div>
          </div>

          <button
            class="mt-4 w-full rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            @click="resetScan"
          >
            Check-in booking khác
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// ĐÃ SỬA: Import thêm nextTick để kiểm soát luồng hiển thị video DOM tốt hơn
import { defineComponent, h, onUnmounted, ref, computed, nextTick } from 'vue'
import { Camera, CheckCircle2, Loader2, QrCode, Search, XCircle } from 'lucide-vue-next'
import jsQR from 'jsqr'
import { checkinApi, type BatchCheckInResponse, type TicketCheckInResult } from '@/api/checkin.api'
import type { BookingDetailResponse } from '@/types/booking.types'

// ── Refs ──────────────────────────────────────────────────────────────────────
const videoRef = ref<HTMLVideoElement>()
const canvasRef = ref<HTMLCanvasElement>()
const manualCode = ref('')
const booking = ref<BookingDetailResponse | null>(null)
const checkInResults = ref<TicketCheckInResult[]>([])
const isLoading = ref(false)
const isCheckingIn = ref(false)
const isCameraActive = ref(false)
const error = ref('')
const cameraError = ref('')
let stream: MediaStream | null = null
let scanFrameId: number | null = null

// ── Camera / QR ───────────────────────────────────────────────────────────────
async function startCamera() {
  try {
    cameraError.value = ''
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    })

    // ĐÃ SỬA: Bật camera state trước để tạo thẻ <video>
    isCameraActive.value = true

    // ĐÃ SỬA: Chờ DOM cập nhật xong rồi mới gán stream dữ liệu vào thẻ video
    await nextTick()

    if (videoRef.value) {
      videoRef.value.srcObject = stream
      // Chạy play() chủ động để đảm bảo hình ảnh không bị đơ
      videoRef.value.play().catch((err) => console.error('Lỗi phát video:', err))

      videoRef.value.addEventListener('loadedmetadata', () => {
        requestAnimationFrame(scanQR)
      })
    }
  } catch (e) {
    cameraError.value = 'Không thể bật camera. Vui lòng cấp quyền hoặc nhập mã thủ công.'
    isCameraActive.value = false
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  if (scanFrameId !== null) {
    cancelAnimationFrame(scanFrameId)
    scanFrameId = null
  }
  isCameraActive.value = false
}

function scanQR() {
  if (!isCameraActive.value || !videoRef.value || !canvasRef.value) return

  const video = videoRef.value
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (video.readyState < video.HAVE_ENOUGH_DATA) {
    scanFrameId = requestAnimationFrame(scanQR)
    return
  }
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  })

  if (code) {
    stopCamera()
    handleScannedCode(code.data)
    return
  }

  scanFrameId = requestAnimationFrame(scanQR)
}

// ── Lookup ─────────────────────────────────────────────────────────────────────
async function lookupByCode(code: string) {
  if (!code.trim()) return
  error.value = ''
  checkInResults.value = []
  isLoading.value = true
  try {
    booking.value = await checkinApi.lookup(code.trim())
  } catch (e: any) {
    booking.value = null
    error.value = e?.response?.data?.message || 'Không tìm thấy booking với mã này'
  } finally {
    isLoading.value = false
  }
}

function lookupManual() {
  lookupByCode(manualCode.value)
}

function handleScannedCode(code: string) {
  manualCode.value = code
  lookupByCode(code)
}

// ── Check-in ──────────────────────────────────────────────────────────────────
async function confirmCheckIn() {
  if (!booking.value) return
  isCheckingIn.value = true
  error.value = ''
  try {
    const res: BatchCheckInResponse = await checkinApi.checkIn(booking.value.bookingCode)
    checkInResults.value = res.tickets
  } catch (e: any) {
    error.value = e?.response?.data?.message || 'Check-in thất bại'
  } finally {
    isCheckingIn.value = false
  }
}

function resetScan() {
  booking.value = null
  checkInResults.value = []
  manualCode.value = ''
  error.value = ''
}

// ── Computed ──────────────────────────────────────────────────────────────────
const resultsSummary = computed(() => {
  const total = checkInResults.value.length
  const successCount = checkInResults.value.filter((t) => t.success).length
  return { total, successCount }
})

// ── Formatters ────────────────────────────────────────────────────────────────
function formatCurrency(value?: number | string | null) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0)) + ' đ'
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('vi-VN')
}

function bookingStatusLabel(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Chờ thanh toán'
    case 'CONFIRMED':
      return 'Đã thanh toán'
    case 'CANCELLED':
      return 'Đã hủy'
    default:
      return status
  }
}

function bookingStatusClass(status: string) {
  switch (status) {
    case 'PENDING':
      return 'bg-yellow-100 text-yellow-800'
    case 'CONFIRMED':
      return 'bg-emerald-100 text-emerald-800'
    case 'CANCELLED':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

// ── InfoRow component ─────────────────────────────────────────────────────────
const InfoRow = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: String, default: '—' },
  },
  setup(props) {
    return () =>
      h('div', { class: 'flex justify-between gap-4' }, [
        h('span', { class: 'text-slate-400 text-xs' }, props.label),
        h('span', { class: 'text-right text-slate-700 text-xs font-medium' }, props.value || '—'),
      ])
  },
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onUnmounted(() => {
  stopCamera()
})
</script>
