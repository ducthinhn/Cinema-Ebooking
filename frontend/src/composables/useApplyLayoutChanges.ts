// src/composables/useApplyLayoutChanges.ts
import { ref, computed, type Ref } from 'vue'
import { cloneDeep } from 'lodash-es'
import { layoutApi } from '@/api/layout.api'
import type { SeatResponse, RoomLayoutResponse, SeatStatus } from '@/types/seat'
import { usePendingChanges } from '@/composables/usePendingChanges'
import { validateEffectiveDate } from '@/utils/layoutValidation'
import type { RoomLayoutSummaryResponse } from '@/types/seat'

interface MappedError {
  type?: string
  fieldErrors?: Record<string, string>
  globalErrors?: string[]
  code?: string | null
  message?: string
  status?: number
}

export function useApplyLayoutChanges(
  layout: Ref<RoomLayoutResponse | null>,
  effectiveDate: Ref<string>,
  fetchLayout: (roomId: number, date?: string) => Promise<void>,
  fetchLayoutHistory: (roomId: number) => Promise<void>,
  syncSelectedVersion: () => void,
  selectedRoomType?: Ref<string>,
  allVersions?: Ref<RoomLayoutSummaryResponse[]>
) {
  const { changes, addChange, removeChange, clearAll, hasChanges: hasSeatChanges, changeList } = usePendingChanges()
  const applyError = ref<MappedError | null>(null)
  const isApplying = ref(false) 

  function findSeatById(seatId: number): SeatResponse | undefined {
    if (!layout.value) return undefined
    for (const row of layout.value.rows) {
      const seat = row.find(s => s.id === seatId)
      if (seat) return seat
    }
    return undefined
  }

  function findCouplePartner(seat: SeatResponse, layoutData: RoomLayoutResponse): SeatResponse | undefined {
    const row = layoutData.rows.find(r => r.some(s => s.id === seat.id))
    if (!row) return undefined
    const idx = row.findIndex(s => s.id === seat.id)
    if (idx === -1) return undefined
    const col = seat.colIndex
    // Ghế lẻ (col lẻ) ghép với ghế bên phải
    if (col % 2 === 1 && idx + 1 < row.length) {
      const right = row[idx + 1]
      if (right.colIndex === col + 1) return right
    }
    // Ghế chẵn (col chẵn) ghép với ghế bên trái
    if (col % 2 === 0 && idx - 1 >= 0) {
      const left = row[idx - 1]
      if (left.colIndex === col - 1) return left
    }
    return undefined
  }

  const hasChanges = computed(() => {
    if (hasSeatChanges.value) return true
    if (layout.value && selectedRoomType?.value !== layout.value.roomType) return true
    return false
  })

  // Hàm addChange thông minh: nếu đổi loại ghế thành 3 thì tự động thêm partner
  function addChangeSmart(seatId: number, newStatus?: SeatStatus | null, newSeatTypeId?: number | null) {
    const seat = findSeatById(seatId)
    if (!seat) {
      addChange(seatId, newStatus, newSeatTypeId)
      return
    }

    // Xử lý trường hợp đổi thành ghế đôi (type 3)
    if (newSeatTypeId === 3 && layout.value) {
      const partner = findCouplePartner(seat, layout.value)
      if (partner && partner.id !== seat.id) {
        // Thêm partner với cùng loại ghế đôi, giữ nguyên newStatus nếu có
        addChange(partner.id, newStatus, 3)
      }
    }

    // Thêm chính ghế hiện tại (sử dụng logic gốc để merge)
    const existing = changes.value.get(seatId)
    const effectiveNewStatus = newStatus ?? undefined
    const effectiveNewSeatTypeId = newSeatTypeId ?? undefined

    const mergedStatus = effectiveNewStatus !== undefined ? effectiveNewStatus : (existing?.newStatus !== undefined ? existing.newStatus : seat.status)
    const mergedTypeId = effectiveNewSeatTypeId !== undefined ? effectiveNewSeatTypeId : (existing?.newSeatTypeId !== undefined ? existing.newSeatTypeId : seat.seatTypeId)

    const statusChanged = mergedStatus !== seat.status
    const typeChanged = mergedTypeId !== seat.seatTypeId

    if (!statusChanged && !typeChanged) {
      if (existing) changes.value.delete(seatId)
      return
    }

    if (!existing) {
      const entry: any = { seatId }
      if (statusChanged) entry.newStatus = mergedStatus as SeatStatus
      if (typeChanged) entry.newSeatTypeId = mergedTypeId
      changes.value.set(seatId, entry)
    } else {
      if (statusChanged) {
        existing.newStatus = mergedStatus as SeatStatus
      } else {
        delete existing.newStatus
      }
      if (typeChanged) {
        existing.newSeatTypeId = mergedTypeId
      } else {
        delete existing.newSeatTypeId
      }
      if (existing.newStatus === undefined && existing.newSeatTypeId === undefined) {
        changes.value.delete(seatId)
      }
    }
  }

  // Ghi đè removeChange để xóa cả partner khi cần
  const originalRemoveChange = removeChange
  const newRemoveChange = (seatId: number) => {
    const seat = findSeatById(seatId)
    if (seat && layout.value) {
      const partner = findCouplePartner(seat, layout.value)
      if (partner) {
        originalRemoveChange(partner.id)
      }
    }
    originalRemoveChange(seatId)
  }

  // Map coupleGroupId -> seatId (dùng để gom nhóm hiển thị)
  const seatCoupleMap = computed(() => {
    const map = new Map<number, number | null>()
    if (!layout.value) return map
    for (const row of layout.value.rows) {
      for (const seat of row) {
        map.set(seat.id, seat.coupleGroupId ?? null)
      }
    }
    return map
  })

  // Đảm bảo cặp ghế đôi được đồng bộ trong preview
  function enforceCouplePairs(layoutData: RoomLayoutResponse): void {
    for (const row of layoutData.rows) {
      for (let i = 0; i < row.length - 1; i++) {
        const left = row[i]
        const right = row[i + 1]
        if (left.colIndex % 2 === 1 && right.colIndex % 2 === 0) {
          if (left.seatTypeId === 3 || right.seatTypeId === 3) {
            left.seatTypeId = 3
            right.seatTypeId = 3
          }
        }
      }
    }
  }

  function getSeatLabel(seatId: number): string {
    if (!layout.value) return `#${seatId}`
    for (const row of layout.value.rows) {
      const seat = row.find(s => s.id === seatId)
      if (seat) {
        const rowLetter = String.fromCharCode(65 + seat.rowIndex - 1)
        const displayedCol = layout.value.totalCols - seat.colIndex + 1
        return `${rowLetter}${displayedCol}`
      }
    }
    return `#${seatId}`
  }

  const groupedChangeList = computed(() => {
    const groups: Array<{
      seatIds: number[]
      labels: string[]
      newStatus?: string | null
      newSeatTypeId?: number | null
    }> = []
    const processed = new Set<number>()

    for (const change of changeList.value) {
      if (processed.has(change.seatId)) continue
      if (change.newStatus === undefined && change.newSeatTypeId === undefined) continue

      const coupleId = seatCoupleMap.value.get(change.seatId)
      if (coupleId != null) {
        const other = changeList.value.find(
          c => c.seatId !== change.seatId && seatCoupleMap.value.get(c.seatId) === coupleId
        )
        if (other && change.newStatus === other.newStatus && change.newSeatTypeId === other.newSeatTypeId) {
          groups.push({
            seatIds: [change.seatId, other.seatId],
            labels: [getSeatLabel(change.seatId), getSeatLabel(other.seatId)],
            newStatus: change.newStatus,
            newSeatTypeId: change.newSeatTypeId,
          })
          processed.add(change.seatId)
          processed.add(other.seatId)
          continue
        }
      }
      groups.push({
        seatIds: [change.seatId],
        labels: [getSeatLabel(change.seatId)],
        newStatus: change.newStatus,
        newSeatTypeId: change.newSeatTypeId,
      })
      processed.add(change.seatId)
    }
    return groups
  })

  const pendingSeatIds = computed(() => changeList.value.map(c => c.seatId))

  const previewLayout = computed(() => {
    if (!layout.value || changeList.value.length === 0) return layout.value
    const newLayout = cloneDeep(layout.value)
    const changeMap = new Map(
      changeList.value.map(c => [c.seatId, { status: c.newStatus, typeId: c.newSeatTypeId }])
    )
    for (const row of newLayout.rows) {
      for (const seat of row) {
        const change = changeMap.get(seat.id)
        if (change) {
          if (change.status !== undefined) seat.status = change.status as SeatStatus
          if (change.typeId !== undefined) seat.seatTypeId = change.typeId
        }
      }
    }
    enforceCouplePairs(newLayout)
    return newLayout
  })

  async function applyAllChanges(roomId: number) {
    applyError.value = null
    if (!hasChanges.value) {
      applyError.value = { globalErrors: ['Không có thay đổi nào để áp dụng.'] }
      return
    }
    if (allVersions) {
      const validationError = validateEffectiveDate(
        layout.value,
        effectiveDate.value,
        allVersions.value
      )
      if (validationError) {
        applyError.value = {
          globalErrors: [validationError],
          message: validationError,
          fieldErrors: {}
        }
        return
      }
    }
    const updates = changeList.value.map(change => ({
      seatId: change.seatId,
      newStatus: change.newStatus,
      newSeatTypeId: change.newSeatTypeId,
    }))
    isApplying.value = true  
    try {
      console.log('Applying changes:', selectedRoomType?.value, updates)
      await layoutApi.updateLayoutSeats(roomId, {
        effectiveDate: effectiveDate.value,
        roomType: selectedRoomType?.value,
        updates,
      })
      clearAll()
      await fetchLayout(roomId, effectiveDate.value)
      await fetchLayoutHistory(roomId)
      syncSelectedVersion()
    } catch (err: any) {
      const mapped: MappedError = err?.fieldErrors || err?.globalErrors || err?.message
        ? err
        : { globalErrors: [err?.message || 'Cập nhật thất bại'] }
      applyError.value = mapped
    } finally {
      isApplying.value = false        
    }
  }

  return {
    applyError,
    groupedChangeList,
    pendingSeatIds,
    previewLayout,
    addChange: addChangeSmart,
    removeChange: newRemoveChange,
    clearAll,
    hasChanges,
    changeList,
    applyAllChanges,
    isApplying,
  }
}