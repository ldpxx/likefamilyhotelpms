import React, { useMemo, useState } from 'react';
import { AlertTriangle, Lock, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, DepositResolutionStatus, PaymentMethod } from '../types/pms';
import {
  addDays,
  diffDays,
  formatCurrency,
  formatDateVN,
  getStatusLabel,
  isBookingBlockingCalendar,
  isDateRangeOverlap,
  sumDailyRates,
  todayISO,
} from '../lib/utils';
import {
  createOtaPostReconciledAdjustment,
  executeEarlyCheckOut,
  recordPostCheckoutAdjustment,
  reopenCheckedOutBooking,
  resolveAccountingPostingDate,
  reverseCheckInBooking,
  voidCheckedOutBooking,
} from '../lib/postStayActions';
import { DateInputVN } from './DateInputVN';

export type PostStayModalMode =
  | 'reverse_checkin'
  | 'early_checkout'
  | 'reopen_checked_out'
  | 'void_checked_out'
  | 'post_checkout_adjustment';

interface PostStayAccountingModalProps {
  booking: Booking;
  mode: PostStayModalMode;
  onClose: () => void;
  onProceedToCancelAfterReverse?: () => void;
}

export const PostStayAccountingModal: React.FC<PostStayAccountingModalProps> = ({
  booking,
  mode,
  onClose,
  onProceedToCancelAfterReverse,
}) => {
  const { activeRooms, bookings, hotelConfig, actor, notify } = usePms();
  const today = todayISO();

  // Reverse Check-in state (Rule 1)
  const [roomWasUsed, setRoomWasUsed] = useState(false);
  const [chainToCancel, setChainToCancel] = useState(false);

  // Early Check-out state (Rule 2)
  const stayedNights = Math.max(1, diffDays(booking.checkIn, today));
  const earlyNewGross = sumDailyRates(
    booking.dailyRates.slice(0, stayedNights).length > 0
      ? booking.dailyRates.slice(0, stayedNights)
      : booking.dailyRates.slice(0, 1)
  );
  const earlyFinalTotal =
    earlyNewGross + (booking.serviceTotal || 0) + (booking.hourlySurcharge || 0);
  const totalPaid = (booking.depositPaid || 0) + (booking.guestPaid || 0);
  const earlyExcess = Math.max(0, totalPaid - earlyFinalTotal);
  const [earlyExcessAction, setEarlyExcessAction] = useState<
    Extract<DepositResolutionStatus, 'refunded' | 'pending_deposit_resolution' | 'transferred_to_booking'>
  >('refunded');
  const [earlyRefundMethod, setEarlyRefundMethod] = useState<PaymentMethod>('cash');
  const [earlyTransferTargetId, setEarlyTransferTargetId] = useState('');

  // Reopen Checked-out state (Rule 5)
  const [reopenMode, setReopenMode] = useState<'billing_only' | 'reopen_stay'>('billing_only');
  const [reopenCheckOut, setReopenCheckOut] = useState(
    booking.checkOut > today ? booking.checkOut : addDays(today, 1)
  );

  // Void Checked-out state (Rule 4 & Rule 7 + Split-Stay Chain Scope)
  const splitStayOtherLegs = useMemo(() => {
    if (!booking.bookingChainId) return [];
    return bookings
      .filter(
        (b) =>
          b.bookingChainId === booking.bookingChainId &&
          b.id !== booking.id &&
          b.status !== 'cancelled' &&
          b.status !== 'no_show'
      )
      .sort((a, b) => (a.chainSequence || 1) - (b.chainSequence || 1));
  }, [bookings, booking.bookingChainId, booking.id]);

  const [voidChainScope, setVoidChainScope] = useState<'current_leg_only' | 'entire_chain'>(
    'current_leg_only'
  );
  const voidScopeBookings = useMemo(
    () => (voidChainScope === 'entire_chain' ? [...splitStayOtherLegs, booking] : [booking]),
    [voidChainScope, splitStayOtherLegs, booking]
  );
  const voidScopeTotalPaid = useMemo(
    () => voidScopeBookings.reduce((s, b) => s + (b.depositPaid || 0) + (b.guestPaid || 0), 0),
    [voidScopeBookings]
  );

  const isSettledOta =
    (booking.source === 'ota' || booking.paymentMethod === 'ota_debt') &&
    (booking.otaSettlementStatus === 'settled' || Boolean(booking.payoutBatchId));
  const [voidPaidDisposition, setVoidPaidDisposition] = useState<
    'void_receipt_entry' | 'actual_refund' | 'ota_adjustment_only'
  >(isSettledOta ? 'ota_adjustment_only' : 'void_receipt_entry');
  const [voidRefundMethod, setVoidRefundMethod] = useState<PaymentMethod>('cash');
  const [createOtaAdjToo, setCreateOtaAdjToo] = useState(isSettledOta);
  const [otaAdjAmount, setOtaAdjAmount] = useState(-Math.abs(booking.grossRoomTotal || 0));

  // Post-checkout adjustment state (Rule 6)
  const [adjItemLabel, setAdjItemLabel] = useState('');
  const [adjDelta, setAdjDelta] = useState(0);
  const [adjSettleNow, setAdjSettleNow] = useState(true);
  const [adjMethod, setAdjMethod] = useState<PaymentMethod>('cash');

  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const lockInfo = resolveAccountingPostingDate(
    booking.checkOut,
    hotelConfig.accountingLockDate
  );

  const activeBookingsOther = useMemo(
    () =>
      bookings.filter(
        (b) => b.id !== booking.id && (b.status === 'reserved' || b.status === 'in_house')
      ),
    [bookings, booking.id]
  );

  // Room conflict check for Reopen Stay (Rule 5)
  const originalRoom = activeRooms.find((r) => r.id === booking.roomId);
  const reopenOriginalConflict = useMemo(() => {
    if (!originalRoom || originalRoom.hkStatus === 'maintenance') return true;
    return bookings.some(
      (b) =>
        b.id !== booking.id &&
        b.roomId === originalRoom.id &&
        isBookingBlockingCalendar(b.status) &&
        isDateRangeOverlap(b.checkIn, b.checkOut, today, reopenCheckOut)
    );
  }, [originalRoom, bookings, booking.id, today, reopenCheckOut]);

  const freeRoomsForReopen = useMemo(() => {
    return activeRooms.filter((r) => {
      if (r.hkStatus === 'maintenance') return false;
      return !bookings.some(
        (b) =>
          b.id !== booking.id &&
          b.roomId === r.id &&
          isBookingBlockingCalendar(b.status) &&
          isDateRangeOverlap(b.checkIn, b.checkOut, today, reopenCheckOut)
      );
    });
  }, [activeRooms, bookings, booking.id, today, reopenCheckOut]);

  const [reopenRoomId, setReopenRoomId] = useState<string>(
    !reopenOriginalConflict && originalRoom
      ? originalRoom.id
      : freeRoomsForReopen[0]?.id || ''
  );

  const currentOldTotal =
    (booking.grossRoomTotal || 0) + (booking.serviceTotal || 0) + (booking.hourlySurcharge || 0);

  const titleMap: Record<PostStayModalMode, string> = {
    reverse_checkin: `Đảo Check-in nhầm — ${booking.bookingCode} (P.${booking.roomNumber})`,
    early_checkout: `Chốt Trả phòng sớm — ${booking.bookingCode} (P.${booking.roomNumber})`,
    reopen_checked_out: `Mở lại đơn Đã trả phòng — ${booking.bookingCode}`,
    void_checked_out: `Hủy đơn Đã trả phòng (Void Checked-out) — ${booking.bookingCode}`,
    post_checkout_adjustment: `Điều chỉnh & Phụ thu sau Check-out — ${booking.bookingCode}`,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      notify('Bắt buộc nhập lý do để ghi vào nhật ký kiểm toán audit_logs', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'reverse_checkin') {
        await reverseCheckInBooking({ booking, roomWasUsed, reason, actor });
        notify(
          `Đã đảo Check-in P.${booking.roomNumber} về Chờ nhận phòng (${
            roomWasUsed ? 'Phòng chuyển Chờ dọn - Dirty' : 'Giữ Sạch - Clean'
          })`
        );
        onClose();
        if (chainToCancel) onProceedToCancelAfterReverse?.();
        return;
      }

      if (mode === 'early_checkout') {
        const res = await executeEarlyCheckOut({
          booking,
          excessAction: earlyExcess > 0 ? earlyExcessAction : 'none',
          refundMethod: earlyExcessAction === 'refunded' ? earlyRefundMethod : undefined,
          transferTargetBooking:
            earlyExcessAction === 'transferred_to_booking'
              ? activeBookingsOther.find((b) => b.id === earlyTransferTargetId) || null
              : null,
          reason,
          accountingLockDate: hotelConfig.accountingLockDate,
          actor,
        });
        notify(
          `Đã chốt trả phòng sớm (${res.stayedNights} đêm)${
            res.excessAmount > 0
              ? ` • Đã xử lý tiền dư ${formatCurrency(res.excessAmount)}`
              : ''
          }`
        );
        onClose();
        return;
      }

      if (mode === 'reopen_checked_out') {
        const targetRoom = activeRooms.find((r) => r.id === reopenRoomId) || null;
        await reopenCheckedOutBooking({
          booking,
          mode: reopenMode,
          targetRoom: reopenMode === 'reopen_stay' ? targetRoom : null,
          newCheckOutDate: reopenMode === 'reopen_stay' ? reopenCheckOut : undefined,
          allBookings: bookings,
          reason,
          actor,
        });
        notify(
          reopenMode === 'billing_only'
            ? `Đã mở lại chế độ sửa hóa đơn (không chiếm phòng) cho ${booking.bookingCode}`
            : `Đã khôi phục khách quay lại lưu trú tại P.${targetRoom?.roomNumber}`
        );
        onClose();
        return;
      }

      if (mode === 'void_checked_out') {
        await voidCheckedOutBooking({
          booking,
          additionalChainBookings: voidChainScope === 'entire_chain' ? splitStayOtherLegs : [],
          paidDisposition: voidScopeTotalPaid > 0 ? voidPaidDisposition : 'none',
          refundMethod: voidPaidDisposition === 'actual_refund' ? voidRefundMethod : undefined,
          reason,
          accountingLockDate: hotelConfig.accountingLockDate,
          actor,
        });
        if (isSettledOta && createOtaAdjToo && otaAdjAmount !== 0) {
          await createOtaPostReconciledAdjustment({
            booking,
            adjustmentAmount: otaAdjAmount,
            reason: `Cấn trừ kỳ sau do hủy đơn OTA đã đối soát: ${reason}`,
            accountingLockDate: hotelConfig.accountingLockDate,
            actor,
          });
        }
        notify(
          voidChainScope === 'entire_chain' && splitStayOtherLegs.length > 0
            ? `Đã hủy đồng bộ toàn bộ chuỗi chuyển phòng (${voidScopeBookings.length} chặng) & loại doanh thu khỏi P&L`
            : `Đã hủy đơn đã trả phòng ${booking.bookingCode} chuẩn kế toán & lưu audit_logs`
        );
        onClose();
        return;
      }

      if (mode === 'post_checkout_adjustment') {
        const adj = await recordPostCheckoutAdjustment({
          booking,
          itemLabel: adjItemLabel,
          adjustmentDelta: adjDelta,
          settleNow: adjSettleNow,
          settlementMethod: adjMethod,
          reason,
          accountingLockDate: hotelConfig.accountingLockDate,
          actor,
        });
        notify(
          `Đã ghi nhận điều chỉnh sau Check-out (${
            adj.diffAmount > 0 ? '+' : ''
          }${formatCurrency(adj.diffAmount)})`
        );
        onClose();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi thực hiện nghiệp vụ kế toán', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 z-10 bg-white border-b border-[#E5E2DC] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'void_checked_out' ? (
              <ShieldAlert className="w-5 h-5 text-[#B91C1C]" strokeWidth={1.5} />
            ) : (
              <RotateCcw className="w-5 h-5 text-[#1B5E4B]" strokeWidth={1.5} />
            )}
            <div>
              <h2 className="text-[15px] font-semibold text-[#1C1B18]">{titleMap[mode]}</h2>
              <p className="text-[12px] text-[#57534E]">
                {booking.primaryGuestName} • {formatDateVN(booking.checkIn)} →{' '}
                {formatDateVN(booking.checkOut)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#F1EFEA] flex items-center justify-center text-[#57534E]"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Rule 8: Accounting Period Lock Warning Banner */}
          {lockInfo.isLockedOrigin && (
            <div className="p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-[12px] flex gap-2">
              <Lock className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <div className="font-semibold">Kỳ kế toán đã khóa sổ</div>
                <p>{lockInfo.lockedNotice}</p>
              </div>
            </div>
          )}

          {/* MODE 1: REVERSE CHECK-IN */}
          {mode === 'reverse_checkin' && (
            <div className="space-y-3">
              <div className="text-[13px] font-semibold text-[#1C1B18]">
                Xác nhận tình trạng thực tế của phòng P.{booking.roomNumber} (Bắt buộc)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setRoomWasUsed(false)}
                  className={`p-3.5 rounded-xl border text-left ${
                    !roomWasUsed
                      ? 'border-[#1B5E4B] bg-[#E8F2EE]/60'
                      : 'border-[#E5E2DC] bg-white'
                  }`}
                >
                  <div className="text-[13px] font-semibold text-[#1C1B18]">
                    Khách chưa vào phòng
                  </div>
                  <div className="text-[11px] text-[#57534E] mt-0.5">
                    Giữ trạng thái phòng Sạch (Clean) để bán lại ngay
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRoomWasUsed(true)}
                  className={`p-3.5 rounded-xl border text-left ${
                    roomWasUsed
                      ? 'border-[#B45309] bg-[#FFFBEB]'
                      : 'border-[#E5E2DC] bg-white'
                  }`}
                >
                  <div className="text-[13px] font-semibold text-[#1C1B18]">
                    Khách đã sử dụng phòng
                  </div>
                  <div className="text-[11px] text-[#57534E] mt-0.5">
                    Tự động bật cờ Chờ dọn phòng (Dirty) cho Buồng phòng
                  </div>
                </button>
              </div>

              {onProceedToCancelAfterReverse && (
                <label className="flex items-center gap-2 text-[12px] text-[#57534E] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={chainToCancel}
                    onChange={(e) => setChainToCancel(e.target.checked)}
                    className="accent-[#B91C1C]"
                  />
                  Mở tiếp hộp thoại Hủy đơn đặt phòng ngay sau khi đảo Check-in
                </label>
              )}
            </div>
          )}

          {/* MODE 2: EARLY CHECK-OUT */}
          {mode === 'early_checkout' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5 text-[12px]">
                <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC]">
                  <div className="text-[#57534E]">Số đêm thực ở</div>
                  <div className="font-mono-num text-[15px] font-semibold text-[#1C1B18]">
                    {stayedNights} đêm
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC]">
                  <div className="text-[#57534E]">Tổng phải trả mới</div>
                  <div className="font-mono-num text-[15px] font-semibold text-[#1B5E4B]">
                    {formatCurrency(earlyFinalTotal)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A]">
                  <div className="text-[#92400E]">Tiền dư các đêm chưa ở</div>
                  <div className="font-mono-num text-[15px] font-semibold text-[#B45309]">
                    {formatCurrency(earlyExcess)}
                  </div>
                </div>
              </div>

              {earlyExcess > 0 && (
                <div className="p-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB]/60 space-y-3">
                  <div className="text-[13px] font-semibold text-[#92400E]">
                    Phương án xử lý khoản tiền dư {formatCurrency(earlyExcess)}
                  </div>
                  <div className="space-y-1.5 text-[12px]">
                    {(
                      [
                        ['refunded', 'Hoàn trả ngay bằng Phiếu Chi thực tế (Tiền mặt / Chuyển khoản)'],
                        ['pending_deposit_resolution', 'Treo chờ xử lý hoàn tiền (Nhắc chủ khách sạn)'],
                        ['transferred_to_booking', 'Bảo lưu tiền dư sang đơn đặt phòng khác'],
                      ] as const
                    ).map(([id, label]) => (
                      <label
                        key={id}
                        className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-[#E5E2DC] cursor-pointer"
                      >
                        <input
                          type="radio"
                          checked={earlyExcessAction === id}
                          onChange={() => setEarlyExcessAction(id)}
                          className="accent-[#1B5E4B]"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>

                  {earlyExcessAction === 'refunded' && (
                    <select
                      value={earlyRefundMethod}
                      onChange={(e) => setEarlyRefundMethod(e.target.value as PaymentMethod)}
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                    >
                      <option value="cash">Hoàn bằng Tiền mặt (Trừ Quỹ tiền mặt)</option>
                      <option value="bank_transfer">Hoàn bằng Chuyển khoản ngân hàng</option>
                    </select>
                  )}

                  {earlyExcessAction === 'transferred_to_booking' && (
                    <select
                      required
                      value={earlyTransferTargetId}
                      onChange={(e) => setEarlyTransferTargetId(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                    >
                      <option value="">-- Chọn đơn đặt phòng bảo lưu --</option>
                      {activeBookingsOther.map((b) => (
                        <option key={b.id} value={b.id}>
                          P.{b.roomNumber} — {b.primaryGuestName} ({b.bookingCode})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          {/* MODE 3: REOPEN CHECKED-OUT (2 STRICT MODES) */}
          {mode === 'reopen_checked_out' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setReopenMode('billing_only')}
                  className={`p-3.5 rounded-xl border text-left ${
                    reopenMode === 'billing_only'
                      ? 'border-[#1B5E4B] bg-[#E8F2EE]/60'
                      : 'border-[#E5E2DC] bg-white'
                  }`}
                >
                  <div className="text-[13px] font-semibold text-[#1C1B18]">
                    1. Chỉ mở lại sửa Hóa đơn / Phụ thu
                  </div>
                  <div className="text-[11px] text-[#57534E] mt-0.5">
                    Tuyệt đối KHÔNG chiếm lại phòng trên Sơ đồ phòng / Timeline
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setReopenMode('reopen_stay')}
                  className={`p-3.5 rounded-xl border text-left ${
                    reopenMode === 'reopen_stay'
                      ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                      : 'border-[#E5E2DC] bg-white'
                  }`}
                >
                  <div className="text-[13px] font-semibold text-[#1C1B18]">
                    2. Khôi phục khách quay lại ở tiếp
                  </div>
                  <div className="text-[11px] text-[#57534E] mt-0.5">
                    Quét kiểm tra trùng lịch phòng; chặn phòng cũ nếu đã có khách mới
                  </div>
                </button>
              </div>

              {reopenMode === 'reopen_stay' && (
                <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] space-y-3">
                  {reopenOriginalConflict && (
                    <div className="p-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[12px] flex gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
                      <span>
                        Phòng cũ P.{booking.roomNumber} đã có khách mới hoặc bị đặt trùng. Bắt buộc
                        chọn phòng trống khác bên dưới:
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-[#57534E] mb-1">
                        Chọn phòng trống khôi phục
                      </label>
                      <select
                        required
                        value={reopenRoomId}
                        onChange={(e) => setReopenRoomId(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                      >
                        <option value="">-- Chọn phòng trống --</option>
                        {freeRoomsForReopen.map((r) => (
                          <option key={r.id} value={r.id}>
                            P.{r.roomNumber} — {r.roomTypeName}
                            {r.id === booking.roomId ? ' (Phòng cũ)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#57534E] mb-1">
                        Ngày dự kiến trả phòng mới
                      </label>
                      <DateInputVN
                        value={reopenCheckOut}
                        min={addDays(today, 1)}
                        onChange={setReopenCheckOut}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MODE 4: VOID CHECKED-OUT (NO AUTO REFUND + OTA POST-RECONCILED RULE + SPLIT-STAY CHAIN) */}
          {mode === 'void_checked_out' && (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[12px] text-[#991B1B]">
                Đơn sẽ chuyển sang trạng thái <strong>Đã hủy (Voided)</strong> và loại doanh thu
                khỏi P&amp;L. Hệ thống <strong>KHÔNG tự động tạo phiếu chi hoàn tiền</strong>.
              </div>

              {splitStayOtherLegs.length > 0 && (
                <div className="p-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB]/70 space-y-2.5 text-[12px]">
                  <div className="font-semibold text-[#92400E]">
                    Đơn thuộc chuỗi Chuyển phòng (Split-Stay — {splitStayOtherLegs.length + 1} chặng)
                  </div>
                  <div className="space-y-1 text-[11px] font-mono-num bg-white border border-[#FDE68A] rounded-lg p-2.5">
                    {[...splitStayOtherLegs, booking].map((leg) => {
                      const lp = (leg.depositPaid || 0) + (leg.guestPaid || 0);
                      return (
                        <div key={leg.id} className="flex flex-wrap justify-between gap-2">
                          <span>
                            <strong>Chặng {leg.chainSequence || 1}:</strong> {leg.bookingCode} (P.
                            {leg.roomNumber}) • {getStatusLabel(leg.status)}
                          </span>
                          <span>
                            Tiền phòng: {formatCurrency(leg.grossRoomTotal)}
                            {lp > 0 ? ` • Đã thu: ${formatCurrency(lp)}` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <label className="flex items-start gap-2 p-2.5 rounded-lg bg-white border border-[#E5E2DC] cursor-pointer">
                    <input
                      type="radio"
                      checked={voidChainScope === 'current_leg_only'}
                      onChange={() => setVoidChainScope('current_leg_only')}
                      className="accent-[#1B5E4B] mt-0.5"
                    />
                    <span>
                      <strong>Hủy riêng chặng này ({booking.bookingCode})</strong> — Giữ nguyên
                      chặng đã chuyển phòng trước đó nếu khách đã lưu trú thực tế.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 p-2.5 rounded-lg bg-white border border-[#FECACA] cursor-pointer">
                    <input
                      type="radio"
                      checked={voidChainScope === 'entire_chain'}
                      onChange={() => setVoidChainScope('entire_chain')}
                      className="accent-[#B91C1C] mt-0.5"
                    />
                    <span>
                      <strong className="text-[#B91C1C]">
                        Hủy toàn bộ chuỗi đơn (bao gồm chặng Đã chuyển phòng trước đó)
                      </strong>{' '}
                      — Đồng bộ trạng thái hủy &amp; tiền hoàn trả của cả chuỗi, loại sạch doanh thu
                      và đêm bán khỏi P&amp;L.
                    </span>
                  </label>
                </div>
              )}

              {voidScopeTotalPaid === 0 ? (
                <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] text-[12px] text-[#57534E]">
                  Phạm vi hủy đang chọn có số tiền đã thu tại quầy = <strong>0đ</strong> → Chỉ đảo
                  doanh thu &amp; công nợ về 0đ (không phát sinh phiếu chi).
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB]/60 space-y-2.5 text-[12px]">
                  <div className="font-semibold text-[#92400E]">
                    Đã ghi nhận thu {formatCurrency(voidScopeTotalPaid)}
                    {voidChainScope === 'entire_chain' && splitStayOtherLegs.length > 0
                      ? ' (Tổng toàn chuỗi)'
                      : ''}{' '}
                    — Chọn cách xử lý kế toán:
                  </div>
                  <label className="flex items-start gap-2 p-2.5 rounded-lg bg-white border border-[#E5E2DC] cursor-pointer">
                    <input
                      type="radio"
                      checked={voidPaidDisposition === 'void_receipt_entry'}
                      onChange={() => setVoidPaidDisposition('void_receipt_entry')}
                      className="accent-[#1B5E4B] mt-0.5"
                    />
                    <span>
                      <strong>Hủy bút toán ghi nhận thu sai sót (`void_receipt_entry`)</strong> — Dùng
                      khi tiền chưa từng thu thực tế (nhập nhầm/đơn test), cân bằng quỹ mà không tạo
                      giao dịch chi hoàn giả.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 p-2.5 rounded-lg bg-white border border-[#E5E2DC] cursor-pointer">
                    <input
                      type="radio"
                      checked={voidPaidDisposition === 'actual_refund'}
                      onChange={() => setVoidPaidDisposition('actual_refund')}
                      className="accent-[#1B5E4B] mt-0.5"
                    />
                    <span>
                      <strong>Xuất quỹ hoàn tiền thực tế cho khách</strong> — Chỉ chọn khi thực sự
                      chi tiền trả lại khách hàng.
                    </span>
                  </label>

                  {voidPaidDisposition === 'actual_refund' && (
                    <select
                      value={voidRefundMethod}
                      onChange={(e) => setVoidRefundMethod(e.target.value as PaymentMethod)}
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                    >
                      <option value="cash">Hoàn bằng Tiền mặt</option>
                      <option value="bank_transfer">Hoàn bằng Chuyển khoản ngân hàng</option>
                    </select>
                  )}
                </div>
              )}

              {isSettledOta && (
                <div className="p-4 rounded-xl border border-[#FED7AA] bg-[#FFF7ED] space-y-2.5 text-[12px]">
                  <div className="font-semibold text-[#9A3412]">
                    Đơn OTA đã đối soát / đã nhận tiền — Khóa xóa công nợ cũ
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-[#9A3412]">
                    <input
                      type="checkbox"
                      checked={createOtaAdjToo}
                      onChange={(e) => setCreateOtaAdjToo(e.target.checked)}
                      className="accent-[#C2410C]"
                    />
                    Lập khoản Điều chỉnh Công nợ OTA (`ota_adjustment`) cấn trừ vào kỳ thanh toán
                    tiếp theo
                  </label>
                  {createOtaAdjToo && (
                    <input
                      type="number"
                      value={otaAdjAmount}
                      onChange={(e) => setOtaAdjAmount(Number(e.target.value) || 0)}
                      className="w-full h-9 px-3 rounded-lg border border-[#FED7AA] bg-white font-mono-num text-[13px]"
                      placeholder="Số âm để trừ kỳ sau (VD: -500000)"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* MODE 5: POST-CHECKOUT ADJUSTMENT (RULE 6) */}
          {mode === 'post_checkout_adjustment' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5 text-[12px]">
                <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC]">
                  <div className="text-[#57534E]">Tổng hóa đơn cũ</div>
                  <div className="font-mono-num font-semibold text-[14px]">
                    {formatCurrency(currentOldTotal)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC]">
                  <div className="text-[#57534E]">Chênh lệch (+/-)</div>
                  <div
                    className={`font-mono-num font-semibold text-[14px] ${
                      adjDelta >= 0 ? 'text-[#1B5E4B]' : 'text-[#B91C1C]'
                    }`}
                  >
                    {adjDelta > 0 ? '+' : ''}
                    {formatCurrency(adjDelta)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#E8F2EE] border border-[#1B5E4B]/25">
                  <div className="text-[#1B5E4B]">Tổng hóa đơn mới</div>
                  <div className="font-mono-num font-semibold text-[14px] text-[#1B5E4B]">
                    {formatCurrency(Math.max(0, currentOldTotal + adjDelta))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[#57534E] mb-1">
                    Hạng mục phụ thu / điều chỉnh *
                  </label>
                  <input
                    type="text"
                    required
                    value={adjItemLabel}
                    onChange={(e) => setAdjItemLabel(e.target.value)}
                    placeholder="VD: Bồi thường làm vỡ ly, Giảm giá xử lý khiếu nại..."
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#57534E] mb-1">
                    Số tiền điều chỉnh (+ thu thêm / - giảm trừ) *
                  </label>
                  <input
                    type="number"
                    required
                    step={10000}
                    value={adjDelta || ''}
                    onChange={(e) => setAdjDelta(Number(e.target.value) || 0)}
                    placeholder="VD: 100000 hoặc -50000"
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adjSettleNow}
                    onChange={(e) => setAdjSettleNow(e.target.checked)}
                    className="accent-[#1B5E4B]"
                  />
                  Lập ngay {adjDelta >= 0 ? 'Phiếu Thu bổ sung' : 'Phiếu Chi hoàn chênh lệch'}
                </label>
                {adjSettleNow && (
                  <select
                    value={adjMethod}
                    onChange={(e) => setAdjMethod(e.target.value as PaymentMethod)}
                    className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                  >
                    <option value="cash">Tiền mặt</option>
                    <option value="bank_transfer">Chuyển khoản (VietQR)</option>
                    <option value="card">Quẹt thẻ</option>
                  </select>
                )}
              </div>
            </div>
          )}

          {/* Mandatory Audit Reason */}
          <div>
            <label className="block text-[12px] font-semibold text-[#1C1B18] mb-1">
              Lý do thực hiện (Bắt buộc — lưu vào Immutable Audit Trail) *
            </label>
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ghi rõ lý do kế toán để chủ khách sạn đối chiếu..."
              className="w-full p-2.5 rounded-xl border border-[#E5E2DC] text-[13px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[#E5E2DC]">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-[#E5E2DC] text-[13px]"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`h-9 px-5 rounded-lg text-white text-[13px] font-medium disabled:opacity-50 ${
                mode === 'void_checked_out'
                  ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
                  : 'bg-[#1B5E4B] hover:bg-[#144839]'
              }`}
            >
              {saving ? 'Đang xử lý...' : 'Xác nhận & Ghi nhật ký'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
