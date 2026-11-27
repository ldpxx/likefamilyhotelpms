import { doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type {
  Booking,
  DepositResolutionStatus,
  OtaAdjustment,
  PaymentMethod,
  PostCheckoutAdjustment,
  Room,
  Transaction,
} from '../types/pms';
import {
  addDays,
  diffDays,
  formatDateVN,
  generateId,
  getPaymentMethodLabel,
  isBookingBlockingCalendar,
  isDateRangeOverlap,
  sumDailyRates,
  todayISO,
} from './utils';
import { writeAuditLog, type ActorInfo } from './pmsActions';

/**
 * Rule 8: Accounting Period Lock Resolver.
 * Never back-dates entries into a locked period (date <= accountingLockDate).
 * Automatically routes the posting date to the currently open period and flags reference.
 */
export function resolveAccountingPostingDate(
  originalDate: string,
  accountingLockDate?: string | null
): {
  postingDate: string;
  isLockedOrigin: boolean;
  lockedNotice: string | null;
} {
  const today = todayISO();
  if (!accountingLockDate) {
    return { postingDate: today, isLockedOrigin: false, lockedNotice: null };
  }
  const originLocked = originalDate <= accountingLockDate;
  const openDate = today > accountingLockDate ? today : addDays(accountingLockDate, 1);
  if (originLocked) {
    return {
      postingDate: openDate,
      isLockedOrigin: true,
      lockedNotice: `Đơn/giao dịch gốc thuộc kỳ đã khóa sổ (≤ ${formatDateVN(
        accountingLockDate
      )}) — Hạch toán điều chỉnh vào kỳ đang mở (${formatDateVN(openDate)})`,
    };
  }
  return { postingDate: openDate, isLockedOrigin: false, lockedNotice: null };
}

/**
 * Part C Rule 1: Reverse Check-in (`reverse_checkin`).
 * Keeps original Check-in audit history, returns booking to `reserved`,
 * and requires explicit physical room status (`clean` if unused, `dirty` if used).
 */
export async function reverseCheckInBooking(params: {
  booking: Booking;
  roomWasUsed: boolean;
  reason: string;
  actor: ActorInfo;
}): Promise<void> {
  const { booking, roomWasUsed, reason, actor } = params;
  if (booking.status !== 'in_house') {
    throw new Error('Chỉ có thể đảo Check-in cho đơn đang ở trạng thái Đang lưu trú.');
  }
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do đảo Check-in.');

  const now = new Date().toISOString();
  const nextHkStatus = roomWasUsed ? 'dirty' : 'clean';
  const before = {
    status: booking.status,
    actualCheckInAt: booking.actualCheckInAt || null,
    roomId: booking.roomId,
  };

  const batch = writeBatch(db);
  batch.update(doc(db, 'bookings', booking.id), {
    status: 'reserved',
    updatedAt: now,
  });
  batch.update(doc(db, 'rooms', booking.roomId), {
    currentBookingId: null,
    hkStatus: nextHkStatus,
  });
  await batch.commit();

  await writeAuditLog({
    actionType: 'reverse_checkin',
    targetId: booking.id,
    targetLabel: `Đảo Check-in ${booking.bookingCode} (P.${booking.roomNumber} -> ${
      roomWasUsed ? 'Chờ dọn' : 'Sạch'
    })`,
    previousState: before,
    newState: {
      status: 'reserved',
      roomWasUsed,
      hkStatus: nextHkStatus,
      preservedOriginalCheckInAt: booking.actualCheckInAt || null,
    },
    reason: reason.trim(),
    actor,
  });
}

/**
 * Part C Rule 2: Transparent Early Check-out with explicit disposition of unused-night excess payment.
 */
export async function executeEarlyCheckOut(params: {
  booking: Booking;
  excessAction: 'none' | Extract<DepositResolutionStatus, 'refunded' | 'pending_deposit_resolution' | 'transferred_to_booking'>;
  refundMethod?: PaymentMethod;
  transferTargetBooking?: Booking | null;
  reason: string;
  accountingLockDate?: string | null;
  actor: ActorInfo;
}): Promise<{ stayedNights: number; excessAmount: number }> {
  const { booking, excessAction, reason, actor } = params;
  if (booking.status !== 'in_house') {
    throw new Error('Chỉ áp dụng Trả phòng sớm cho đơn đang lưu trú.');
  }
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do trả phòng sớm.');

  const now = new Date().toISOString();
  const today = todayISO();
  const stayedNights = Math.max(1, diffDays(booking.checkIn, today));
  const trimmedRates = booking.dailyRates.slice(0, stayedNights);
  const effectiveRates =
    trimmedRates.length > 0 ? trimmedRates : booking.dailyRates.slice(0, 1);
  const newGross = sumDailyRates(effectiveRates);
  const newCheckOut = today <= booking.checkIn ? addDays(booking.checkIn, 1) : today;

  const finalCharge = newGross + (booking.serviceTotal || 0) + (booking.hourlySurcharge || 0);
  const totalPaid = (booking.depositPaid || 0) + (booking.guestPaid || 0);
  const excessAmount = Math.max(0, totalPaid - finalCharge);

  if (excessAmount > 0 && excessAction === 'transferred_to_booking' && !params.transferTargetBooking) {
    throw new Error('Vui lòng chọn đơn đặt phòng đích để bảo lưu phần tiền dư.');
  }

  const { postingDate, isLockedOrigin } = resolveAccountingPostingDate(
    booking.checkIn,
    params.accountingLockDate
  );

  const before = {
    status: booking.status,
    checkOut: booking.checkOut,
    nights: booking.nights,
    grossRoomTotal: booking.grossRoomTotal,
    totalPaid,
  };

  const batch = writeBatch(db);
  const relatedTxIds: string[] = [];

  batch.update(doc(db, 'bookings', booking.id), {
    status: 'checked_out',
    checkOut: newCheckOut,
    dailyRates: effectiveRates,
    nights: effectiveRates.length,
    grossRoomTotal: newGross,
    otaCommissionAmount: 0,
    netRoomTotal: newGross,
    actualCheckOutAt: now,
    depositResolutionStatus: excessAmount > 0 ? excessAction : 'none',
    pendingDepositAmount:
      excessAmount > 0 && excessAction === 'pending_deposit_resolution' ? excessAmount : 0,
    depositTransferredToBookingId:
      excessAmount > 0 && excessAction === 'transferred_to_booking'
        ? params.transferTargetBooking?.id || null
        : null,
    depositTransferredToBookingCode:
      excessAmount > 0 && excessAction === 'transferred_to_booking'
        ? params.transferTargetBooking?.bookingCode || null
        : null,
    updatedAt: now,
  });

  batch.update(doc(db, 'rooms', booking.roomId), {
    currentBookingId: null,
    hkStatus: 'dirty',
  });

  if (excessAmount > 0) {
    if (excessAction === 'refunded') {
      const method = params.refundMethod || 'cash';
      const txId = generateId('tx');
      relatedTxIds.push(txId);
      const refundTx: Transaction = {
        id: txId,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        roomNumber: booking.roomNumber,
        originalReferenceDate: booking.checkIn,
        lockedPeriodOverride: isLockedOrigin,
        type: 'refund',
        direction: 'out',
        category: 'Phiếu chi hoàn tiền dư trả phòng sớm',
        amount: excessAmount,
        method,
        date: postingDate,
        status: 'active',
        createdAt: now,
        createdByUid: actor.uid,
        createdByName: actor.name,
        note: `Hoàn tiền dư ${excessAmount.toLocaleString('vi-VN')}đ trả sớm đơn ${booking.bookingCode} qua ${getPaymentMethodLabel(
          method
        )} — ${reason.trim()}`,
      };
      batch.set(doc(db, 'transactions', txId), refundTx);
    } else if (excessAction === 'transferred_to_booking' && params.transferTargetBooking) {
      const outId = generateId('tx');
      const inId = generateId('tx');
      relatedTxIds.push(outId, inId);
      batch.set(doc(db, 'transactions', outId), {
        id: outId,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        roomNumber: booking.roomNumber,
        type: 'deposit_transfer_out',
        direction: 'out',
        category: `Bảo lưu tiền dư trả sớm sang ${params.transferTargetBooking.bookingCode}`,
        amount: excessAmount,
        method: 'bank_transfer',
        date: postingDate,
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
        category: `Nhận bảo lưu tiền dư từ ${booking.bookingCode}`,
        amount: excessAmount,
        method: 'bank_transfer',
        date: postingDate,
        status: 'active',
        createdAt: now,
        createdByUid: actor.uid,
        createdByName: actor.name,
        note: reason.trim(),
      } satisfies Transaction);
      batch.update(doc(db, 'bookings', params.transferTargetBooking.id), {
        depositPaid: (params.transferTargetBooking.depositPaid || 0) + excessAmount,
        updatedAt: now,
      });
    }
  }

  await batch.commit();

  await writeAuditLog({
    actionType: 'early_checkout',
    targetId: booking.id,
    targetLabel: `Trả phòng sớm ${booking.bookingCode} (P.${booking.roomNumber}, ${effectiveRates.length}đ)`,
    previousState: before,
    newState: {
      status: 'checked_out',
      checkOut: newCheckOut,
      grossRoomTotal: newGross,
      excessAmount,
      excessAction: excessAmount > 0 ? excessAction : 'none',
    },
    relatedTransactionIds: relatedTxIds,
    reason: reason.trim(),
    actor,
  });

  return { stayedNights: effectiveRates.length, excessAmount };
}

/**
 * Part C Rule 3: Payment Method Reclassification (Owner / SuperAdmin ONLY).
 * Creates an offsetting pair (reclassification_out on old method + reclassification_in on new method),
 * keeping the original receipt 100% immutable and producing ZERO fake revenue/expense.
 */
export async function reclassifyPaymentMethod(params: {
  tx: Transaction;
  newMethod: PaymentMethod;
  reason: string;
  accountingLockDate?: string | null;
  actor: ActorInfo;
}): Promise<string[]> {
  const { tx, newMethod, reason, actor } = params;
  if (tx.method === newMethod) {
    throw new Error('Phương thức mới trùng với phương thức hiện tại.');
  }
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do chuyển đổi phương thức thanh toán.');

  const now = new Date().toISOString();
  const { postingDate, isLockedOrigin, lockedNotice } = resolveAccountingPostingDate(
    tx.date,
    params.accountingLockDate
  );

  const outId = generateId('txrc_out');
  const inId = generateId('txrc_in');

  // If original tx was 'in' (receipt): decrease old fund ('out'), increase new fund ('in')
  // If original tx was 'out' (expense/refund): credit back old fund ('in'), debit new fund ('out')
  const oldFundDir: 'in' | 'out' = tx.direction === 'in' ? 'out' : 'in';
  const newFundDir: 'in' | 'out' = tx.direction === 'in' ? 'in' : 'out';

  const noteSuffix = `${reason.trim()}${lockedNotice ? ` | ${lockedNotice}` : ''}`;

  const outTx: Transaction = {
    id: outId,
    bookingId: tx.bookingId || null,
    bookingCode: tx.bookingCode || null,
    roomNumber: tx.roomNumber || null,
    reclassifiedFromTxId: tx.id,
    originalReferenceDate: tx.date,
    lockedPeriodOverride: isLockedOrigin,
    type: 'reclassification_out',
    direction: oldFundDir,
    category: `Chuyển đổi PTTT (Giảm ${getPaymentMethodLabel(tx.method)})`,
    amount: tx.amount,
    method: tx.method,
    date: postingDate,
    status: 'active',
    createdAt: now,
    createdByUid: actor.uid,
    createdByName: actor.name,
    note: `Chuyển đổi từ phiếu #${tx.id.slice(-6)} (${getPaymentMethodLabel(
      tx.method
    )} → ${getPaymentMethodLabel(newMethod)}): ${noteSuffix}`,
  };

  const inTx: Transaction = {
    id: inId,
    bookingId: tx.bookingId || null,
    bookingCode: tx.bookingCode || null,
    roomNumber: tx.roomNumber || null,
    reclassifiedFromTxId: tx.id,
    originalReferenceDate: tx.date,
    lockedPeriodOverride: isLockedOrigin,
    type: 'reclassification_in',
    direction: newFundDir,
    category: `Chuyển đổi PTTT (Tăng ${getPaymentMethodLabel(newMethod)})`,
    amount: tx.amount,
    method: newMethod,
    date: postingDate,
    status: 'active',
    createdAt: now,
    createdByUid: actor.uid,
    createdByName: actor.name,
    note: `Chuyển đổi từ phiếu #${tx.id.slice(-6)} (${getPaymentMethodLabel(
      tx.method
    )} → ${getPaymentMethodLabel(newMethod)}): ${noteSuffix}`,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'transactions', outId), outTx);
  batch.set(doc(db, 'transactions', inId), inTx);
  await batch.commit();

  await writeAuditLog({
    actionType: 'reclassify_payment_method',
    targetId: tx.id,
    targetLabel: `Chuyển PTTT ${tx.amount.toLocaleString('vi-VN')}đ: ${getPaymentMethodLabel(
      tx.method
    )} → ${getPaymentMethodLabel(newMethod)}`,
    previousState: { originalTxId: tx.id, method: tx.method, amount: tx.amount, date: tx.date },
    newState: { newMethod, postingDate, lockedPeriodOverride: isLockedOrigin },
    relatedTransactionIds: [tx.id, outId, inId],
    reason: reason.trim(),
    actor,
  });

  return [outId, inId];
}

/**
 * Part C Rule 4: Void Checked-out Booking WITHOUT automatic cash refund (Owner / SuperAdmin ONLY).
 * - If paid === 0: only zeroes revenue/receivable.
 * - If paid > 0: explicitly requires choosing between:
 *   (a) `void_receipt_entry` (money was NEVER physically collected — clerical error reversal, NO fake cash payout)
 *   (b) `actual_refund` (money WAS physically returned to guest — creates real Cash/Bank refund voucher)
 *   (c) `keep_no_payout` (only mark voided, handle money separately / via OTA adjustment)
 */
export async function voidCheckedOutBooking(params: {
  booking: Booking;
  additionalChainBookings?: Booking[];
  paidDisposition: 'none' | 'void_receipt_entry' | 'actual_refund' | 'ota_adjustment_only';
  refundMethod?: PaymentMethod;
  reason: string;
  accountingLockDate?: string | null;
  actor: ActorInfo;
}): Promise<void> {
  const { booking, paidDisposition, reason, actor } = params;
  if (booking.status !== 'checked_out') {
    throw new Error('Chỉ áp dụng cho đơn đã ở trạng thái Đã trả phòng.');
  }
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do hủy đơn đã trả phòng.');

  const allTargets: Booking[] = [
    ...(params.additionalChainBookings || []).filter((b) => b.id !== booking.id),
    booking,
  ];
  const now = new Date().toISOString();
  const totalPaid = allTargets.reduce((s, b) => s + (b.depositPaid || 0) + (b.guestPaid || 0), 0);
  const { postingDate, isLockedOrigin, lockedNotice } = resolveAccountingPostingDate(
    booking.checkOut,
    params.accountingLockDate
  );

  const before = {
    status: booking.status,
    grossRoomTotal: allTargets.reduce((s, b) => s + (b.grossRoomTotal || 0), 0),
    totalPaid,
    otaSettlementStatus: booking.otaSettlementStatus,
    affectedLegs: allTargets.map((b) => `${b.bookingCode} (${b.status})`),
  };

  const batch = writeBatch(db);
  const relatedTxIds: string[] = [];

  for (const target of allTargets) {
    batch.update(doc(db, 'bookings', target.id), {
      status: 'cancelled',
      cancellationType: 'void_entry_error',
      cancellationReason: reason.trim(),
      cancelledAt: now,
      cancelledBy: actor.name,
      voidCheckedOutAt: now,
      voidCheckedOutBy: actor.name,
      voidCheckedOutReason: reason.trim(),
      isBillingReopened: false,
      depositResolutionStatus:
        totalPaid > 0 && paidDisposition === 'actual_refund' ? 'refunded' : 'none',
      updatedAt: now,
    });
  }

  const labelSuffix =
    allTargets.length > 1
      ? ` (Toàn chuỗi ${allTargets.map((b) => b.bookingCode).join(' + ')})`
      : '';

  if (totalPaid > 0) {
    if (paidDisposition === 'void_receipt_entry') {
      const txId = generateId('txvoid');
      relatedTxIds.push(txId);
      const voidTx: Transaction = {
        id: txId,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        roomNumber: booking.roomNumber,
        originalReferenceDate: booking.checkOut,
        lockedPeriodOverride: isLockedOrigin,
        type: 'void_receipt_entry',
        direction: 'out',
        category: 'Hủy ghi nhận thu sai sót (Không chi tiền mặt thực)',
        amount: totalPaid,
        method: booking.paymentMethod || 'cash',
        date: postingDate,
        status: 'active',
        createdAt: now,
        createdByUid: actor.uid,
        createdByName: actor.name,
        note: `Đảo bút toán ghi nhận sai đơn ${booking.bookingCode}${labelSuffix}: ${reason.trim()}${
          lockedNotice ? ` | ${lockedNotice}` : ''
        }`,
      };
      batch.set(doc(db, 'transactions', txId), voidTx);
    } else if (paidDisposition === 'actual_refund') {
      const method = params.refundMethod || 'cash';
      const txId = generateId('txref');
      relatedTxIds.push(txId);
      const refTx: Transaction = {
        id: txId,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        roomNumber: booking.roomNumber,
        originalReferenceDate: booking.checkOut,
        lockedPeriodOverride: isLockedOrigin,
        type: 'refund',
        direction: 'out',
        category: 'Phiếu chi hoàn tiền thực tế (Hủy đơn đã trả phòng)',
        amount: totalPaid,
        method,
        date: postingDate,
        status: 'active',
        createdAt: now,
        createdByUid: actor.uid,
        createdByName: actor.name,
        note: `Xuất quỹ hoàn khách đơn ${booking.bookingCode}${labelSuffix} qua ${getPaymentMethodLabel(
          method
        )}: ${reason.trim()}${lockedNotice ? ` | ${lockedNotice}` : ''}`,
      };
      batch.set(doc(db, 'transactions', txId), refTx);
    }
  }

  await batch.commit();

  await writeAuditLog({
    actionType: allTargets.length > 1 ? 'void_checked_out_chain' : 'void_checked_out',
    targetId: allTargets.map((b) => b.id).join(','),
    targetLabel: `Hủy đơn đã trả phòng ${allTargets
      .map((b) => `${b.bookingCode} (P.${b.roomNumber})`)
      .join(' + ')}`,
    previousState: before,
    newState: {
      status: 'cancelled',
      paidDisposition: totalPaid > 0 ? paidDisposition : 'none',
      totalPaidAffected: totalPaid,
      postingDate,
      lockedPeriodOverride: isLockedOrigin,
    },
    relatedTransactionIds: relatedTxIds,
    reason: reason.trim(),
    actor,
  });
}

/**
 * Part C Rule 5: Reopen Checked-out Booking — 2 Strict Modes (Owner / SuperAdmin ONLY).
 * - Mode A (`billing_only`): unlocks post-checkout billing edits WITHOUT occupying the room.
 * - Mode B (`reopen_stay`): checks room availability; blocks old room if occupied/conflicted.
 */
export async function reopenCheckedOutBooking(params: {
  booking: Booking;
  mode: 'billing_only' | 'reopen_stay';
  targetRoom?: Room | null;
  newCheckOutDate?: string;
  allBookings: Booking[];
  reason: string;
  actor: ActorInfo;
}): Promise<void> {
  const { booking, mode, reason, actor } = params;
  if (booking.status !== 'checked_out') {
    throw new Error('Chỉ mở lại được đơn đang ở trạng thái Đã trả phòng.');
  }
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do mở lại đơn.');

  const now = new Date().toISOString();
  const batch = writeBatch(db);

  if (mode === 'billing_only') {
    batch.update(doc(db, 'bookings', booking.id), {
      isBillingReopened: true,
      updatedAt: now,
    });
    await batch.commit();

    await writeAuditLog({
      actionType: 'reopen_billing_only',
      targetId: booking.id,
      targetLabel: `Mở lại hóa đơn (Không chiếm phòng) ${booking.bookingCode}`,
      previousState: { status: 'checked_out', isBillingReopened: false },
      newState: { status: 'checked_out', isBillingReopened: true },
      reason: reason.trim(),
      actor,
    });
    return;
  }

  // Mode B: Reopen Stay to Checked-in (`in_house`) — Mandatory room conflict check!
  const targetRoom = params.targetRoom;
  if (!targetRoom) throw new Error('Vui lòng chọn phòng trống để khôi phục khách ở tiếp.');
  if (targetRoom.hkStatus === 'maintenance' || targetRoom.isActive === false) {
    throw new Error(`Phòng P.${targetRoom.roomNumber} đang bảo trì hoặc ngừng sử dụng.`);
  }

  const today = todayISO();
  const nextOut =
    params.newCheckOutDate && params.newCheckOutDate > today
      ? params.newCheckOutDate
      : booking.checkOut > today
      ? booking.checkOut
      : addDays(today, 1);

  const conflict = params.allBookings.find(
    (b) =>
      b.id !== booking.id &&
      b.roomId === targetRoom.id &&
      isBookingBlockingCalendar(b.status) &&
      isDateRangeOverlap(b.checkIn, b.checkOut, today, nextOut)
  );
  if (conflict) {
    throw new Error(
      `Phòng P.${targetRoom.roomNumber} hiện đã có khách (${conflict.bookingCode}) trong khoảng ${formatDateVN(
        today
      )} → ${formatDateVN(nextOut)}. Vui lòng chọn phòng trống khác.`
    );
  }

  batch.update(doc(db, 'bookings', booking.id), {
    status: 'in_house',
    roomId: targetRoom.id,
    roomNumber: targetRoom.roomNumber,
    floor: targetRoom.floor,
    roomTypeId: targetRoom.roomTypeId,
    roomTypeName: targetRoom.roomTypeName,
    checkOut: nextOut,
    actualCheckOutAt: null,
    isBillingReopened: false,
    updatedAt: now,
  });
  batch.update(doc(db, 'rooms', targetRoom.id), {
    currentBookingId: booking.id,
  });
  await batch.commit();

  await writeAuditLog({
    actionType: 'reopen_stay_checked_in',
    targetId: booking.id,
    targetLabel: `Khôi phục lưu trú ${booking.bookingCode} -> P.${targetRoom.roomNumber}`,
    previousState: { status: 'checked_out', oldRoomNumber: booking.roomNumber },
    newState: { status: 'in_house', roomNumber: targetRoom.roomNumber, checkOut: nextOut },
    reason: reason.trim(),
    actor,
  });
}

/**
 * Part C Rule 6: Track Post-Checkout Billing/Surcharge Adjustments in `post_checkout_adjustments`
 * and automatically post supplemental Receipt or Refund voucher for the difference.
 */
export async function recordPostCheckoutAdjustment(params: {
  booking: Booking;
  itemLabel: string;
  adjustmentDelta: number; // + for extra surcharge/minibar, - for discount/correction
  settleNow: boolean;
  settlementMethod: PaymentMethod;
  reason: string;
  accountingLockDate?: string | null;
  actor: ActorInfo;
}): Promise<PostCheckoutAdjustment> {
  const { booking, itemLabel, adjustmentDelta, settleNow, settlementMethod, reason, actor } = params;
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do điều chỉnh sau Check-out.');
  const delta = Math.round(adjustmentDelta);
  if (delta === 0) throw new Error('Số tiền điều chỉnh phải khác 0.');

  const now = new Date().toISOString();
  const { postingDate, isLockedOrigin, lockedNotice } = resolveAccountingPostingDate(
    booking.checkOut,
    params.accountingLockDate
  );

  const oldTotal =
    (booking.grossRoomTotal || 0) + (booking.serviceTotal || 0) + (booking.hourlySurcharge || 0);
  const newTotal = Math.max(0, oldTotal + delta);
  const actualDiff = newTotal - oldTotal;

  const adjId = generateId('pcadj');
  const relatedTxIds: string[] = [];
  const batch = writeBatch(db);

  // Append adjustment as a service/surcharge line on the booking
  const nextServices = [
    ...(booking.services || []),
    {
      id: generateId('srv'),
      name: `[Điều chỉnh sau Check-out] ${itemLabel.trim()}`,
      quantity: 1,
      unitPrice: actualDiff,
      total: actualDiff,
      addedAt: now,
      addedBy: actor.name,
    },
  ];
  const nextServiceTotal = nextServices.reduce((s, i) => s + i.total, 0);

  let nextGuestPaid = booking.guestPaid || 0;

  if (settleNow && actualDiff !== 0) {
    const txId = generateId('txadj');
    relatedTxIds.push(txId);
    const isExtraCollect = actualDiff > 0;
    const tx: Transaction = {
      id: txId,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      roomNumber: booking.roomNumber,
      originalReferenceDate: booking.checkOut,
      lockedPeriodOverride: isLockedOrigin,
      type: isExtraCollect ? 'payment' : 'refund',
      direction: isExtraCollect ? 'in' : 'out',
      category: isExtraCollect
        ? `Thu bổ sung sau Check-out (${itemLabel.trim()})`
        : `Hoàn chênh lệch sau Check-out (${itemLabel.trim()})`,
      amount: Math.abs(actualDiff),
      method: settlementMethod,
      date: postingDate,
      status: 'active',
      createdAt: now,
      createdByUid: actor.uid,
      createdByName: actor.name,
      note: `${reason.trim()}${lockedNotice ? ` | ${lockedNotice}` : ''}`,
    };
    batch.set(doc(db, 'transactions', txId), tx);
    if (settlementMethod !== 'ota_debt') {
      nextGuestPaid = isExtraCollect
        ? nextGuestPaid + actualDiff
        : Math.max(0, nextGuestPaid - Math.abs(actualDiff));
    }
  }

  batch.update(doc(db, 'bookings', booking.id), {
    services: nextServices,
    serviceTotal: nextServiceTotal,
    guestPaid: nextGuestPaid,
    isBillingReopened: false,
    updatedAt: now,
  });

  const adj: PostCheckoutAdjustment = {
    id: adjId,
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    roomNumber: booking.roomNumber,
    oldTotal,
    newTotal,
    diffAmount: actualDiff,
    addedItemsSummary: itemLabel.trim(),
    performedByUid: actor.uid,
    performedByName: actor.name,
    timestamp: now,
    accountingDate: postingDate,
    lockedPeriodReference: lockedNotice,
    reason: reason.trim(),
    relatedTransactionIds: relatedTxIds,
  };
  batch.set(doc(db, 'post_checkout_adjustments', adjId), adj);

  await batch.commit();

  await writeAuditLog({
    actionType: 'post_checkout_adjustment',
    targetId: booking.id,
    targetLabel: `Điều chỉnh sau Check-out ${booking.bookingCode} (${actualDiff > 0 ? '+' : ''}${actualDiff.toLocaleString('vi-VN')}đ)`,
    previousState: { oldTotal },
    newState: { newTotal, diffAmount: actualDiff, itemLabel, accountingDate: postingDate },
    relatedTransactionIds: relatedTxIds,
    reason: reason.trim(),
    actor,
  });

  return adj;
}

/**
 * Part C Rule 7: Post-Reconciliation OTA Adjustment (`ota_adjustment`).
 * When an OTA booking is already settled/paid, records a carry-forward adjustment
 * to deduct/credit against the channel's next payout cycle instead of deleting settled debt.
 */
export async function createOtaPostReconciledAdjustment(params: {
  booking: Booking;
  adjustmentAmount: number; // e.g., -500000 to deduct from next OTA payout
  reason: string;
  accountingLockDate?: string | null;
  actor: ActorInfo;
}): Promise<OtaAdjustment> {
  const { booking, adjustmentAmount, reason, actor } = params;
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do điều chỉnh công nợ OTA.');
  const cleanAmount = Math.round(adjustmentAmount);
  if (cleanAmount === 0) throw new Error('Số tiền điều chỉnh công nợ OTA phải khác 0.');

  const now = new Date().toISOString();
  const { postingDate } = resolveAccountingPostingDate(
    booking.checkOut,
    params.accountingLockDate
  );

  const id = generateId('otaadj');
  const adj: OtaAdjustment = {
    id,
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    otaChannel: booking.otaChannel || booking.sourceLabel || 'OTA',
    payoutBatchId: booking.payoutBatchId || null,
    adjustmentAmount: cleanAmount,
    accountingDate: postingDate,
    status: 'pending_next_payout',
    appliedBatchId: null,
    reason: reason.trim(),
    createdByUid: actor.uid,
    createdByName: actor.name,
    createdAt: now,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'ota_adjustments', id), adj);
  await batch.commit();

  await writeAuditLog({
    actionType: 'ota_adjustment',
    targetId: booking.id,
    targetLabel: `Điều chỉnh Công nợ OTA kỳ sau ${booking.bookingCode} (${cleanAmount.toLocaleString('vi-VN')}đ)`,
    previousState: { payoutBatchId: booking.payoutBatchId || null, otaSettlementStatus: booking.otaSettlementStatus },
    newState: { otaAdjustmentId: id, adjustmentAmount: cleanAmount, accountingDate: postingDate },
    reason: reason.trim(),
    actor,
  });

  return adj;
}
