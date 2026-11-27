import React, { useMemo, useState } from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking } from '../types/pms';
import {
  formatDateVN,
  isBookingBlockingCalendar,
  isDateRangeOverlap,
} from '../lib/utils';
import { restoreCancelledBooking } from '../lib/cancellationActions';

interface UndoCancelModalProps {
  booking: Booking;
  onClose: () => void;
}

export const UndoCancelModal: React.FC<UndoCancelModalProps> = ({ booking, onClose }) => {
  const { activeRooms, bookings, actor, notify } = usePms();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const originalRoom = activeRooms.find((r) => r.id === booking.roomId);

  const originalRoomConflict = useMemo(() => {
    if (!originalRoom || originalRoom.hkStatus === 'maintenance') return true;
    return bookings.some(
      (b) =>
        b.id !== booking.id &&
        b.roomId === originalRoom.id &&
        isBookingBlockingCalendar(b.status) &&
        isDateRangeOverlap(b.checkIn, b.checkOut, booking.checkIn, booking.checkOut)
    );
  }, [originalRoom, bookings, booking]);

  const availableAlternativeRooms = useMemo(() => {
    return activeRooms.filter((r) => {
      if (r.hkStatus === 'maintenance') return false;
      const conflict = bookings.some(
        (b) =>
          b.id !== booking.id &&
          b.roomId === r.id &&
          isBookingBlockingCalendar(b.status) &&
          isDateRangeOverlap(b.checkIn, b.checkOut, booking.checkIn, booking.checkOut)
      );
      return !conflict;
    });
  }, [activeRooms, bookings, booking]);

  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    !originalRoomConflict && originalRoom
      ? originalRoom.id
      : availableAlternativeRooms[0]?.id || ''
  );

  const depositAlreadyGone =
    booking.depositResolutionStatus === 'refunded' ||
    booking.depositResolutionStatus === 'transferred_to_booking';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetRoom = activeRooms.find((r) => r.id === selectedRoomId);
    if (!targetRoom) {
      notify('Không có phòng trống khả dụng để khôi phục đơn này', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await restoreCancelledBooking({
        booking,
        targetRoom,
        allBookings: bookings,
        reason,
        actor,
      });
      notify(
        res.depositWasResetToZero
          ? `Đã khôi phục đơn ${booking.bookingCode} vào P.${targetRoom.roomNumber} (Tiền đã thu đặt về 0đ do cọc cũ đã hoàn/chuyển)`
          : `Đã khôi phục đơn ${booking.bookingCode} vào P.${targetRoom.roomNumber}`
      );
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi khôi phục đơn', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E2DC] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-[#1B5E4B]" strokeWidth={1.5} />
            <div>
              <h2 className="text-[15px] font-semibold text-[#1C1B18]">
                Khôi phục đơn đã hủy (Undo Cancel) — {booking.bookingCode}
              </h2>
              <p className="text-[12px] text-[#57534E] font-mono-num">
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
          {originalRoomConflict ? (
            <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[12px] flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <div className="font-semibold">
                  Phòng cũ P.{booking.roomNumber} đã có khách đặt/ở trong khoảng ngày này
                </div>
                <p className="mt-0.5">
                  Hệ thống chặn khôi phục vào phòng cũ. Vui lòng chọn một phòng trống khác bên dưới:
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] text-[12px]">
              Phòng cũ <strong>P.{booking.roomNumber}</strong> hiện đang trống trong khoảng ngày{' '}
              {formatDateVN(booking.checkIn)} → {formatDateVN(booking.checkOut)}.
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-[#57534E] mb-1">
              Phòng khôi phục (chỉ hiện các phòng trống hợp lệ)
            </label>
            <select
              required
              value={selectedRoomId}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
            >
              <option value="">-- Chọn phòng trống --</option>
              {availableAlternativeRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  P.{r.roomNumber} — {r.roomTypeName} ({r.floor})
                  {r.id === booking.roomId ? ' (Phòng cũ)' : ''}
                </option>
              ))}
            </select>
          </div>

          {depositAlreadyGone && (
            <div className="p-3.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-[12px] flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <div className="font-semibold">
                  Lưu ý kế toán: Tiền cọc cũ đã được{' '}
                  {booking.depositResolutionStatus === 'refunded'
                    ? 'Hoàn trả cho khách'
                    : `Chuyển sang đơn ${booking.depositTransferredToBookingCode || 'khác'}`}
                </div>
                <p className="mt-0.5">
                  Khi khôi phục, hệ thống <strong>không tự động phục hồi tiền cọc cũ</strong> mà đưa
                  số tiền đã thu về <strong>0đ</strong>. Vui lòng lập phiếu thu mới nếu khách đóng
                  lại cọc.
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-[#57534E] mb-1">
              Lý do khôi phục đơn (Bắt buộc) *
            </label>
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Khách báo quay lại nhận phòng theo lịch ban đầu..."
              className="w-full p-2.5 rounded-xl border border-[#E5E2DC] text-[13px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-[#E5E2DC] text-[13px]"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving || !selectedRoomId}
              className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-50 text-white text-[13px] font-medium"
            >
              {saving ? 'Đang khôi phục...' : 'Xác nhận khôi phục đơn'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
