<template>
    <div class="flex flex-col py-6 min-h-screen">
        <!-- Breadcrumb -->
        <div class="flex items-center gap-2 pr-6 text-sm">
            <button class="text-text-admin-tertiary transition-colors hover:text-text-admin-primary"
                @click="router.push('/admin/cinemas')">
                Cinemas
            </button>
            <ChevronRight class="size-3.5 text-text-admin-tertiary" />
            <button class="text-text-admin-tertiary transition-colors hover:text-text-admin-primary"
                @click="router.push(`/admin/cinemas/${cinemaId}/rooms`)">
                {{ cinemaName }}
            </button>
            <ChevronRight class="size-3.5 text-text-admin-tertiary" />
            <button class="text-text-admin-tertiary transition-colors hover:text-text-admin-primary"
                @click="router.push(`/admin/cinemas/${cinemaId}/rooms`)">
                Rooms
            </button>
            <ChevronRight class="size-3.5 text-text-admin-tertiary" />
            <span class="text-text-admin-primary font-medium">{{ roomName }} — Layout</span>
        </div>

        <!-- Header -->
        <div class="flex items-center justify-between pr-6 mt-6">
            <div>
                <h1 class="text-lg font-semibold text-text-admin-primary">Sơ đồ ghế</h1>
                <p v-if="layout" class="text-sm text-text-admin-tertiary items-center flex gap-2">
                    {{ layout.totalRows }} hàng × {{ layout.totalCols }} cột
                    <span class="font-medium">{{ formatRoomType(layout.roomType) }}</span>
                    <span v-if="layout.lastUsedDate" class="ml-1 inline-flex items-center gap-1 text-accent">
                        <CircleCheck class="size-3.5" />
                    </span>
                </p>
            </div>
        </div>

        <!-- Error -->
        <div v-if="error" class="pr-6 rounded-lg bg-red-50 border border-red-100 p-4">
            <p class="text-sm text-red-600">{{ error }}</p>
        </div>

        <!-- Loading skeleton -->
        <div v-else-if="isLoading" class="pr-6 flex flex-col items-center gap-3">
            <div class="h-6 w-32 animate-pulse rounded bg-slate-100" />
            <div v-for="r in 6" :key="r" class="flex gap-2">
                <div v-for="c in 10" :key="c" class="h-9 w-9 animate-pulse rounded-md bg-slate-100" />
            </div>
        </div>

        <!-- Thanh công cụ xem layout theo ngày và phiên bản -->
        <div class="flex items-center gap-2 pr-6 mt-4">

            <!-- Date input -->
            <div class="flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 bg-white shadow-sm">
                <CalendarDays class="size-3.5 text-slate-400 shrink-0" />
                <input type="date" v-model="viewDate" @change="onViewDateChange(roomId)"
                    class="text-sm text-slate-700 outline-none w-32 bg-transparent" />
            </div>

            <!-- Nút "Hôm nay" — tiện ích nhỏ, reset về layout hiện tại -->
            <button @click="fetchCurrentLayout(roomId)" title="Xem layout hôm nay"
                class="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 border rounded-lg bg-white shadow-sm hover:bg-slate-50 hover:text-slate-700 transition-colors">
                <RotateCcw class="size-3" />
                Hôm nay
            </button>

            <!-- Divider -->
            <div class="h-5 w-px bg-slate-200 mx-1" />

            <!-- Version selector — chỉ hiện khi có data -->
            <div v-if="layoutVersions?.length" class="flex items-center gap-2">
                <span class="text-xs text-slate-400 font-medium uppercase tracking-wide">Phiên bản</span>
                <select v-model="selectedVersionId" @change="goToVersion(roomId)"
                    class="text-sm border rounded-lg px-2.5 py-1.5 bg-white shadow-sm text-slate-700 outline-none cursor-pointer hover:border-slate-400 transition-colors">
                    <option v-for="v in layoutVersions" :key="v.id" :value="v.id">
                        v{{ v.layoutVersion }} · {{ formatRoomType(v.roomType) }} · {{ formatDateTime(v.effectiveDate,
                            false) }}
                        <template v-if="v.lastUsedDate">
                            · Dùng đến {{ formatDateTime(v.lastUsedDate, false) }}
                        </template>
                        {{ v.id === layout?.id ? '(hiện tại)' : '' }}
                    </option>
                </select>
                <span
                    class="text-xs text-text-admin-primary bg-slate-200 px-2 py-1 rounded whitespace-nowrap flex items-center gap-1">
                    <Clock12 class="size-3.5" />
                    Tạo: {{ formatDateTime(selectedVersion?.createdAt, true) }}
                </span>
                <span v-if="selectedVersion?.lastUsedDate"
                    class="text-xs text-text-admin-primary bg-slate-200 px-2 py-1 rounded whitespace-nowrap flex items-center gap-1">
                    <CalendarDays class="size-3.5" />
                    Dùng đến: {{ formatDateTime(selectedVersion.lastUsedDate, false) }}
                </span>
            </div>

        </div>

        <!-- Thanh công cụ áp dụng thay đổi (chỉ hiện khi là phiên bản mới nhất) -->
        <div v-if="isLatestLayout" class="pr-6 mt-4 bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
            <div class="flex items-center gap-3 flex-wrap">
                <div>
                    <label class="text-sm font-medium text-slate-700">Ngày hiệu lực:</label>
                    <input type="date" v-model="effectiveDate" class="ml-2 border rounded px-2 py-1 text-sm" />
                </div>
                <div>
                    <label class="text-sm font-medium text-slate-700">Loại phòng:</label>
                    <select v-model="selectedRoomType" class="ml-2 border rounded px-2 py-1 text-sm">
                        <option v-for="type in roomTypes" :key="type.value" :value="type.value">{{ type.label }}
                        </option>
                    </select>
                </div>
                <BaseButton variant="primary" @click="handleApplyClick()" :disabled="!hasChanges">
                    Áp dụng tất cả
                </BaseButton>
            </div>

            <!-- Thông báo lỗi nếu có -->
            <div v-if="applyError" class="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <p class="font-semibold mb-1">Không thể áp dụng thay đổi</p>
                <ul v-if="applyError.globalErrors?.length" class="list-disc list-inside mb-1">
                    <li v-for="(msg, idx) in applyError.globalErrors" :key="idx">{{ msg }}</li>
                </ul>
                <ul v-if="applyError.fieldErrors && Object.keys(applyError.fieldErrors).length"
                    class="list-disc list-inside">
                    <li v-for="(msg, field) in applyError.fieldErrors" :key="field">
                        <span class="font-mono text-xs bg-red-100 px-1 rounded">{{ field }}</span>: {{ msg }}
                    </li>
                </ul>
                <p v-if="!applyError.globalErrors?.length && !applyError.fieldErrors && applyError.message"
                    class="mt-1">
                    {{ applyError.message }}
                </p>
            </div>
        </div>

        <!-- Pending changes panel -->
        <div v-if="changeList.length > 0" class="pr-6 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div class="flex justify-between items-center">
                <h3 class="font-semibold text-amber-800">Thay đổi ghế đang chờ ({{ changeList.length }})</h3>
                <button @click="clearAll()" class="text-xs text-red-500 hover:underline">Xóa tất cả</button>
            </div>
            <div class="mt-2 flex flex-wrap gap-2 max-h-32 overflow-auto p-1">
                <div v-for="group in groupedChangeList" :key="group.seatIds.join(',')"
                    class="inline-flex items-center gap-1 bg-white rounded-full px-2 py-0.5 text-xs border border-amber-200 shadow-sm">
                    <strong class="text-amber-800">{{ group.labels.join(' ') }}</strong>
                    <template v-if="group.newStatus != null && group.newSeatTypeId != null">
                        <span class="text-gray-400">→</span>
                        <span class="text-green-600 font-medium">{{ group.newStatus }}</span>
                        <span class="text-gray-400">▪</span>
                        <span class="text-blue-600">{{ getTypeLabel(group.newSeatTypeId) }}</span>
                    </template>
                    <template v-else-if="group.newStatus != null">
                        <span class="text-gray-400">→</span>
                        <span class="text-green-600 font-medium">{{ group.newStatus }}</span>
                    </template>
                    <template v-else-if="group.newSeatTypeId != null">
                        <span class="text-gray-400">→</span>
                        <span class="text-blue-600">{{ getTypeLabel(group.newSeatTypeId) }}</span>
                    </template>
                    <button @click="group.seatIds.forEach(id => removeChange(id))"
                        class="ml-1 text-red-400 hover:text-red-600 text-xs leading-none">✕</button>
                </div>
            </div>
        </div>

        <div v-if="changeList.length > 0" class="pr-6 mt-2">
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs text-blue-700 flex items-center gap-2">
                <Eye class="size-3.5" />
                Đang xem trước layout sau khi áp dụng các thay đổi. Ghế có viền xanh đứt nét sẽ được cập nhật.
            </div>
        </div>

        <!-- Loading / Error / Empty states -->
        <div v-if="isLoading" class="flex items-center justify-center mt-16 text-slate-400 gap-2">
            <svg class="animate-spin size-5" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Đang tải layout...
        </div>

        <!-- Không tìm thấy layout theo ngày đã chọn -->
        <div v-else-if="error && error.includes('404')"
            class="mt-8 mx-auto max-w-md bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
            <Wrench class="size-10 text-slate-400 mx-auto mb-3" />
            <p class="font-semibold text-slate-700 mb-1">Không có layout phòng vào ngày đã chọn</p>
            <p class="text-sm text-slate-500">Phòng đang được bảo trì</p>
        </div>

        <!-- Lỗi thật sự -->
        <div v-else-if="error"
            class="mt-8 mx-auto max-w-md bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <p class="font-semibold mb-1">Không thể tải layout</p>
            <p class="text-red-500">{{ error }}</p>
            <button @click="fetchLayout(roomId, today.value)" class="mt-3 text-xs underline hover:text-red-800">
                Thử lại
            </button>
        </div>

        <!-- Seat grid (giữ nguyên cấu trúc) -->
        <div v-if="layout" class="relative pr-6 mt-6">
            <div ref="gridContainer" class="overflow-x-auto">
                <SeatGrid ref="seatGridRef" :layout="previewLayout || layout" :config="adminSeatGridConfig"
                    :disabled="!isLatestLayout" :pending-seat-ids="pendingSeatIds"
                    :selected-ids="Array.from(selectedIds)" @seat-click="handleSeatClick"
                    @couple-click="handleCoupleClick" />
            </div>
        </div>
        <div v-if="!isLatestLayout && !isLoading" class="pr-6 mt-2">
            <div
                class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle class="size-4 shrink-0 mt-0.5" />
                <div>
                    <strong>Bạn đang xem phiên bản layout cũ (v{{ layout?.layoutVersion }}).</strong><br />
                    Chỉ có phiên bản mới nhất (v{{ latestLayout?.layoutVersion }}) mới có thể chỉnh sửa.
                    Vui lòng chọn phiên bản này từ dropdown "Phiên bản" để tiếp
                    tục.
                </div>
            </div>
        </div>
        <!-- Admin panel (phiên bản mới) -->
        <AdminSeatPanel v-if="selectedIds.size > 0 && isLatestLayout" :selected-seat-ids="selectedIds"
            @apply-change="onApplyChange" @clear-selection="clearSelection" />
    </div>
    <Teleport to="body">
        <div v-if="showConfirmModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            @click.self="showConfirmModal = false">
            <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                <h3 class="text-lg font-semibold text-slate-900 mb-2">Xác nhận thay đổi</h3>
                <p class="text-sm text-slate-600 mb-6">{{ confirmMessage }}</p>
                <div class="flex justify-end gap-3">
                    <BaseButton variant="secondary" isAdmin @click="showConfirmModal = false">Hủy</BaseButton>
                    <BaseButton variant="primary" @click="confirmApply">Đồng ý</BaseButton>
                </div>
            </div>
        </div>
    </Teleport>
    <Teleport to="body">
        <div v-if="isApplying"
            class="fixed inset-0 z-60 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
            <div class="bg-white rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4 min-w-64">
                <svg class="animate-spin size-8 text-blue-500" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <div class="text-center">
                    <p class="font-semibold text-slate-800">Đang áp dụng thay đổi...</p>
                    <p class="text-sm text-slate-500 mt-1">Vui lòng không đóng trang này</p>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
    ChevronRight, CalendarDays, RotateCcw, Clock12, AlertTriangle, Eye, CircleCheck, Wrench
} from 'lucide-vue-next'
import SeatGrid from '@/components/seat/SeatGrid.vue'
import AdminSeatPanel from '@/components/seat/AdminSeatPanel.vue'
import BaseButton from '@/components/ui/button/BaseButton.vue'
import { adminSeatGridConfig } from '@/components/seat/seatGridConfig'
import { useRoomLayout } from '@/composables/useRoomLayout'
import { useSeatSelection } from '@/composables/useSeatSelection'
import { useApplyLayoutChanges } from '@/composables/useApplyLayoutChanges'
import { roomApi } from '@/api/room.api'
import { cinemaApi } from '@/api/cinema.api'
import { layoutApi } from '@/api/layout.api'
import type { SeatResponse, RoomLayoutSummaryResponse, SeatStatus } from '@/types/seat'
import { SEAT_TYPE_CONFIGS } from '@/components/seat/seatGridConfig'

const route = useRoute()
const router = useRouter()
const cinemaId = Number(route.params.cinemaId)
const roomId = Number(route.params.roomId)

const cinemaName = ref('...')
const roomName = ref('...')

const showConfirmModal = ref(false)
const confirmMessage = ref('')

cinemaApi.getById(cinemaId)
    .then((res) => { cinemaName.value = res.name })
    .catch(() => { cinemaName.value = `Cinema #${cinemaId}` })

roomApi.getById(roomId)
    .then((res) => { roomName.value = res.name })
    .catch(() => { roomName.value = `Phòng #${roomId}` })


// Layout data
const { layout, isLoading, error, fetchLayout, layoutVersions, viewDate, selectedVersionId, selectedVersion, latestLayout, isLatestLayout, today,
    fetchLayoutHistory, fetchCurrentLayout, onViewDateChange, goToVersion, syncSelectedVersion, selectedRoomType } = useRoomLayout()

const effectiveDate = ref(today.value)

// Selection logic
const { selectedIds, toggleSeat, toggleCouple, clearSelection, initDragSelect } = useSeatSelection()

const {
    applyError,
    isApplying,
    groupedChangeList,
    pendingSeatIds,
    previewLayout,
    addChange,
    removeChange,
    clearAll,
    hasChanges,
    changeList,
    applyAllChanges,
} = useApplyLayoutChanges(layout, effectiveDate, fetchLayout, fetchLayoutHistory, syncSelectedVersion, selectedRoomType, layoutVersions)


const formatDateTime = (dateStr?: string | null, includeTime: boolean = true): string => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr

    const day = d.getDate().toString().padStart(2, '0')
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const year = d.getFullYear()

    if (!includeTime) {
        return `${day}/${month}/${year}`
    }

    const hours = d.getHours().toString().padStart(2, '0')
    const minutes = d.getMinutes().toString().padStart(2, '0')
    const seconds = d.getSeconds().toString().padStart(2, '0')
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`
}

function formatRoomType(type: string) {
    return type === 'TYPE_2D' ? '2D' : type === 'TYPE_3D' ? '3D' : type === 'IMAX' ? 'IMAX' : type;
}

const roomTypes = [
    { label: '2D', value: 'TYPE_2D' },
    { label: '3D', value: 'TYPE_3D' },
    { label: 'IMAX', value: 'IMAX' },
];

const getTypeLabel = (typeId: number) => SEAT_TYPE_CONFIGS[typeId]?.label || `Loại ${typeId}`

// Nhận sự kiện từ AdminSeatPanel: thêm vào pending changes
function onApplyChange(payload: { seatIds: number[]; newStatus?: SeatStatus; newSeatTypeId?: number }) {
    payload.seatIds.forEach(id => addChange(id, payload.newStatus, payload.newSeatTypeId))
    clearSelection()
}

function handleApplyClick() {
    if (!layout.value) return

    const version = layout.value.layoutVersion ?? 0
    if (layout.value.used) {
        confirmMessage.value = `Layout này đã được sử dụng cho suất chiếu. Mọi thay đổi sẽ tạo một phiên bản layout mới (v${version + 1}) và không ảnh hưởng đến phiên bản hiện tại. Bạn có chắc chắn muốn tiếp tục?`
    } else {
        confirmMessage.value = `Layout chưa được sử dụng. Thay đổi sẽ được áp dụng trực tiếp lên phiên bản hiện tại (v${version}). Bạn có chắc chắn?`
    }
    showConfirmModal.value = true
}

function confirmApply() {
    showConfirmModal.value = false
    applyAllChanges(roomId)
}

// Drag-select setup 
const seatGridRef = ref<InstanceType<typeof SeatGrid> | null>(null)
const gridContainer = ref<HTMLElement | null>(null)
let cleanupDrag: (() => void) | undefined

watch(
    () => seatGridRef.value?.gridEl,
    (el) => {
        // Cleanup instance cũ nếu có (layout đổi → SeatGrid remount)
        if (cleanupDrag) {
            cleanupDrag()
            cleanupDrag = undefined
        }
        if (el) {
            cleanupDrag = initDragSelect(el)
        }
    }
)

onUnmounted(() => {
    if (cleanupDrag) cleanupDrag()
})

onMounted(async () => {
    await Promise.all([
        fetchCurrentLayout(roomId),
        fetchLayoutHistory(roomId)
    ])
    syncSelectedVersion()
})

function handleSeatClick(seat: SeatResponse, event: MouseEvent) {
    toggleSeat(seat, event)
}

function handleCoupleClick(left: SeatResponse, right: SeatResponse, event: MouseEvent) {
    toggleCouple(left, right, event)
}
</script>