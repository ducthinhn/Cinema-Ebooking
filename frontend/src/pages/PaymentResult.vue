<!-- src/pages/PaymentResult.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { paymentApi } from '@/api/payment.api'
import { bookingApi } from '@/api/booking.api'
import { useAuthStore } from '@/stores/auth.store'
import BaseButton from '@/components/ui/button/BaseButton.vue'
import BaseIcon from '@/components/ui/icon/BaseIcon.vue'
import { CheckCircle, XCircle } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const status = ref<'loading' | 'success' | 'failed' | 'cancel'>('loading')
const errorMessage = ref('')
const bookingId = ref<number | null>(null)
const showtimeId = ref<number | null>(null)
const isRetrying = ref(false)

onMounted(async () => {
    const queryStatus = route.query.status as string
    const queryPaymentCode = route.query.paymentCode as string
    const queryBookingId = route.query.bookingId as string
    const queryShowtimeId = route.query.showtimeId as string

    if (!queryPaymentCode) {
        status.value = 'failed'
        errorMessage.value = 'Không tìm thấy mã thanh toán.'
        return
    }

    bookingId.value = queryBookingId ? parseInt(queryBookingId) : null
    showtimeId.value = queryShowtimeId ? parseInt(queryShowtimeId) : null

    if (queryStatus === 'success') {
        status.value = 'success'
        // Xoá các flags đã lưu
        sessionStorage.removeItem('returned_from_payment')
        sessionStorage.removeItem('failed_payment_showtimeId')
        auth.refreshLoyaltyAccount()
    } else if (queryStatus === 'cancel') {
        status.value = 'cancel'
        errorMessage.value = 'Bạn đã huỷ giao dịch thanh toán.'
        // Không huỷ booking ngay – để người dùng có thể thử lại
    } else {
        status.value = 'failed'
        errorMessage.value = 'Giao dịch không thành công. Vui lòng thử lại.'
        // Không huỷ booking ngay
    }
})

// Thanh toán lại với booking hiện tại
async function retryPayment() {
    if (!bookingId.value) {
        errorMessage.value = 'Không tìm thấy mã đơn hàng. Vui lòng chọn lại ghế.'
        return
    }

    isRetrying.value = true
    try {
        // Lấy phương thức thanh toán đã dùng (nếu lưu được) hoặc mặc định MoMo
        let method = 'MOMO'
        const savedMethod = sessionStorage.getItem('last_payment_method')
        if (savedMethod && ['MOMO', 'VNPAY', 'ZALOPAY'].includes(savedMethod)) {
            method = savedMethod
        }

        const paymentRes = await paymentApi.create({
            bookingId: bookingId.value,
            method: method,
            callbackUrl: `${window.location.origin}/payment/result`,
        })

        if (!paymentRes.paymentUrl) {
            throw new Error('Không tạo được link thanh toán')
        }

        // Lưu flag để khi quay lại biết là đang thử lại
        sessionStorage.setItem('returned_from_payment', 'true')
        sessionStorage.setItem('failed_payment_showtimeId', String(showtimeId.value))
        window.location.href = paymentRes.paymentUrl
    } catch (err: any) {
        errorMessage.value = err?.message || 'Không thể tạo lại thanh toán. Vui lòng thử lại sau.'
        // Nếu thất bại, có thể booking đã hết hạn – đề xuất chọn ghế mới
    } finally {
        isRetrying.value = false
    }
}

// Huỷ booking cũ và chọn ghế mới
async function cancelAndReselect() {
    if (bookingId.value) {
        try {
            await bookingApi.cancel(bookingId.value)
            console.log(`Đã huỷ booking ${bookingId.value}`)
        } catch (err) {
            console.error('Lỗi khi huỷ booking:', err)
        }
    }
    const targetShowtimeId = showtimeId.value || sessionStorage.getItem('failed_payment_showtimeId')
    if (targetShowtimeId) {
        router.push(`/bookings?showtimeId=${targetShowtimeId}`)
    } else {
        router.push('/bookings')
    }
    sessionStorage.removeItem('failed_payment_showtimeId')
    sessionStorage.removeItem('returned_from_payment')
}

function goHome() {
    router.push('/')
}

function viewBookings() {
    router.push('/my-bookings')
}
</script>

<template>
    <div class="min-h-screen bg-bg-base flex items-center justify-center px-4 py-12">
        <div class="max-w-md w-full bg-bg-surface border border-border-default rounded-2xl shadow-xl p-8 text-center">
            <!-- Loading -->
            <div v-if="status === 'loading'" class="flex flex-col items-center gap-4">
                <div class="animate-spin h-12 w-12 border-4 border-accent border-t-transparent rounded-full"></div>
                <p class="text-text-secondary">Đang xác nhận thanh toán...</p>
            </div>

            <!-- Success -->
            <div v-else-if="status === 'success'" class="flex flex-col items-center gap-4">
                <BaseIcon :icon="CheckCircle" :size="64" class="text-green-500" />
                <h2 class="text-title text-text-primary">Thanh toán thành công!</h2>
                <p class="text-text-secondary">Cảm ơn bạn đã đặt vé. Mã đặt vé của bạn đã được ghi nhận.</p>
                <div class="flex flex-col sm:flex-row gap-3 mt-4 w-full">
                    <BaseButton variant="primary" size="lg" class="flex-1" @click="viewBookings">Xem vé của tôi
                    </BaseButton>
                    <BaseButton variant="secondary" size="lg" class="flex-1" @click="goHome">Về trang chủ</BaseButton>
                </div>
            </div>

            <!-- Cancel (chủ động huỷ từ gateway) -->
            <div v-else-if="status === 'cancel'" class="flex flex-col items-center gap-4">
                <BaseIcon :icon="XCircle" :size="64" class="text-orange-500" />
                <h2 class="text-title text-text-primary">Huỷ thanh toán</h2>
                <p class="text-text-secondary">{{ errorMessage }}</p>
                <div class="flex flex-col sm:flex-row gap-3 mt-4 w-full">
                    <BaseButton variant="primary" size="lg" class="flex-1" @click="retryPayment" :disabled="isRetrying">
                        {{ isRetrying ? 'Đang xử lý...' : 'Thanh toán lại' }}
                    </BaseButton>
                    <BaseButton variant="secondary" size="lg" class="flex-1" @click="cancelAndReselect">
                        Chọn ghế khác
                    </BaseButton>
                </div>
                <p class="text-caption text-text-tertiary mt-2">Bạn vẫn có thể thanh toán lại đơn hàng này nếu chưa hết
                    hạn.</p>
            </div>

            <!-- Failed -->
            <div v-else class="flex flex-col items-center gap-4">
                <BaseIcon :icon="XCircle" :size="64" class="text-error" />
                <h2 class="text-title text-text-primary">Thanh toán thất bại</h2>
                <p class="text-text-secondary">{{ errorMessage || 'Giao dịch không thành công. Vui lòng thử lại.' }}</p>
                <div class="flex flex-col sm:flex-row gap-3 mt-4 w-full">
                    <BaseButton variant="primary" size="lg" class="flex-1" @click="retryPayment" :disabled="isRetrying">
                        {{ isRetrying ? 'Đang xử lý...' : 'Thanh toán lại' }}
                    </BaseButton>
                    <BaseButton variant="secondary" size="lg" class="flex-1" @click="cancelAndReselect">
                        Chọn ghế khác
                    </BaseButton>
                </div>
                <p class="text-caption text-text-tertiary mt-2">
                    Nếu thanh toán lại không thành công, vui lòng chọn ghế khác.
                </p>
            </div>
        </div>
    </div>
</template>