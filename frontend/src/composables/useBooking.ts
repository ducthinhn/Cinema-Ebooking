import { ref, computed } from 'vue'
import { bookingApi } from '@/api/booking.api'
import type { CreateBookingRequest } from '@/api/booking.api'
import type { MovieResponse } from '@/types/movie.types'
import type { CinemaResponse } from '@/cinema/types/cinema'
import type { ShowtimeResponse } from '@/types/showtime'
import type { ShowtimeSeatResponse } from '@/types/showtime-seat'
import type {
  BookingComboInfo,
  BookingCouponInfo,
  BookingDetailResponse,
} from '@/types/booking.types'

export type BookingState = ReturnType<typeof useBooking>

export function useBooking() {
  // ── Step navigation ───────────────────────────────────────────────────────
  const currentStep = ref(1)

  function goToStep(step: number) {
    if (step < currentStep.value) {
      if (step < 5) appliedCoupon.value = null
      if (step < 4) selectedCombos.value = []
      if (step < 3) selectedSeats.value = []
      if (step < 2) {
        selectedShowtime.value = null
        selectedMovie.value = null
      }
    }
    currentStep.value = step
  }

  // ── Selection state ───────────────────────────────────────────────────────
  const selectedMovie = ref<MovieResponse | null>(null)
  const selectedCinema = ref<CinemaResponse | null>(null)
  const selectedShowtime = ref<ShowtimeResponse | null>(null)
  const selectedSeats = ref<ShowtimeSeatResponse[]>([])
  const selectedCombos = ref<BookingComboInfo[]>([])
  const appliedCoupon = ref<BookingCouponInfo | null>(null)

  // ── Computed totals ───────────────────────────────────────────────────────
  const seatTotal = computed(() => selectedSeats.value.reduce((s, x) => s + x.price, 0))
  const comboTotal = computed(() => selectedCombos.value.reduce((s, x) => s + x.totalPrice, 0))
  const subtotal = computed(() => seatTotal.value + comboTotal.value)

  /**
   * ‘discount’ là số tiền giảm thực tế đã tính toán:
   * - PERCENT: subtotal × (couponValue / 100), cap bởi maximumDiscountAmount
   * - FIXED: couponValue cố định (không vượt quá subtotal)
   */
  const discount = computed(() => {
    const coupon = appliedCoupon.value
    if (!coupon) return 0
    if (coupon.couponType === 'PERCENT') {
      const raw = subtotal.value * (coupon.couponValue / 100)
      const max = coupon.maximumDiscountAmount ?? Infinity
      return Math.min(raw, max)
    }
    // FIXED
    return Math.min(coupon.couponValue, subtotal.value)
  })

  const grandTotal = computed(() => Math.max(0, subtotal.value - discount.value))

  const allSeatIds = computed(() => selectedSeats.value.map(s => s.id))

  // ── Create booking ────────────────────────────────────────────────────────
  const creating = ref(false)
  const createError = ref('')
  const createdBooking = ref<BookingDetailResponse | null>(null)

  async function createBooking(userId: number): Promise<BookingDetailResponse | null> {
    if (!selectedShowtime.value || !selectedSeats.value.length) return null

    creating.value = true
    createError.value = ''

    const payload: CreateBookingRequest = {
      userId,
      showtimeId: selectedShowtime.value.id,
      showTimeSeatIds: allSeatIds.value,
      couponCode: appliedCoupon.value?.code ?? null,
      combos: selectedCombos.value.map(c => ({
        comboId: c.comboId,
        quantity: c.quantity,
      })),
    }

    try {
      const result = await bookingApi.create(payload)
      createdBooking.value = result
      return result
    } catch (err: any) {
      createError.value = err?.message ?? 'Đặt vé thất bại. Vui lòng thử lại.'
      return null
    } finally {
      creating.value = false
    }
  }

  // ── Reset ────────────────────────────────────────────────────────────────
  function reset() {
    currentStep.value = 1
    selectedMovie.value = null
    selectedCinema.value = null
    selectedShowtime.value = null
    selectedSeats.value = []
    selectedCombos.value = []
    appliedCoupon.value = null
    createdBooking.value = null
    createError.value = ''
  }

  return {
    currentStep,
    goToStep,

    selectedMovie,
    selectedCinema,
    selectedShowtime,
    selectedSeats,
    selectedCombos,
    appliedCoupon,

    seatTotal,
    comboTotal,
    discount,
    grandTotal,

    creating,
    createError,
    createdBooking,
    createBooking,
    reset,
  }
}