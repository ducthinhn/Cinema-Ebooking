// src/composables/booking/useSeatPolling.ts
import { ref, watch, onUnmounted } from 'vue'
import { showtimeApi } from '@/api/showtime.api'
import type { ShowtimeSeatLayoutResponse } from '@/types/showtime-seat'

const POLL_INTERVAL_MS = 20_000   

export function useSeatPolling(
  booking: any,
  rawLayout: Ref<ShowtimeSeatLayoutResponse | null>,
) {
  const isPolling = ref(false)
  let timerId: ReturnType<typeof setInterval> | null = null
  let destroyed = false

    async function poll() {
        const showtimeId = booking.selectedShowtime.value?.id
        if (!showtimeId) return
        if (document.hidden) return

      try {
        isPolling.value = true
        const fresh = await showtimeApi.getSeatMap(showtimeId)
        if (destroyed) return  // ← check lại sau await vì async
        rawLayout.value = fresh
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[Polling] error', err)
      } finally {
        if (!destroyed) isPolling.value = false
      }
    }

  function startPolling() {
    if (destroyed) return
    stopPolling()
    timerId = setInterval(poll, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (timerId) { clearInterval(timerId); timerId = null }
  }

  // Start khi có showtime, stop khi đổi showtime hoặc null
  watch(
    () => booking.selectedShowtime.value?.id,
    (id) => { id ? startPolling() : stopPolling() },
    { immediate: true }
  )

  // Pause khi tab bị ẩn (tiết kiệm request)
  const handleVisibility = () => {
    if (destroyed) return  // ← listener còn đó nhưng không làm gì
    document.hidden ? stopPolling() : startPolling()
  }
  document.addEventListener('visibilitychange', handleVisibility)

  onUnmounted(() => {
    destroyed = true
    stopPolling()
    document.removeEventListener('visibilitychange', handleVisibility)
  })

  return { isPolling }
}