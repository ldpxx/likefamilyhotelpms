import { doc, runTransaction, writeBatch, type DocumentData, type UpdateData } from 'firebase/firestore';
import { db } from './firebase';
import {
  applyOccupancyPlanInTransaction,
  buildBookingOccupancyInterval,
  DEFAULT_CLEANING_BUFFER_MINUTES,
  getAffectedOccupancyDates,
  prepareOccupancyPlanInTransaction,
} from './occupancyService';
import type {
  Booking,
  CancellationType,
  DepositResolutionStatus,
  OtaCancelStatus,
  PaymentMethod,
  Room,
  Transaction,
} from '../types/pms';
import {
  formatDateVN,
  generateId,
  getPaymentMethodLabel,
  isBookingBlockingCalendar,
  isDateRangeOverlap,
  todayISO,
} from './utils';
import { writeAuditLog, type ActorInfo } from './pmsActions';

export interface ExecuteCancellationParams {
  bookingsToCancel: Booking[];
  isPartialGroupCancel?: boolean;
  isSplitStayChainCancel?: boolean;
  cancellationType: CancellationType;
  reason: string;
  depositAction: DepositResolutionStatus;
  refundMethod?: PaymentMethod;
  transferTargetBooking?: Booking | null;
  otaInitialCancelStatus?: Extract<OtaCancelStatus, 'ota_cancel_requested' | 'ota_cancel_confirmed'>;
  actor: ActorInfo;
}

/**
 * Accounting-Grade Booking Cancellation Engine (8 Anti-Fraud Rules - v2.0.0):
 * - Releases room immediately without ever deleting or editing original financial transactions.
 * - Supports full cancellation and partial group cancellation (selected rooms only).
 * - Blocks `void_entry_error` whenever any payment/deposit > 0 exists.
 * - Supports `pending_deposit_resolution`, independent `refunded` (Cash/Bank), `forfeited_fee`,
 *   and `transferred_to_booking`.
 * - Preserves OTA receivable debt across 3 explicit OTA cancel states.
 */
export async function executeAccountingCancellation(
  params: ExecuteCancellationParams
): Promise<void> {
  const { bookingsToCancel, cancellationType, reason, depositAction, actor } = params;
  if (bookingsToCancel.length === 0) throw new Error('Chưa chọn phòng nào để hủy.');
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do hủy đơn để ghi nhật ký kiểm toán.');

  const totalPaidAll = bookingsToCancel.reduce(
    (sum, b) => sum + (b.depositPaid || 0) + (b.guestPaid || 0),
    0
  );

  // Rule 3: Lock "Hủy do Nhập sai (Void)" if ANY payment/deposit occurred
  if (cancellationType === 'void_entry_error' && totalPaidAll > 0) {
    throw new Error(
      'Đơn đã phát sinh giao dịch tiền cọc/thanh toán — không thể chọn "Hủy do Nhập sai (Void)". Vui lòng chọn quy trình hủy đơn khách thực tế.'
    );
  }

  if (depositAction === 'transferred_to_booking' && totalPaidAll > 0 && !params.transferTargetBooking) {
    throw new Error('Vui lòng chọn đơn đặt phòng đích để chuyển tiền cọc.');
  }

  const now = new Date().toISOString();
  const today = todayISO();
  const nextStatus: Booking['status'] =
    cancellationType === 'no_show' ? 'no_show' : 'cancelled';
  const refundMethod: PaymentMethod = params.refundMethod || 'cash';

  // v2.2.2 BUG-02: Release room_occupancy intervals for all cancelled / no_show bookings atomically
  const releaseReqs = bookingsToCancel.map((b) => {
    const iv = buildBookingOccupancyInterval(b, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);
    return {
      roomId: b.roomId,
      id: b.id,
      dates: getAffectedOccupancyDates(iv.startAt, iv.endAt, iv.bufferMinutes),
    };
  });

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, { release: releaseReqs });
    applyOccupancyPlanInTransaction(tx, db, occPlan);

    let totalTransferredToTarget = 0;

    for (const b of bookingsToCancel) {
      const paidOnBooking = (b.depositPaid || 0) + (b.guestPaid || 0);
      const isOta = b.source === 'ota' || b.paymentMethod === 'ota_debt';

      const effectiveDepositStatus: DepositResolutionStatus =
        paidOnBooking > 0 ? depositAction : 'none';

      const prevState = {
        status: b.status,
        roomId: b.roomId,
        depositPaid: b.depositPaid,
        guestPaid: b.guestPaid,
        otaSettlementStatus: b.otaSettlementStatus,
      };

      const bookingUpdate: Record<string, unknown> = {
        status: nextStatus,
        cancellationType,
        cancellationReason: reason.trim(),
        cancelledAt: now,
        cancelledBy: actor.name,
        depositResolutionStatus: effectiveDepositStatus,
        pendingDepositAmount:
          effectiveDepositStatus === 'pending_deposit_resolution' ? paidOnBooking : 0,
        forfeitedFeeAmount: effectiveDepositStatus === 'forfeited_fee' ? paidOnBooking : 0,
        depositResolvedAt:
          effectiveDepositStatus === 'refunded' ||
          effectiveDepositStatus === 'forfeited_fee' ||
          effectiveDepositStatus === 'transferred_to_booking'
            ? now
            : null,
        depositResolvedBy:
          effectiveDepositStatus === 'refunded' ||
          effectiveDepositStatus === 'forfeited_fee' ||
          effectiveDepositStatus === 'transferred_to_booking'
            ? actor.name
            : null,
        depositResolutionNote: reason.trim(),
        refundMethod: effectiveDepositStatus === 'refunded' ? refundMethod : null,
        depositTransferredToBookingId:
          effectiveDepositStatus === 'transferred_to_booking'
            ? params.transferTargetBooking?.id || null
            : null,
        depositTransferredToBookingCode:
          effectiveDepositStatus === 'transferred_to_booking'
            ? params.transferTargetBooking?.bookingCode || null
            : null,
        otaCancelStatus: isOta
          ? params.otaInitialCancelStatus || 'ota_cancel_requested'
          : 'none',
        otaSettlementStatus: isOta ? 'unsettled' : b.otaSettlementStatus,
        lastActionSnapshot: { action: 'accounting_cancel', prevState },
        updatedAt: now,
      };

      tx.update(doc(db, 'bookings', b.id), bookingUpdate as UpdateData<DocumentData>);

      if (b.status === 'in_house') {
        tx.update(doc(db, 'rooms', b.roomId), { currentBookingId: null });
      }

      if (paidOnBooking > 0) {
        if (effectiveDepositStatus === 'refunded') {
          const txId = generateId('tx');
          const refundTx: Transaction = {
            id: txId,
            bookingId: b.id,
            bookingCode: b.bookingCode,
            roomNumber: b.roomNumber,
            groupId: b.groupId || null,
            type: 'refund',
            direction: 'out',
            category: 'Phiếu chi hoàn tiền cọc hủy đơn',
            amount: paidOnBooking,
            method: refundMethod,
            date: today,
            status: 'active',
            createdAt: now,
            createdByUid: actor.uid,
            createdByName: actor.name,
            note: `Hoàn cọc đơn ${b.bookingCode} (P.${b.roomNumber}) qua ${getPaymentMethodLabel(
              refundMethod
            )} — Lý do: ${reason.trim()}`,
          };
          tx.set(doc(db, 'transactions', txId), refundTx);
        } else if (effectiveDepositStatus === 'forfeited_fee') {
          const txId = generateId('tx');
          const feeTx: Transaction = {
            id: txId,
            bookingId: b.id,
            bookingCode: b.bookingCode,
            roomNumber: b.roomNumber,
            groupId: b.groupId || null,
            type: 'cancellation_fee',
            direction: 'in',
            category: 'Ghi nhận doanh thu phí hủy (Giữ cọc)',
            amount: paidOnBooking,
            method: b.paymentMethod || 'cash',
            date: today,
            status: 'active',
            createdAt: now,
            createdByUid: actor.uid,
            createdByName: actor.name,
            note: `Kết chuyển tiền cọc giữ lại thành doanh thu phí hủy đơn ${b.bookingCode} — Lý do: ${reason.trim()}`,
          };
          tx.set(doc(db, 'transactions', txId), feeTx);
        } else if (
          effectiveDepositStatus === 'transferred_to_booking' &&
          params.transferTargetBooking
        ) {
          totalTransferredToTarget += paidOnBooking;
          const outTxId = generateId('tx');
          const outTx: Transaction = {
            id: outTxId,
            bookingId: b.id,
            bookingCode: b.bookingCode,
            roomNumber: b.roomNumber,
            groupId: b.groupId || null,
            type: 'deposit_transfer_out',
            direction: 'out',
            category: `Chuyển cọc sang đơn ${params.transferTargetBooking.bookingCode}`,
            amount: paidOnBooking,
            method: 'bank_transfer',
            date: today,
            status: 'active',
            createdAt: now,
            createdByUid: actor.uid,
            createdByName: actor.name,
            note: `Chuyển cọc từ đơn hủy ${b.bookingCode} sang ${params.transferTargetBooking.bookingCode} (P.${params.transferTargetBooking.roomNumber})`,
          };
          const inTxId = generateId('tx');
          const inTx: Transaction = {
            id: inTxId,
            bookingId: params.transferTargetBooking.id,
            bookingCode: params.transferTargetBooking.bookingCode,
            roomNumber: params.transferTargetBooking.roomNumber,
            groupId: params.transferTargetBooking.groupId || null,
            type: 'deposit_transfer_in',
            direction: 'in',
            category: `Nhận cọc chuyển từ đơn hủy ${b.bookingCode}`,
            amount: paidOnBooking,
            method: 'bank_transfer',
            date: today,
            status: 'active',
            createdAt: now,
            createdByUid: actor.uid,
            createdByName: actor.name,
            note: `Nhận kết chuyển tiền cọc từ đơn hủy ${b.bookingCode} — Lý do: ${reason.trim()}`,
          };
          tx.set(doc(db, 'transactions', outTxId), outTx);
          tx.set(doc(db, 'transactions', inTxId), inTx);
        }
      }
    }

    if (totalTransferredToTarget > 0 && params.transferTargetBooking) {
      tx.update(doc(db, 'bookings', params.transferTargetBooking.id), {
        depositPaid: (params.transferTargetBooking.depositPaid || 0) + totalTransferredToTarget,
        updatedAt: now,
      });
    }
  });

  // Rule 8: Immutable Audit Trail
  await writeAuditLog({
    actionType: params.isSplitStayChainCancel
      ? 'cancel_split_stay_chain'
      : params.isPartialGroupCancel
      ? 'partial_cancel_group'
      : cancellationType === 'no_show'
      ? 'mark_no_show'
      : 'cancel_booking',
    targetId: bookingsToCancel.map((b) => b.id).join(','),
    targetLabel: bookingsToCancel.map((b) => `${b.bookingCode} (P.${b.roomNumber})`).join(', '),
    newState: {
      status: nextStatus,
      cancellationType,
      isSplitStayChainCancel: Boolean(params.isSplitStayChainCancel),
      depositAction: totalPaidAll > 0 ? depositAction : 'none',
      totalPaidAffected: totalPaidAll,
      refundMethod: depositAction === 'refunded' ? refundMethod : null,
      transferTarget: params.transferTargetBooking?.bookingCode || null,
    },
    reason: reason.trim(),
    actor,
  });
}

/**
 * Rule 4 & Rule 5: Resolve a suspended `pending_deposit_resolution` deposit later.
 */
export async function resolvePendingDeposit(params: {
  booking: Booking;
  resolution: Extract<
    DepositResolutionStatus,
    'refunded' | 'forfeited_fee' | 'transferred_to_booking'
  >;
  refundMethod?: PaymentMethod;
  transferTargetBooking?: Booking | null;
  reason: string;
  actor: ActorInfo;
}): Promise<void> {
  const { booking, resolution, reason, actor } = params;
  if (!reason.trim()) throw new Error('Vui lòng nhập lý do xử lý tiền cọc.');
  const amount = booking.pendingDepositAmount || (booking.depositPaid || 0) + (booking.guestPaid || 0);
  if (amount <= 0) throw new Error('Đơn này không có khoản tiền cọc treo nào.');

  if (resolution === 'transferred_to_booking' && !params.transferTargetBooking) {
    throw new Error('Vui lòng chọn đơn đặt phòng đích để chuyển cọc.');
  }

  const now = new Date().toISOString();
  const today = todayISO();
  const refundMethod: PaymentMethod = params.refundMethod || 'cash';
  const batch = writeBatch(db);

  batch.update(doc(db, 'bookings', booking.id), {
    depositResolutionStatus: resolution,
    pendingDepositAmount: 0,
    forfeitedFeeAmount: resolution === 'forfeited_fee' ? amount : 0,
    depositResolvedAt: now,
    depositResolvedBy: actor.name,
    depositResolutionNote: reason.trim(),
    refundMethod: resolution === 'refunded' ? refundMethod : null,
    depositTransferredToBookingId:
      resolution === 'transferred_to_booking' ? params.transferTargetBooking?.id || null : null,
    depositTransferredToBookingCode:
      resolution === 'transferred_to_booking'
        ? params.transferTargetBooking?.bookingCode || null
        : null,
    updatedAt: now,
  });

  if (resolution === 'refunded') {
    const txId = generateId('tx');
    const tx: Transaction = {
      id: txId,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      roomNumber: booking.roomNumber,
      groupId: booking.groupId || null,
      type: 'refund',
      direction: 'out',
      category: 'Phiếu chi hoàn tiền cọc treo',
      amount,
      method: refundMethod,
      date: today,
      status: 'active',
      createdAt: now,
      createdByUid: actor.uid,
      createdByName: actor.name,
      note: `Hoàn cọc treo đơn ${booking.bookingCode} qua ${getPaymentMethodLabel(
        refundMethod
      )} — Lý do: ${reason.trim()}`,
    };
    batch.set(doc(db, 'transactions', txId), tx);
  } else if (resolution === 'forfeited_fee') {
    const txId = generateId('tx');
    const tx: Transaction = {
      id: txId,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      roomNumber: booking.roomNumber,
      groupId: booking.groupId || null,
      type: 'cancellation_fee',
      direction: 'in',
      category: 'Doanh thu phí hủy (Chốt giữ cọc treo)',
      amount,
      method: booking.paymentMethod || 'cash',
      date: today,
      status: 'active',
      createdAt: now,
      createdByUid: actor.uid,
      createdByName: actor.name,
      note: `Chốt giữ cọc treo đơn ${booking.bookingCode} tính vào doanh thu phí hủy — Lý do: ${reason.trim()}`,
    };
    batch.set(doc(db, 'transactions', txId), tx);
  } else if (resolution === 'transferred_to_booking' && params.transferTargetBooking) {
    const outId = generateId('tx');
    const inId = generateId('tx');
    batch.set(doc(db, 'transactions', outId), {
      id: outId,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      roomNumber: booking.roomNumber,
      type: 'deposit_transfer_out',
      direction: 'out',
      category: `Chuyển cọc treo sang ${params.transferTargetBooking.bookingCode}`,
      amount,
      method: 'bank_transfer',
      date: today,
      status: 'active',
      createdAt: now,
      createdByUid: actor.uid,
      createdByName: actor.name,
      note: reason.trim(),
    } satisfies Transaction);
    batch.set(doc(db, 'transactions', inId), {
      id: inId,
      bookingId: params.transferTargetBooking.id,
      bookingCode: params.transferTargetBooking.bookingCode,
      roomNumber: params.transferTargetBooking.roomNumber,
      type: 'deposit_transfer_in',
      direction: 'in',
      category: `Nhận cọc treo chuyển từ ${booking.bookingCode}`,
      amount,
      method: 'bank_transfer',
      date: today,
      status: 'active',
      createdAt: now,
      createdByUid: actor.uid,
      createdByName: actor.name,
      note: reason.trim(),
    } satisfies Transaction);
    batch.update(doc(db, 'bookings', params.transferTargetBooking.id), {
      depositPaid: (params.transferTargetBooking.depositPaid || 0) + amount,
      updatedAt: now,
    });
  }

  await batch.commit();

  await writeAuditLog({
    actionType: `resolve_deposit_${resolution}`,
    targetId: booking.id,
    targetLabel: `Xử lý cọc treo ${booking.bookingCode} (${amount.toLocaleString('vi-VN')}đ)`,
    previousState: { depositResolutionStatus: 'pending_deposit_resolution', pendingDepositAmount: amount },
    newState: {
      depositResolutionStatus: resolution,
      refundMethod: resolution === 'refunded' ? refundMethod : null,
      transferTarget: params.transferTargetBooking?.bookingCode || null,
    },
    reason: reason.trim(),
    actor,
  });
}

/**
 * Rule 7: Dedicated 3-State OTA Cancellation Reconciliation (`ota_cancel_requested` -> `ota_cancel_confirmed` -> `ota_cancel_reconciled`).
 */
export async function updateOtaCancelWorkflow(params: {
  booking: Booking;
  nextOtaStatus: Exclude<OtaCancelStatus, 'none'>;
  adjustedDebtAmount?: number; // 0 = free cancel; >0 = confirmed penalty fee receivable from OTA
  reason: string;
  actor: ActorInfo;
}): Promise<void> {
  const { booking, nextOtaStatus, reason, actor } = params;
  if (!reason.trim()) throw new Error('Vui lòng nhập ghi chú / lý do cập nhật hủy OTA.');
  const now = new Date().toISOString();
  const batch = writeBatch(db);

  const prev = {
    otaCancelStatus: booking.otaCancelStatus || 'none',
    grossRoomTotal: booking.grossRoomTotal,
    otaSettlementStatus: booking.otaSettlementStatus,
  };

  if (nextOtaStatus === 'ota_cancel_reconciled') {
    const adjusted = Math.max(0, Math.round(params.adjustedDebtAmount ?? 0));
    batch.update(doc(db, 'bookings', booking.id), {
      otaCancelStatus: 'ota_cancel_reconciled',
      otaCancelAdjustedDebt: adjusted,
      grossRoomTotal: adjusted,
      netRoomTotal: adjusted,
      otaSettlementStatus: adjusted === 0 ? 'settled' : 'unsettled',
      otaCancelReconciledAt: now,
      otaCancelReconciledBy: actor.name,
      otaCancelReconciledNote: reason.trim(),
      updatedAt: now,
    });
  } else {
    batch.update(doc(db, 'bookings', booking.id), {
      otaCancelStatus: nextOtaStatus,
      otaCancelReconciledNote: reason.trim(),
      updatedAt: now,
    });
  }

  await batch.commit();

  await writeAuditLog({
    actionType: `ota_cancel_${nextOtaStatus}`,
    targetId: booking.id,
    targetLabel: `OTA Hủy ${booking.bookingCode} (${booking.otaChannel || 'OTA'})`,
    previousState: prev,
    newState: {
      otaCancelStatus: nextOtaStatus,
      adjustedDebtAmount:
        nextOtaStatus === 'ota_cancel_reconciled' ? params.adjustedDebtAmount ?? 0 : undefined,
    },
    reason: reason.trim(),
    actor,
  });
}

/**
 * Rule 6: Strict Undo Cancel (`restoreCancelledBooking`):
 * 1. Verifies room availability for [checkIn, checkOut); blocks restoring into occupied room.
 * 2. If deposit was previously refunded or transferred, resets `depositPaid` & `guestPaid` to 0
 *    (NEVER auto-restores refunded/transferred money).
 * 3. Logs mandatory reason in `audit_logs`.
 */
export async function restoreCancelledBooking(params: {
  booking: Booking;
  targetRoom: Room;
  allBookings: Booking[];
  reason: string;
  actor: ActorInfo;
}): Promise<{ depositWasResetToZero: boolean }> {
  const { booking, targetRoom, allBookings, reason, actor } = params;
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do khôi phục đơn đã hủy.');

  if (targetRoom.hkStatus === 'maintenance' || targetRoom.isActive === false) {
    throw new Error(`Phòng P.${targetRoom.roomNumber} hiện đang bảo trì hoặc ngừng sử dụng.`);
  }

  const conflict = allBookings.find(
    (b) =>
      b.id !== booking.id &&
      b.roomId === targetRoom.id &&
      isBookingBlockingCalendar(b.status) &&
      isDateRangeOverlap(b.checkIn, b.checkOut, booking.checkIn, booking.checkOut)
  );
  if (conflict) {
    throw new Error(
      `Không thể khôi phục vào P.${targetRoom.roomNumber}: bị trùng lịch với đơn ${
        conflict.bookingCode
      } (${formatDateVN(conflict.checkIn)} → ${formatDateVN(conflict.checkOut)}). Vui lòng chọn phòng trống khác.`
    );
  }

  const depositGone =
    booking.depositResolutionStatus === 'refunded' ||
    booking.depositResolutionStatus === 'transferred_to_booking';

  const now = new Date().toISOString();
  // v2.2.2 BUG-02: Atomically re-reserve room_occupancy when restoring a cancelled booking
  const restoreIv = buildBookingOccupancyInterval(
    booking,
    '14:00',
    '12:00',
    DEFAULT_CLEANING_BUFFER_MINUTES,
    now
  );
  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      reserve: [{ roomId: targetRoom.id, roomNumber: targetRoom.roomNumber, interval: restoreIv }],
      excludeIds: [booking.id],
    });
    applyOccupancyPlanInTransaction(tx, db, occPlan);

    tx.update(doc(db, 'bookings', booking.id), {
      status: 'reserved',
      roomId: targetRoom.id,
      roomNumber: targetRoom.roomNumber,
      floor: targetRoom.floor,
      roomTypeId: targetRoom.roomTypeId,
      roomTypeName: targetRoom.roomTypeName,
      cancellationType: null,
      cancellationReason: null,
      cancelledAt: null,
      cancelledBy: null,
      depositPaid: depositGone ? 0 : booking.depositPaid,
      guestPaid: depositGone ? 0 : booking.guestPaid,
      depositResolutionStatus: 'none',
      pendingDepositAmount: 0,
      forfeitedFeeAmount: 0,
      otaCancelStatus: 'none',
      updatedAt: now,
    });
  });

  await writeAuditLog({
    actionType: 'undo_cancel',
    targetId: booking.id,
    targetLabel: `Khôi phục đơn hủy ${booking.bookingCode} -> P.${targetRoom.roomNumber}`,
    previousState: {
      status: booking.status,
      oldRoomNumber: booking.roomNumber,
      depositResolutionStatus: booking.depositResolutionStatus || 'none',
    },
    newState: {
      status: 'reserved',
      roomNumber: targetRoom.roomNumber,
      depositResetToZero: depositGone,
    },
    reason: reason.trim(),
    actor,
  });

  return { depositWasResetToZero: depositGone };
}
