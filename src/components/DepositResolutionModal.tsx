import React, { useMemo, useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, DepositResolutionStatus, PaymentMethod } from '../types/pms';
import { formatCurrency, formatDateVN } from '../lib/utils';
import { resolvePendingDeposit } from '../lib/cancellationActions';

interface DepositResolutionModalProps {
  booking: Booking;
  onClose: () => void;
}

export const DepositResolutionModal: React.FC<DepositResolutionModalProps> = ({
  booking,
  onClose,
}) => {
  const { bookings, actor, notify } = usePms();
  const [resolution, setResolution] = useState<
    Extract<DepositResolutionStatus, 'refunded' | 'forfeited_fee' | 'transferred_to_booking'>
  >('refunded');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('bank_transfer');
  const [transferTargetId, setTransferTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const pendingAmount =
    booking.pendingDepositAmount || (booking.depositPaid || 0) + (booking.guestPaid || 0);

  const activeTargets = useMemo(
    () =>
      bookings.filter(
        (b) => b.id !== booking.id && (b.status === 'reserved' || b.status === 'in_house')
      ),
    [bookings, booking.id]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await resolvePendingDeposit({
        booking,
        resolution,
        refundMethod: resolution === 'refunded' ? refundMethod : undefined,
        transferTargetBooking:
          resolution === 'transferred_to_booking'
            ? activeTargets.find((b) => b.id === transferTargetId) || null
            : null,
        reason,
        actor,
      });
      notify(`Đã chốt xử lý khoản tiền cọc treo ${formatCurrency(pendingAmount)} cho ${booking.bookingCode}`);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi xử lý tiền cọc', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E2DC] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-[#B45309]" strokeWidth={1.5} />
            <div>
              <h2 className="text-[15px] font-semibold text-[#1C1B18]">
                Chốt xử lý tiền cọc treo — {booking.bookingCode}
              </h2>
              <p className="text-[12px] text-[#57534E]">
                P.{booking.roomNumber} • {booking.primaryGuestName} • Treo:{' '}
                <strong className="font-mono-num text-[#B45309]">
                  {formatCurrency(pendingAmount)}
                </strong>
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
          <div className="space-y-2">
            {(
              [
                ['refunded', 'Hoàn trả tiền cọc cho khách (Lập Phiếu Chi hoàn cọc)'],
                ['forfeited_fee', 'Giữ cọc tính vào Doanh thu phí hủy'],
                ['transferred_to_booking', 'Chuyển cọc sang đơn đặt phòng khác'],
              ] as const
            ).map(([id, label]) => (
              <label
                key={id}
                className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer text-[13px] ${
                  resolution === id
                    ? 'border-[#1B5E4B] bg-[#E8F2EE]/50 font-medium'
                    : 'border-[#E5E2DC] bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="depositRes"
                  checked={resolution === id}
                  onChange={() => setResolution(id)}
                  className="accent-[#1B5E4B]"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {resolution === 'refunded' && (
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Phương thức hoàn tiền (độc lập với cách thu cọc ban đầu)
              </label>
              <select
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="bank_transfer">Chuyển khoản ngân hàng</option>
                <option value="cash">Tiền mặt tại quầy</option>
              </select>
            </div>
          )}

          {resolution === 'transferred_to_booking' && (
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Chọn đơn đặt phòng nhận cọc
              </label>
              <select
                required
                value={transferTargetId}
                onChange={(e) => setTransferTargetId(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="">-- Chọn đơn đặt phòng --</option>
                {activeTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    P.{t.roomNumber} — {t.primaryGuestName} ({t.bookingCode} •{' '}
                    {formatDateVN(t.checkIn)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-[#57534E] mb-1">
              Lý do / Quyết định xử lý (Bắt buộc) *
            </label>
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Chủ khách sạn duyệt hoàn 100% cọc qua chuyển khoản..."
              className="w-full p-2.5 rounded-xl border border-[#E5E2DC] text-[13px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-[#E5E2DC] text-[13px]"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium"
            >
              {saving ? 'Đang xử lý...' : 'Xác nhận chốt tiền cọc'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
