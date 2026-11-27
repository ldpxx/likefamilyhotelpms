import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Lock, ShieldAlert, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type {
  Booking,
  CancellationType,
  DepositResolutionStatus,
  OtaCancelStatus,
  PaymentMethod,
} from '../types/pms';
import { formatCurrency, formatDateVN, getStatusLabel } from '../lib/utils';
import { executeAccountingCancellation } from '../lib/cancellationActions';

interface CancelBookingModalProps {
  /** Single booking OR all active bookings of a group for partial cancellation */
  bookingsScope: Booking[];
  initialSelectedIds?: string[];
  isGroupMode?: boolean;
  onClose: () => void;
  onDone?: () => void;
}

export const CancelBookingModal: React.FC<CancelBookingModalProps> = ({
  bookingsScope,
  initialSelectedIds,
  isGroupMode = false,
  onClose,
  onDone,
}) => {
  const { bookings: allBookings, actor, notify } = usePms();

  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialSelectedIds || bookingsScope.map((b) => b.id)
  );
  const [chainCancelScope, setChainCancelScope] = useState<'current_leg_only' | 'entire_chain'>(
    'current_leg_only'
  );
  const [cancellationType, setCancellationType] =
    useState<CancellationType>('customer_cancelled');
  const [reason, setReason] = useState('');
  const [depositAction, setDepositAction] = useState<DepositResolutionStatus>(
    'pending_deposit_resolution'
  );
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [transferTargetId, setTransferTargetId] = useState('');
  const [otaInitialStatus, setOtaInitialStatus] = useState<
    Extract<OtaCancelStatus, 'ota_cancel_requested' | 'ota_cancel_confirmed'>
  >('ota_cancel_requested');
  const [submitting, setSubmitting] = useState(false);

  // Detect Split-Stay Chain legs when cancelling a booking that belongs to a room-transfer chain
  const splitStayChainLegs = useMemo(() => {
    if (isGroupMode || bookingsScope.length !== 1) return [];
    const root = bookingsScope[0];
    if (!root?.bookingChainId) return [];
    return allBookings
      .filter(
        (b) =>
          b.bookingChainId === root.bookingChainId &&
          b.status !== 'cancelled' &&
          b.status !== 'no_show'
      )
      .sort((a, b) => (a.chainSequence || 1) - (b.chainSequence || 1));
  }, [allBookings, bookingsScope, isGroupMode]);

  const isSplitStayChainMode = splitStayChainLegs.length > 1;

  const selectedBookings = useMemo(() => {
    if (isSplitStayChainMode) {
      return chainCancelScope === 'entire_chain' ? splitStayChainLegs : [bookingsScope[0]];
    }
    return bookingsScope.filter((b) => selectedIds.includes(b.id));
  }, [isSplitStayChainMode, chainCancelScope, splitStayChainLegs, bookingsScope, selectedIds]);

  const totalPaid = useMemo(
    () =>
      selectedBookings.reduce((sum, b) => sum + (b.depositPaid || 0) + (b.guestPaid || 0), 0),
    [selectedBookings]
  );

  const hasOtaBooking = selectedBookings.some(
    (b) => b.source === 'ota' || b.paymentMethod === 'ota_debt'
  );
  const isPartialCancel =
    isGroupMode && selectedBookings.length > 0 && selectedBookings.length < bookingsScope.length;

  // Active bookings eligible to receive transferred deposit (prioritizing remaining rooms in same group!)
  const transferTargets = useMemo(() => {
    const cancelSet = new Set(selectedBookings.map((b) => b.id));
    const list = allBookings.filter(
      (b) => !cancelSet.has(b.id) && (b.status === 'reserved' || b.status === 'in_house')
    );
    const groupId = selectedBookings[0]?.groupId;
    if (groupId) {
      list.sort((a, b) => {
        const aSame = a.groupId === groupId ? 1 : 0;
        const bSame = b.groupId === groupId ? 1 : 0;
        return bSame - aSame;
      });
    }
    return list;
  }, [allBookings, selectedBookings]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Rule 3 enforcement: automatically leave void_entry_error if totalPaid > 0
  const effectiveCancelType: CancellationType =
    totalPaid > 0 && cancellationType === 'void_entry_error'
      ? 'customer_cancelled'
      : cancellationType;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBookings.length === 0) {
      notify('Vui lòng chọn ít nhất 1 phòng để hủy', 'warning');
      return;
    }
    if (!reason.trim()) {
      notify('Bắt buộc nhập lý do hủy đơn', 'warning');
      return;
    }
    const targetBooking =
      depositAction === 'transferred_to_booking'
        ? transferTargets.find((b) => b.id === transferTargetId) || null
        : null;

    setSubmitting(true);
    try {
      await executeAccountingCancellation({
        bookingsToCancel: selectedBookings,
        isPartialGroupCancel: isPartialCancel,
        isSplitStayChainCancel: isSplitStayChainMode && chainCancelScope === 'entire_chain',
        cancellationType: effectiveCancelType,
        reason,
        depositAction: totalPaid > 0 ? depositAction : 'none',
        refundMethod: depositAction === 'refunded' ? refundMethod : undefined,
        transferTargetBooking: targetBooking,
        otaInitialCancelStatus: hasOtaBooking ? otaInitialStatus : undefined,
        actor,
      });
      notify(
        isSplitStayChainMode && chainCancelScope === 'entire_chain'
          ? `Đã hủy đồng bộ toàn bộ chuỗi chuyển phòng (${selectedBookings.length} chặng) & loại doanh thu khỏi P&L`
          : isPartialCancel
          ? `Đã hủy một phần ${selectedBookings.length}/${bookingsScope.length} phòng và giải phóng phòng trống`
          : `Đã xử lý hủy ${selectedBookings.length} phòng chuẩn kế toán & lưu nhật ký audit_logs`
      );
      onDone?.();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi hủy đặt phòng', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 z-10 bg-white border-b border-[#E5E2DC] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-[#B91C1C]" strokeWidth={1.5} />
            <div>
              <h2 className="text-[16px] font-semibold text-[#1C1B18]">
                {isGroupMode
                  ? 'Hủy một phần / Toàn bộ đơn Khách đoàn'
                  : `Hủy đơn đặt phòng ${bookingsScope[0]?.bookingCode || ''}`}
              </h2>
              <p className="text-[12px] text-[#57534E]">
                Giải phóng phòng ngay lập tức • Không xóa hay sửa giao dịch tài chính gốc
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

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Split-Stay Chain Cancellation Scope Selector */}
          {isSplitStayChainMode && (
            <div className="p-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB]/60 space-y-3">
              <div>
                <div className="text-[13px] font-semibold text-[#92400E]">
                  Đơn thuộc chuỗi Chuyển phòng (Split-Stay — {splitStayChainLegs.length} chặng)
                </div>
                <p className="text-[11px] text-[#92400E] mt-0.5">
                  Chọn rõ phạm vi hủy để đồng bộ trạng thái, số tiền hoàn trả và Báo cáo Lãi/Lỗ
                  (P&amp;L):
                </p>
              </div>
              <div className="space-y-1.5 text-[11px] font-mono-num bg-white border border-[#FDE68A] rounded-lg p-2.5">
                {splitStayChainLegs.map((leg) => {
                  const legPaid = (leg.depositPaid || 0) + (leg.guestPaid || 0);
                  return (
                    <div key={leg.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong>Chặng {leg.chainSequence || 1}:</strong> {leg.bookingCode} (P.
                        {leg.roomNumber}) • {getStatusLabel(leg.status)}
                      </span>
                      <span>
                        Tiền phòng: {formatCurrency(leg.grossRoomTotal)}
                        {legPaid > 0 ? ` • Đã thu: ${formatCurrency(legPaid)}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[12px]">
                <label
                  className={`p-3 rounded-xl border cursor-pointer flex items-start gap-2 ${
                    chainCancelScope === 'current_leg_only'
                      ? 'border-[#1B5E4B] bg-white'
                      : 'border-[#E5E2DC] bg-white/70'
                  }`}
                >
                  <input
                    type="radio"
                    checked={chainCancelScope === 'current_leg_only'}
                    onChange={() => setChainCancelScope('current_leg_only')}
                    className="accent-[#1B5E4B] mt-0.5"
                  />
                  <span>
                    <strong className="text-[#1C1B18]">Hủy riêng chặng hiện tại</strong>
                    <span className="block text-[11px] text-[#57534E] mt-0.5">
                      Chỉ hủy {bookingsScope[0]?.bookingCode}; giữ nguyên doanh thu chặng đã chuyển
                      phòng trước đó vì khách đã ở thực tế.
                    </span>
                  </span>
                </label>
                <label
                  className={`p-3 rounded-xl border cursor-pointer flex items-start gap-2 ${
                    chainCancelScope === 'entire_chain'
                      ? 'border-[#B91C1C] bg-[#FEF2F2]/70'
                      : 'border-[#E5E2DC] bg-white/70'
                  }`}
                >
                  <input
                    type="radio"
                    checked={chainCancelScope === 'entire_chain'}
                    onChange={() => setChainCancelScope('entire_chain')}
                    className="accent-[#B91C1C] mt-0.5"
                  />
                  <span>
                    <strong className="text-[#B91C1C]">
                      Hủy toàn bộ chuỗi đơn ({splitStayChainLegs.length} chặng)
                    </strong>
                    <span className="block text-[11px] text-[#57534E] mt-0.5">
                      Hủy đồng bộ cả chặng Đã chuyển phòng trước đó (nếu khách chưa ở / hoàn tiền
                      100%), loại toàn bộ doanh thu &amp; đêm bán khỏi P&amp;L.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Rule 1: Partial Cancellation Room Picker */}
          {bookingsScope.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold text-[#1C1B18]">
                  Chọn các phòng muốn hủy ({selectedIds.length} / {bookingsScope.length} phòng)
                </span>
                <span className="text-[#57534E]">
                  Các phòng không chọn sẽ giữ nguyên lịch trình & tự tính lại tổng đoàn
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {bookingsScope.map((b) => {
                  const checked = selectedIds.includes(b.id);
                  const bPaid = (b.depositPaid || 0) + (b.guestPaid || 0);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleSelect(b.id)}
                      className={`p-3 rounded-xl border text-left flex items-start justify-between gap-2 transition-colors ${
                        checked
                          ? 'border-[#B91C1C] bg-[#FEF2F2]/60'
                          : 'border-[#E5E2DC] bg-white hover:bg-[#FAF9F6]'
                      }`}
                    >
                      <div>
                        <div className="font-mono-num text-[13px] font-semibold text-[#1C1B18]">
                          P.{b.roomNumber} • {b.bookingCode}
                        </div>
                        <div className="text-[11px] font-mono-num text-[#57534E]">
                          {formatDateVN(b.checkIn)} → {formatDateVN(b.checkOut)}
                        </div>
                        <div className="text-[11px] font-mono-num text-[#1B5E4B]">
                          Giá: {formatCurrency(b.grossRoomTotal)}
                          {bPaid > 0 ? ` • Đã cọc/thu: ${formatCurrency(bPaid)}` : ''}
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
                          checked
                            ? 'bg-[#B91C1C] border-[#B91C1C] text-white'
                            : 'border-[#D0CBC2] bg-white'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" strokeWidth={2} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rule 2 & Rule 3: Cancellation Classification */}
          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-[#1C1B18]">
              1. Phân loại hình thức hủy (Xác nhận thủ công)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setCancellationType('customer_cancelled')}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  effectiveCancelType === 'customer_cancelled'
                    ? 'border-[#1B5E4B] bg-[#E8F2EE]/60'
                    : 'border-[#E5E2DC] bg-white hover:bg-[#FAF9F6]'
                }`}
              >
                <div className="text-[13px] font-semibold text-[#1C1B18]">Khách báo hủy</div>
                <div className="text-[11px] text-[#57534E] mt-0.5">
                  Khách chủ động thông báo hủy lịch đặt phòng
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCancellationType('no_show')}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  effectiveCancelType === 'no_show'
                    ? 'border-[#B45309] bg-[#FFFBEB]'
                    : 'border-[#E5E2DC] bg-white hover:bg-[#FAF9F6]'
                }`}
              >
                <div className="text-[13px] font-semibold text-[#1C1B18]">
                  Khách không đến (No-show)
                </div>
                <div className="text-[11px] text-[#57534E] mt-0.5">
                  Đã kiểm tra thực tế và xác nhận khách không tới
                </div>
              </button>

              <button
                type="button"
                disabled={totalPaid > 0}
                onClick={() => setCancellationType('void_entry_error')}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  totalPaid > 0
                    ? 'border-[#E5E2DC] bg-[#F1EFEA] opacity-60 cursor-not-allowed'
                    : effectiveCancelType === 'void_entry_error'
                    ? 'border-[#1C1B18] bg-[#FAF9F6]'
                    : 'border-[#E5E2DC] bg-white hover:bg-[#FAF9F6]'
                }`}
              >
                <div className="text-[13px] font-semibold text-[#1C1B18] flex items-center gap-1">
                  {totalPaid > 0 && <Lock className="w-3.5 h-3.5 text-[#B91C1C]" strokeWidth={1.5} />}
                  Hủy do Nhập sai (Void)
                </div>
                <div className="text-[11px] text-[#57534E] mt-0.5">
                  {totalPaid > 0
                    ? 'Bị khóa vì đơn đã phát sinh giao dịch tiền'
                    : 'Chỉ áp dụng khi chưa thu bất kỳ đồng cọc nào'}
                </div>
              </button>
            </div>
          </div>

          {/* Rule 4 & Rule 5: Deposit Handling (if totalPaid > 0) */}
          {totalPaid > 0 && (
            <div className="p-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB]/60 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-semibold text-[#92400E]">
                  2. Xử lý khoản tiền đã thu / tiền cọc (Tổng: {formatCurrency(totalPaid)})
                </div>
                <span className="text-[11px] text-[#92400E]">
                  Giao dịch thu gốc được giữ nguyên — tạo bút toán đối ứng
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(
                  [
                    {
                      id: 'pending_deposit_resolution',
                      title: 'Chờ xử lý tiền cọc (Treo cọc)',
                      desc: 'Giải phóng phòng ngay, treo tiền cọc chờ chủ KS quyết định (không tính doanh thu)',
                    },
                    {
                      id: 'refunded',
                      title: 'Hoàn trả tiền cọc cho khách',
                      desc: 'Lập Phiếu Chi hoàn cọc — chọn độc lập Tiền mặt hoặc Chuyển khoản',
                    },
                    {
                      id: 'forfeited_fee',
                      title: 'Giữ cọc tính vào Doanh thu phí hủy',
                      desc: 'Kết chuyển toàn bộ tiền cọc vào khoản doanh thu phí hủy đơn',
                    },
                    {
                      id: 'transferred_to_booking',
                      title: 'Chuyển cọc sang đơn đặt phòng khác',
                      desc: 'Chuyển tiền cọc sang phòng khác trong đoàn hoặc đơn đặt mới',
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDepositAction(opt.id)}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      depositAction === opt.id
                        ? 'border-[#1B5E4B] bg-white shadow-xs'
                        : 'border-[#E5E2DC] bg-white/70 hover:bg-white'
                    }`}
                  >
                    <div className="text-[12px] font-semibold text-[#1C1B18]">{opt.title}</div>
                    <div className="text-[11px] text-[#57534E] mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>

              {/* Independent Refund Method */}
              {depositAction === 'refunded' && (
                <div className="pt-2 border-t border-[#FDE68A] flex flex-wrap items-center gap-3">
                  <label className="text-[12px] font-medium text-[#92400E]">
                    Phương thức hoàn tiền (độc lập với cách thu ban đầu):
                  </label>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                    className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] font-medium"
                  >
                    <option value="cash">Hoàn bằng Tiền mặt (Trừ Quỹ tiền mặt)</option>
                    <option value="bank_transfer">
                      Hoàn bằng Chuyển khoản (Trừ Tài khoản ngân hàng)
                    </option>
                  </select>
                </div>
              )}

              {/* Transfer Deposit Target Booking */}
              {depositAction === 'transferred_to_booking' && (
                <div className="pt-2 border-t border-[#FDE68A] space-y-1.5">
                  <label className="block text-[12px] font-medium text-[#92400E]">
                    Chọn đơn đặt phòng đích nhận tiền cọc:
                  </label>
                  <select
                    required
                    value={transferTargetId}
                    onChange={(e) => setTransferTargetId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  >
                    <option value="">-- Chọn đơn đặt phòng đang hoạt động --</option>
                    {transferTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        P.{t.roomNumber} — {t.primaryGuestName} ({t.bookingCode} •{' '}
                        {formatDateVN(t.checkIn)} → {formatDateVN(t.checkOut)})
                        {t.groupName ? ` [${t.groupName}]` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Rule 7: OTA Cancellation Workflow */}
          {hasOtaBooking && (
            <div className="p-4 rounded-xl border border-[#FED7AA] bg-[#FFF7ED] space-y-2.5 text-[12px]">
              <div className="flex items-start gap-2 text-[#9A3412]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
                <div>
                  <div className="font-semibold">
                    Quy trình Hủy riêng cho Đơn OTA (Không tự động xóa Công nợ OTA)
                  </div>
                  <p className="mt-0.5">
                    Công nợ OTA sẽ được giữ lại ở mục Đối soát OTA cho đến khi có xác nhận hủy miễn
                    phí (điều chỉnh về 0đ) hoặc xác nhận giữ phí phạt từ kênh OTA.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setOtaInitialStatus('ota_cancel_requested')}
                  className={`h-8 px-3 rounded-lg border font-medium ${
                    otaInitialStatus === 'ota_cancel_requested'
                      ? 'bg-[#C2410C] text-white border-[#C2410C]'
                      : 'bg-white text-[#9A3412] border-[#FED7AA]'
                  }`}
                >
                  1. Yêu cầu hủy OTA (`ota_cancel_requested`)
                </button>
                <button
                  type="button"
                  onClick={() => setOtaInitialStatus('ota_cancel_confirmed')}
                  className={`h-8 px-3 rounded-lg border font-medium ${
                    otaInitialStatus === 'ota_cancel_confirmed'
                      ? 'bg-[#C2410C] text-white border-[#C2410C]'
                      : 'bg-white text-[#9A3412] border-[#FED7AA]'
                  }`}
                >
                  2. OTA đã xác nhận hủy (`ota_cancel_confirmed`)
                </button>
              </div>
            </div>
          )}

          {/* Rule 8: Mandatory Reason */}
          <div>
            <label className="block text-[12px] font-semibold text-[#1C1B18] mb-1">
              Lý do hủy đơn (Bắt buộc — lưu vết vĩnh viễn vào audit_logs) *
            </label>
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Khách báo hủy do thay đổi lịch bay; Đã gọi 3 lần lúc 21:00 khách xác nhận không đến..."
              className="w-full p-3 rounded-xl border border-[#E5E2DC] text-[13px] focus:outline-none focus:border-[#1B5E4B]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E5E2DC]">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-[#E5E2DC] text-[13px] font-medium text-[#57534E]"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={submitting || selectedBookings.length === 0}
              className="h-9 px-5 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[13px] font-medium"
            >
              {submitting
                ? 'Đang xử lý...'
                : isPartialCancel
                ? `Xác nhận hủy ${selectedBookings.length} phòng đã chọn`
                : 'Xác nhận hủy đơn & Giải phóng phòng'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
