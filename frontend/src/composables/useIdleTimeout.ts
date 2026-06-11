// src/composables/useIdleTimeout.ts
import { ref, onMounted, onUnmounted } from 'vue'

const IDLE_MINUTES = 14      // Bao nhiêu phút không hoạt động thì hiện modal
const WARNING_SECONDS = 60     // Đếm ngược bao nhiêu giây trước khi logout

// Các event coi là "user đang hoạt động"
const ACTIVE_EVENTS = ['click', 'keydown', 'touchstart', 'mousemove', 'scroll']

export function useIdleTimeout(onLogout: () => void) {
    const showWarning = ref(false)
    const countdown = ref(WARNING_SECONDS)

    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let countdownTimer: ReturnType<typeof setInterval> | null = null

    // ── Dừng đếm ngược ──────────────────────────────────────────
    const clearCountdown = () => {
        if (countdownTimer) {
            clearInterval(countdownTimer)
            countdownTimer = null
        }
    }

    // ── Bắt đầu đếm ngược 60s trong modal ───────────────────────
    const startCountdown = () => {
        countdown.value = WARNING_SECONDS
        countdownTimer = setInterval(() => {
            countdown.value -= 1
            if (countdown.value <= 0) {
                clearCountdown()
                showWarning.value = false
                onLogout()
            }
        }, 1000)
    }

    // ── Reset về trạng thái bình thường ─────────────────────────
    const resetTimer = () => {
        // Clear hết timer cũ
        if (idleTimer) clearTimeout(idleTimer)
        clearCountdown()

        // Ẩn modal nếu đang hiện
        showWarning.value = false

        // Bắt đầu đếm idle mới
        idleTimer = setTimeout(() => {
            showWarning.value = true
            startCountdown()
        }, IDLE_MINUTES * 60 * 1000)
    }

    // ── User click "Tiếp tục" trong modal ───────────────────────
    const stayLoggedIn = () => {
        resetTimer()
    }

    // ── Lifecycle ────────────────────────────────────────────────
    onMounted(() => {
         ACTIVE_EVENTS.forEach(e =>
            window.addEventListener(e, resetTimer, { passive: true })
        )
        resetTimer() // bắt đầu đếm ngay khi mount
    })

    onUnmounted(() => {
        ACTIVE_EVENTS.forEach(e => window.removeEventListener(e, resetTimer))
        if (idleTimer) clearTimeout(idleTimer)
        clearCountdown()
    })

    return { showWarning, countdown, stayLoggedIn }
}