package com.cinemaebooking.backend.seat_lock.infrastructure.adapter;

import com.cinemaebooking.backend.common.exception.domain.ShowtimeSeatExceptions;
import com.cinemaebooking.backend.common.exception.domain.SeatLockExceptions;
import com.cinemaebooking.backend.seat_lock.application.dto.AcquireLockResponse;
import com.cinemaebooking.backend.seat_lock.application.port.SeatLockService;
import com.cinemaebooking.backend.seat_lock.application.validator.OrphanSeatValidator;
import com.cinemaebooking.backend.seat_lock.infrastructure.persistence.entity.SeatLockJpaEntity;
import com.cinemaebooking.backend.seat_lock.infrastructure.persistence.repository.SeatLockJpaRepository;
import com.cinemaebooking.backend.showtime_seat.domain.enums.ShowtimeSeatStatus;
import com.cinemaebooking.backend.showtime_seat.domain.model.ShowtimeSeat;
import com.cinemaebooking.backend.showtime_seat.domain.valueobject.ShowtimeSeatId;
import com.cinemaebooking.backend.showtime_seat.infrastructure.mapper.ShowtimeSeatMapper;
import com.cinemaebooking.backend.showtime_seat.infrastructure.persistence.entity.ShowtimeSeatJpaEntity;
import com.cinemaebooking.backend.showtime_seat.infrastructure.persistence.repository.ShowtimeSeatJpaRepository;
import com.cinemaebooking.backend.user.infrastructure.persistence.entity.UserJpaEntity;
import com.cinemaebooking.backend.user.infrastructure.persistence.repository.UserJpaRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * SeatLockServiceImpl - Implementation of SeatLockService.
 *
 * <p>Chịu trách nhiệm orchestrate seat locking logic:
 * <ul>
 *   <li>Acquire: kiểm tra trạng thái ghế, tạo/extend lock, update ShowtimeSeat → LOCKED</li>
 *   <li>Release user locks: giải phóng khi user hủy chọn ghế</li>
 *   <li>Release booking locks: giải phóng khi booking được xác nhận</li>
 *   <li>Release expired locks: dọn lock hết hạn (scheduled job)</li>
 * </ul>
 *
 * <p>Business rules:
 * <ul>
 *   <li>Ghế phải ở AVAILABLE mới lock được</li>
 *   <li>User không thể lock ghế đang bị lock bởi user khác</li>
 *   <li>User có thể re-lock ghế đang bị lock bởi chính mình (extend expiry)</li>
 *   <li>Lock duration mặc định: 7 phút</li>
 * </ul>
 *
 * <p>Lưu ý: Làm việc trực tiếp với JPA entities (SeatLockJpaEntity, ShowtimeSeatJpaEntity)
 * vì SeatLock là dữ liệu tạm (ephemeral) — không cần Clean Architecture layers phức tạp.
 * Chỉ dùng JPA native status field cho ShowtimeSeat (AVAILABLE → LOCKED → BOOKED).
 *
 * @author ducthinhn
 * @since 2026
 */
@Service
@RequiredArgsConstructor
public class SeatLockServiceImpl implements SeatLockService {

    private final SeatLockJpaRepository seatLockJpaRepository;
    private final ShowtimeSeatJpaRepository showtimeSeatJpaRepository;
    private final UserJpaRepository userJpaRepository;
    private final OrphanSeatValidator orphanSeatValidator;
    private final ShowtimeSeatMapper showtimeSeatMapper;

    @Value("${seat-lock.lock-duration-minutes:7}")
    private int lockDurationMinutes;

    // ================== ACQUIRE (KHÓA GHẾ) ==================

    @Override
    @Transactional
    public AcquireLockResponse acquireLocks(Long userId, Long showtimeId, List<Long> seatIds) {
        if (seatIds == null || seatIds.isEmpty()) {
            return AcquireLockResponse.builder()
                    .success(true)
                    .lockedSeats(List.of())
                    .expiredAt(null)
                    .build();
        }

        LocalDateTime now = LocalDateTime.now();
        LocalDateTime expiredAt = now.plusMinutes(lockDurationMinutes);
        List<AcquireLockResponse.LockedSeatDto> lockedSeats = new ArrayList<>();

        // Validate user tồn tại
        UserJpaEntity user = userJpaRepository.getReferenceById(userId);

        // Batch load seats để kiểm tra trạng thái
        List<ShowtimeSeatJpaEntity> seatEntities = showtimeSeatJpaRepository.findAllById(seatIds);
        Map<Long, ShowtimeSeatJpaEntity> seatMap = seatEntities.stream()
                .collect(Collectors.toMap(ShowtimeSeatJpaEntity::getId, Function.identity()));

        for (Long seatId : seatIds) {
            ShowtimeSeatJpaEntity seatEntity = seatMap.get(seatId);
            if (seatEntity == null) {
                throw ShowtimeSeatExceptions.unavailable(new ShowtimeSeatId(seatId));
            }
            if (seatEntity.getStatus() != ShowtimeSeatStatus.AVAILABLE) {
                throw ShowtimeSeatExceptions.unavailable(new ShowtimeSeatId(seatId));
            }
            seatLockJpaRepository.findActiveLockByShowtimeSeatId(seatId, now)
                    .ifPresent(existingLock -> {
                        if (!existingLock.getUser().getId().equals(userId)) {
                            throw SeatLockExceptions.conflict(seatEntity.getSeatNumber());
                        }
                    });
        }

        validateNoOrphanAfterLock(showtimeId, seatIds, seatMap, userId, now);

        for (Long seatId : seatIds) {
            ShowtimeSeatJpaEntity seatEntity = seatMap.get(seatId);

            SeatLockJpaEntity lockEntity = seatLockJpaRepository
                    .findActiveLockByShowtimeSeatIdAndUserId(seatId, userId, now)
                    .orElse(null);

            if (lockEntity == null) {
                lockEntity = SeatLockJpaEntity.builder()
                        .showtimeSeat(seatEntity)
                        .user(user)
                        .lockedAt(now)
                        .expiredAt(expiredAt)
                        .build();
            } else {
                lockEntity.setExpiredAt(expiredAt);
            }

            seatLockJpaRepository.save(lockEntity);

            seatEntity.setStatus(ShowtimeSeatStatus.LOCKED);
            showtimeSeatJpaRepository.save(seatEntity);

            lockedSeats.add(AcquireLockResponse.LockedSeatDto.builder()
                    .seatId(seatId)
                    .seatNumber(seatEntity.getSeatNumber())
                    .expiredAt(expiredAt)
                    .build());
        }

        return AcquireLockResponse.builder()
                .success(true)
                .lockedSeats(lockedSeats)
                .expiredAt(expiredAt)
                .build();
    }

    private void validateNoOrphanAfterLock(
            Long showtimeId,
            List<Long> proposedSeatIds,
            Map<Long, ShowtimeSeatJpaEntity> proposedSeatMap,
            Long userId,
            LocalDateTime now
    ) {
        // Load full layout
        List<ShowtimeSeatJpaEntity> fullLayoutEntities =
                showtimeSeatJpaRepository.findByShowtimeId(showtimeId);

        // Convert JPA → domain model tối giản (chỉ các field OrphanSeatValidator cần)
        List<ShowtimeSeat> fullLayout = fullLayoutEntities.stream()
                .map(showtimeSeatMapper::toDomain)
                .toList();

        // coupleTypeId: seatTypeId của ghế nào có coupleGroupId != null
        // Assumption: tất cả ghế đôi trong layout dùng cùng 1 seatTypeId (đúng với thiết kế hiện tại)
        // Nếu layout không có ghế đôi → null → validator skip couple logic
        Long coupleTypeId = fullLayoutEntities.stream()
            .filter(this::isRealCoupleSeat)           // ← Filter quan trọng
            .map(ShowtimeSeatJpaEntity::getSeatTypeId)
            .filter(Objects::nonNull)
            .findFirst()
            .orElse(null);

        // Query existing locks của current user cho showtime này
        // Những ghế này KHÔNG được tính là "taken" trong orphan validation
        List<SeatLockJpaEntity> currentUserLocks = seatLockJpaRepository
                .findActiveLocksByUserIdAndShowtimeId(userId, showtimeId, now);
        Set<Long> currentUserLockedSeatIds = currentUserLocks.stream()
                .map(lock -> lock.getShowtimeSeat().getId())
                .collect(Collectors.toSet());

        orphanSeatValidator.validate(fullLayout, coupleTypeId, proposedSeatIds, userId, currentUserLockedSeatIds);
    }

    private boolean isRealCoupleSeat(ShowtimeSeatJpaEntity seat) {
        if (seat.getSeatTypeId() == null) {
            return false;
        }
        return seat.getSeatTypeId().equals(3L);
    }

    // ================== RELEASE USER LOCKS ==================

    @Override
    @Transactional
    public void releaseUserLocks(Long userId, Long showtimeId) {
        List<SeatLockJpaEntity> locks = seatLockJpaRepository
                .findActiveLocksByUserIdAndShowtimeId(userId, showtimeId, LocalDateTime.now());

        releaseLocks(locks);
    }

    // ================== RELEASE BOOKING LOCKS ==================

    @Override
    @Transactional
    public void releaseLocksByBookingId(Long bookingId) {
        List<SeatLockJpaEntity> locks = seatLockJpaRepository
                .findActiveLocksByBookingId(bookingId, LocalDateTime.now());

        releaseLocks(locks);
    }

    // ================== EXTEND LOCKS FOR PAYMENT ==================

    @Override
    @Transactional
    public void extendLocksForPayment(Long bookingId, Long userId, Long showtimeId, LocalDateTime paymentExpiredAt) {
        LocalDateTime now = LocalDateTime.now();
        List<SeatLockJpaEntity> locks = seatLockJpaRepository
                .findActiveLocksByUserIdAndShowtimeId(userId, showtimeId, now);

        for (SeatLockJpaEntity lock : locks) {
            // Chỉ extend nếu lock đó chưa được gán bookingId, hoặc bookingId trùng với booking hiện tại
            if (lock.getBooking() == null || lock.getBooking().getId().equals(bookingId)) {
                lock.setExpiredAt(paymentExpiredAt);
                seatLockJpaRepository.save(lock);
            }
        }
    }

    // ================== RELEASE EXPIRED LOCKS ==================

    @Override
    @Transactional
    public void releaseExpiredLocks() {
        LocalDateTime now = LocalDateTime.now();
        List<SeatLockJpaEntity> expiredLocks = seatLockJpaRepository.findExpiredLocks(now);

        releaseLocks(expiredLocks);
    }

    /**
     * Giải phóng danh sách lock: update ShowtimeSeat → AVAILABLE rồi xóa lock.
     */
    private void releaseLocks(List<SeatLockJpaEntity> locks) {
        if (locks.isEmpty()) {
            return;
        }

        // Batch load seats để update trạng thái
        List<Long> seatIds = locks.stream()
                .map(l -> l.getShowtimeSeat().getId())
                .toList();

        List<ShowtimeSeatJpaEntity> seatEntities = showtimeSeatJpaRepository.findAllById(seatIds);
        Map<Long, ShowtimeSeatJpaEntity> seatMap = seatEntities.stream()
                .collect(Collectors.toMap(ShowtimeSeatJpaEntity::getId, Function.identity()));

        for (SeatLockJpaEntity lock : locks) {
            ShowtimeSeatJpaEntity seat = seatMap.get(lock.getShowtimeSeat().getId());
            if (seat != null && seat.getStatus() == ShowtimeSeatStatus.LOCKED) {
                seat.setStatus(ShowtimeSeatStatus.AVAILABLE);
                showtimeSeatJpaRepository.save(seat);
            }
            seatLockJpaRepository.delete(lock);
        }
    }

    // ================== CHECK LOCK STATUS ==================

    @Override
    @Transactional(readOnly = true)
    public boolean isLockedByOther(Long seatId, Long currentUserId) {
        LocalDateTime now = LocalDateTime.now();

        return seatLockJpaRepository.findActiveLockByShowtimeSeatId(seatId, now)
                .map(lock -> !lock.getUser().getId().equals(currentUserId))
                .orElse(false);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean isLockedByUser(Long seatId, Long userId) {
        LocalDateTime now = LocalDateTime.now();
        return seatLockJpaRepository.findActiveLockByShowtimeSeatIdAndUserId(seatId, userId, now)
                .isPresent();
    }
}
