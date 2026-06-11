package com.cinemaebooking.backend.seat_lock.application.validator;

import com.cinemaebooking.backend.common.exception.ErrorCategory;
import com.cinemaebooking.backend.common.exception.ErrorDetail;
import com.cinemaebooking.backend.common.exception.domain.CommonExceptions;
import com.cinemaebooking.backend.showtime_seat.domain.enums.ShowtimeSeatStatus;
import com.cinemaebooking.backend.showtime_seat.domain.model.ShowtimeSeat;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

/**
 * OrphanSeatValidator — kiểm tra ghế đơn lẻ (orphan seat).
 *
 * <p>Mirror chính xác logic từ FE {@code useSeatOrphanRule.ts}:
 * <ul>
 *   <li>Ghế đôi (coupleTypeId) → divider, không tạo orphan, không bị orphan</li>
 *   <li>Ghế null/inactive → gap vật lý (divider)</li>
 *   <li>Ghế BOOKED hoặc LOCKED bởi user khác → "taken" (divider)</li>
 *   <li>Chỉ tính orphan MỚI do proposed selection tạo ra</li>
 * </ul>
 *
 * <p>Rule: Nếu ghế available đứng một mình (không có ghế available kề nó
 * trong cùng hàng, bị kẹp giữa các divider), ghế đó là orphan.
 *
 * @author ducthinhn
 * @since 2026
 */
@RequiredArgsConstructor
@Component
public class OrphanSeatValidator {

    /**
     * Validate orphan seat sau khi user chọn ghế.
     *
     * @param allSeats        toàn bộ ShowtimeSeat của showtime (full layout)
     * @param coupleTypeId    id loại ghế đôi (nullable nếu không có loại này)
     * @param proposedSeatIds danh sách ghế user đang chọn (proposed booking)
     * @param currentUserId   userId để phân biệt LOCKED của mình vs người khác
     * @param currentUserLockedSeatIds tập seatId đang bị lock bởi current user (không tính là "taken")
     * @throws com.cinemaebooking.backend.common.exception.BaseException nếu có orphan mới
     */
    public void validate(
            List<ShowtimeSeat> allSeats,
            Long coupleTypeId,
            List<Long> proposedSeatIds,
            Long currentUserId,
            Set<Long> currentUserLockedSeatIds
    ) {
        // 1. Tính tập "taken" trước khi user chọn (baseline)
        Set<Long> baseTakenByOthers = allSeats.stream()
                .filter(s -> isTakenByOther(s, currentUserId, currentUserLockedSeatIds))
                .map(s -> s.getId().getValue())
                .collect(Collectors.toSet());

        // 2. Orphan tồn tại sẵn trước khi user chọn bất kỳ ghế nào
        Set<Long> takenBefore = new HashSet<>(baseTakenByOthers);
        takenBefore.addAll(currentUserLockedSeatIds);
        Set<Long> orphansBefore = findOrphanIds(allSeats, coupleTypeId, takenBefore);

        // 3. Orphan sau khi áp dụng selection
        Set<Long> takenAfter = new HashSet<>(takenBefore);
        takenAfter.addAll(proposedSeatIds);
        Set<Long> orphansAfter = findOrphanIds(allSeats, coupleTypeId, takenAfter);

        // 4. Chỉ tính orphan MỚI do selection này tạo ra
        List<Long> newOrphanIds = orphansAfter.stream()
                .filter(id -> !orphansBefore.contains(id))
                .toList();

        if (!newOrphanIds.isEmpty()) {
            // Map từ id → seatNumber để trả về FE
            Map<Long, String> idToSeatNumber = allSeats.stream()
                    .collect(Collectors.toMap(
                            s -> s.getId().getValue(),
                            ShowtimeSeat::getSeatNumber
                    ));

            List<String> orphanSeatNumbers = newOrphanIds.stream()
                    .map(id -> idToSeatNumber.getOrDefault(id, String.valueOf(id)))
                    .sorted()
                    .toList();

            Map<String, Object> params = new LinkedHashMap<>();
            params.put("orphanCount", newOrphanIds.size());
            params.put("orphanSeats", orphanSeatNumbers);

            throw CommonExceptions.invalidInput(List.of(
                    new ErrorDetail(
                            "seats",
                            ErrorCategory.INVALID_VALUE,
                            "Lựa chọn tạo ra " + newOrphanIds.size() +
                                    " ghế đơn lẻ: " + String.join(", ", orphanSeatNumbers) +
                                    ". Hãy chọn ghế liền kề hoặc bỏ chọn ghế gây lẻ.",
                            params
                    )
            ));
        }
    }

    // ── PRIVATE HELPERS ──────────────────────────────────────

    /**
     * Tìm tất cả ghế orphan trong toàn bộ layout với tập "taken" cho trước.
     */
    private Set<Long> findOrphanIds(
            List<ShowtimeSeat> allSeats,
            Long coupleTypeId,
            Set<Long> takenIds
    ) {
        // Nhóm theo rowIndex, sort theo colIndex trong mỗi hàng
        Map<Integer, List<ShowtimeSeat>> byRow = allSeats.stream()
                .collect(Collectors.groupingBy(ShowtimeSeat::getRowIndex));

        Set<Long> result = new HashSet<>();
        for (List<ShowtimeSeat> row : byRow.values()) {
            // Sort theo colIndex để scan left → right
            List<ShowtimeSeat> sortedRow = row.stream()
                    .sorted(Comparator.comparingInt(ShowtimeSeat::getColIndex))
                    .toList();

            result.addAll(findOrphansInRow(sortedRow, coupleTypeId, takenIds));
        }
        return result;
    }

    /**
     * Mirror {@code findOrphansInRow} từ FE.
     * Scan từ trái sang phải, track "run" ghế available liên tiếp.
     * Run = 1 → orphan.
     */
    private List<Long> findOrphansInRow(
            List<ShowtimeSeat> sortedRow,
            Long coupleTypeId,
            Set<Long> takenIds
    ) {
        List<Long> orphanIds = new ArrayList<>();
        List<ShowtimeSeat> singleRun = new ArrayList<>();

        for (ShowtimeSeat seat : sortedRow) {
            // Gap vật lý: inactive seat (không active)
            if (!seat.isActive()) {
                flushRun(singleRun, orphanIds);
                continue;
            }

            boolean isTaken = takenIds.contains(seat.getId().getValue());
            boolean isCouple = coupleTypeId != null && coupleTypeId.equals(seat.getSeatTypeId());

            // Ghế đã chiếm HOẶC ghế đôi → divider cho ghế đơn
            if (isTaken || isCouple) {
                flushRun(singleRun, orphanIds);
                continue;
            }

            // Ghế đơn + available → thêm vào run
            singleRun.add(seat);
        }

        // Xử lý run cuối dòng
        flushRun(singleRun, orphanIds);
        return orphanIds;
    }

    /**
     * Flush run hiện tại: nếu chỉ có 1 ghế → orphan.
     */
    private void flushRun(List<ShowtimeSeat> run, List<Long> orphanIds) {
        if (run.size() == 1) {
            orphanIds.add(run.get(0).getId().getValue());
        }
        run.clear();
    }

    /**
     * Ghế bị "taken" bởi user khác (không phải user hiện tại đang booking).
     * <ul>
     *   <li>BOOKED → luôn taken</li>
     *   <li>LOCKED → taken nếu bị lock bởi user KHÁC (không nằm trong currentUserLockedSeatIds)</li>
     * </ul>
     * Lưu ý: currentUserLockedSeatIds chứa các seatId đang bị lock bởi current user.
     * Những ghế này KHÔNG được tính là "taken" vì chúng là phần của selection hiện tại.
     */
    private boolean isTakenByOther(ShowtimeSeat seat, Long currentUserId, Set<Long> currentUserLockedSeatIds) {
        if (seat.getStatus() == ShowtimeSeatStatus.BOOKED) {
            return true;
        }
        if (seat.getStatus() == ShowtimeSeatStatus.LOCKED) {
            // Nếu ghế đang bị lock bởi current user, không tính là "taken"
            return !currentUserLockedSeatIds.contains(seat.getId().getValue());
        }
        return false;
    }
}