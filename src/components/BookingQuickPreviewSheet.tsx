import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Ban,
  BedDouble,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  LogIn,
  LogOut,
  MessageSquare,
  Pencil,
  StickyNote,
  Tag,
  Users,
  X,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking } from '../types/pms';
import {
  formatCurrency,
  formatShortDate,
  getBookingGuestBalance,
  getSourceLabel,
  getStatusLabel,
} from '../lib/utils';
import {
  bulkCheckInGroup,
  checkInBooking,
  checkOutBooking,
  updateBookingNote,
} from '../lib/pmsActions';
import { CancelBookingModal } from './CancelBookingModal';

interface BookingQuickPreviewSheetProps {
  bookingId: string;
  onClose: () => void;
  onOpenDetail: (opts?: { initialTab?: 'details' | 'occupants' | 'payment' | 'history'; openTransfer?: boolean }) => void;
}

export const BookingQuickPreviewSheet: React.FC<BookingQuickPreviewSheetProps> = ({
  bookingId,
  onClose,
  onOpenDetail,
}) => {
  const { bookings, groups, hotelConfig, actor, notify } = usePms();
  const booking = bookings.find((b) => b.id === bookingId);

  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(booking?.note || '');
  const [savingNote, setSavingNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = () => {
    const st = window.history.state as { lfpmsLayer?: string } | null;
    if (st?.lfpmsLayer === 'quick_preview') {
      window.history.back();
      return;
    }
    onCloseRef.current();
  };

  useEffect(() => {
    setNoteDraft(booking?.note || '');
    setEditingNote(false);
    setShowMoreMenu(false);
  }, [bookingId, booking?.note]);

  // Android Back button support (Layer 1: Quick-Preview Sheet — StrictMode safe)
  useEffect(() => {
    try {
      const currentState = window.history.state as { lfpmsLayer?: string; bookingId?: string } | null;
      if (currentState?.lfpmsLayer !== 'quick_preview' && currentState?.lfpmsLayer !== 'booking_detail') {
        window.history.pushState({ lfpmsLayer: 'quick_preview', bookingId }, '');
      }
    } catch {
      // Ignore History API restrictions
    }

    const handlePopState = () => {
      const st = window.history.state as { lfpmsLayer?: string } | null;
      if (st?.lfpmsLayer === 'quick_preview' || st?.lfpmsLayer === 'booking_detail') {
        return;
      }
      onCloseRef.current();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const st = window.history.state as { lfpmsLayer?: string } | null;
        if (st?.lfpmsLayer === 'booking_detail') return;
        requestClose();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [bookingId]);

  const groupRecord = useMemo(
    () => (booking?.groupId ? groups.find((g) => g.id === booking.groupId) : undefined),
    [groups, booking?.groupId]
  );

  const groupSiblings = useMemo(() => {
    if (!booking) return [];
    if (!booking.groupId) return [booking];
    const list = bookings
      .filter((b) => b.groupId === booking.groupId)
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
    return list.length > 0 ? list : [booking];
  }, [bookings, booking]);

  if (!booking) return null;

  const isMultiRoomGroup = groupSiblings.length > 1;
  const displayCode = isMultiRoomGroup
    ? groupRecord?.groupCode || booking.bookingCode.replace(/-\d+$/, '')
    : booking.bookingCode;

  const isHourly = !isMultiRoomGroup && booking.bookingMode === 'hourly';

  // Aggregate metrics across group when multi-room, or single booking when solo
  const nonCancelled = groupSiblings.filter(
    (b) => b.status !== 'cancelled' && b.status !== 'no_show'
  );
  const metricsScope = nonCancelled.length > 0 ? nonCancelled : groupSiblings;

  const totalAmount = metricsScope.reduce(
    (s, b) => s + (b.grossRoomTotal || 0) + (b.serviceTotal || 0) + (b.hourlySurcharge || 0),
    0
  );
  const totalPaid = metricsScope.reduce(
    (s, b) => s + (b.depositPaid || 0) + (b.guestPaid || 0),
    0
  );
  const totalBalance = Math.max(
    0,
    metricsScope.reduce((s, b) => s + Math.max(0, getBookingGuestBalance(b)), 0)
  );
  const totalGuests = metricsScope.reduce((s, b) => s + Math.max(1, b.occupantCount || 1), 0);
  const totalDeposit = metricsScope.reduce((s, b) => s + (b.depositPaid || 0), 0);

  const checkIns = metricsScope.map((b) => b.checkIn).filter(Boolean).sort();
  const checkOuts = metricsScope.map((b) => b.checkOut).filter(Boolean).sort();
  const firstCheckIn = checkIns[0] || booking.checkIn;
  const lastCheckOut = checkOuts[checkOuts.length - 1] || booking.checkOut;
  const defaultCiTime = booking.checkInTime || hotelConfig.checkInTime || '14:00';
  const defaultCoTime = booking.checkOutTime || hotelConfig.checkOutTime || '12:00';

  const reservedSiblings = groupSiblings.filter((b) => b.status === 'reserved');
  const inHouseSiblings = groupSiblings.filter((b) => b.status === 'in_house');

  const statusPillStyle =
    booking.status === 'in_house'
      ? 'bg-[#E8F3EC] text-[#0F5132]'
      : booking.status === 'reserved'
        ? 'bg-[#FFFBEB] text-[#B45309]'
        : booking.status === 'cancelled' || booking.status === 'no_show'
          ? 'bg-[#FEF2F2] text-[#B91C1C]'
          : 'bg-[#E6EFF1] text-[#335C67]';

  const handleSaveQuickNote = async () => {
    setSavingNote(true);
    try {
      await updateBookingNote(booking, noteDraft, actor);
      notify('Đã lưu ghi chú đặt phòng');
      setEditingNote(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi lưu ghi chú', 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (booking.status === 'reserved' || (isMultiRoomGroup && reservedSiblings.length > 0 && inHouseSiblings.length === 0)) {
      setBusy(true);
      try {
        if (isMultiRoomGroup && reservedSiblings.length > 1) {
          const count = await bulkCheckInGroup(reservedSiblings, actor);
          notify(`Đã nhận phòng cả đoàn (${count} phòng)`);
        } else {
          await checkInBooking(booking, actor);
          notify(`Đã nhận phòng P.${booking.roomNumber} (${booking.primaryGuestName})`);
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Lỗi nhận phòng', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (booking.status === 'in_house') {
      if (isMultiRoomGroup) {
        onOpenDetail({ initialTab: 'details' });
        return;
      }
      setBusy(true);
      try {
        await checkOutBooking(booking, actor, { earlyCheckOut: false });
        notify(`Đã trả phòng P.${booking.roomNumber} — chuyển sang Chờ dọn`);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Lỗi trả phòng', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    onOpenDetail({ initialTab: 'details' });
  };

  const primaryLabel =
    booking.status === 'reserved'
      ? isMultiRoomGroup && reservedSiblings.length > 1
        ? `Nhận phòng (${reservedSiblings.length} phòng)`
        : 'Nhận phòng'
      : booking.status === 'in_house'
        ? isMultiRoomGroup
          ? `Quản lý & Trả phòng (${inHouseSiblings.length})`
          : 'Trả phòng'
        : 'Xem chi tiết đơn';

  const handleMessageGuest = () => {
    setShowMoreMenu(false);
    const cleanPhone = (booking.primaryGuestPhone || '').replace(/\D/g, '');
    if (!cleanPhone) {
      notify('Đơn này chưa có số điện thoại khách hàng', 'warning');
      return;
    }
    window.open(`https://zalo.me/${cleanPhone}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      data-testid="calendar-quick-preview-backdrop"
      className="fixed inset-0 z-40 bg-black/25 flex items-end justify-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Xem nhanh đơn đặt phòng"
        data-testid="calendar-quick-preview-sheet"
        className="w-full max-w-[100vw] sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border border-[#E7E3DA] shadow-2xl flex flex-col max-h-[66dvh] sm:max-h-[75vh] overflow-hidden animate-in slide-in-from-bottom-4 duration-150"
      >
        {/* Drag Handle Indicator */}
        <div className="pt-2 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#DDD8CE]" />
        </div>

        {/* Row 1: Compact Header (Code + Copy + Room Count Badge + "Xem chi tiết >") */}
        <div className="px-4 pb-2.5 border-b border-[#F1EFEA] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(displayCode);
                notify(`Đã sao chép mã ${displayCode}`, 'info');
              }}
              data-testid="quick-preview-copy-code"
              className="inline-flex items-center gap-1 font-mono-num text-[14px] font-bold text-[#0F5132] hover:underline truncate"
              title="Bấm để sao chép mã đơn"
            >
              <span>{displayCode}</span>
              <Copy className="w-3.5 h-3.5 text-[#8A847C] shrink-0" strokeWidth={1.6} />
            </button>
            {isMultiRoomGroup && (
              <span
                data-testid="quick-preview-room-count-badge"
                className="px-2 py-0.5 rounded-full bg-[#E8F3EC] text-[#0F5132] text-[11px] font-semibold shrink-0"
              >
                {groupSiblings.length} phòng
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onOpenDetail({ initialTab: 'details' })}
              data-testid="quick-preview-detail-btn"
              className="min-h-[36px] px-2.5 rounded-lg text-[#0F5132] hover:bg-[#E8F3EC] text-[13px] font-semibold inline-flex items-center gap-0.5 transition-colors"
            >
              <span>Xem chi tiết</span>
              <ChevronRight className="w-4 h-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Đóng thẻ xem nhanh"
              className="w-8 h-8 rounded-lg hover:bg-[#F5F4F0] text-[#57534E] flex items-center justify-center"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Scrollable Middle Content */}
        <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1">
          {/* Guest Name + Status Badge */}
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-[16px] text-[#1C1B18] truncate">
              {isMultiRoomGroup && groupRecord?.leaderName
                ? groupRecord.leaderName
                : booking.primaryGuestName}
            </div>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${statusPillStyle}`}
            >
              {getStatusLabel(booking.status)}
            </span>
          </div>

          {/* Visual Check-in ── [Nights] ── Check-out Timeline */}
          <div className="p-2.5 rounded-xl bg-[#FAF9F6] border border-[#E7E3DA] flex items-center justify-between gap-2 text-[12px]">
            <div className="min-w-0">
              <div className="text-[10px] text-[#8A847C] font-medium">Nhận phòng</div>
              <div className="font-mono-num font-semibold text-[#1C1B18]">
                {formatShortDate(firstCheckIn)} · {defaultCiTime}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <span className="w-4 h-px bg-[#D6D1C7]" />
              <span className="px-2 py-0.5 rounded-full bg-white border border-[#E7E3DA] font-mono-num text-[11px] font-semibold text-[#0F5132] inline-flex items-center gap-1">
                {isHourly && <Clock className="w-3 h-3" strokeWidth={2} />}
                {isHourly ? `${booking.hourlyHours || 1} giờ` : `${booking.nights} đêm`}
              </span>
              <span className="w-4 h-px bg-[#D6D1C7]" />
            </div>

            <div className="min-w-0 text-right">
              <div className="text-[10px] text-[#8A847C] font-medium">Trả phòng</div>
              <div className="font-mono-num font-semibold text-[#1C1B18]">
                {formatShortDate(lastCheckOut)} · {defaultCoTime}
              </div>
            </div>
          </div>

          {/* Compact Meta Icons Row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-[#57534E]">
            <span className="inline-flex items-center gap-1 font-medium text-[#1C1B18]">
              <BedDouble className="w-3.5 h-3.5 text-[#0F5132]" strokeWidth={1.75} />
              {isMultiRoomGroup
                ? `${groupSiblings.length} phòng (${groupSiblings.map((b) => b.roomNumber).join(', ')})`
                : `Phòng ${booking.roomNumber}`}
            </span>
            <span className="inline-flex items-center gap-1">
              <Tag className="w-3.5 h-3.5 text-[#8A847C]" strokeWidth={1.75} />
              {getSourceLabel(booking.source, booking.otaChannel, booking.sourceLabel)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-[#8A847C]" strokeWidth={1.75} />
              {totalGuests} khách
            </span>
            <span className="inline-flex items-center gap-1">
              <CreditCard className="w-3.5 h-3.5 text-[#8A847C]" strokeWidth={1.75} />
              {totalBalance === 0
                ? 'Đã thanh toán đủ'
                : totalDeposit > 0
                  ? `Đã cọc ${formatCurrency(totalDeposit)}`
                  : 'Chưa cọc'}
            </span>
          </div>

          {/* Quick-Editable Note Row */}
          <div className="rounded-xl border border-[#EFECE4] bg-[#FAF9F6]/70 px-3 py-2">
            {editingNote ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  autoFocus
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  data-testid="quick-preview-note-input"
                  placeholder="Nhập ghi chú đặt phòng..."
                  className="flex-1 min-h-[36px] px-2.5 rounded-lg border border-[#0F5132] bg-white text-[12px] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={savingNote}
                  onClick={() => void handleSaveQuickNote()}
                  className="min-h-[36px] px-2.5 rounded-lg bg-[#0F5132] text-white text-[12px] font-medium inline-flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> Lưu
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingNote(false);
                    setNoteDraft(booking.note || '');
                  }}
                  className="min-h-[36px] px-2 rounded-lg border border-[#E7E3DA] bg-white text-[#57534E] text-[12px]"
                >
                  Hủy
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingNote(true)}
                data-testid="quick-preview-note-btn"
                className="w-full text-left flex items-center justify-between gap-2 text-[12px] text-[#57534E] hover:text-[#1C1B18]"
              >
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <StickyNote className="w-3.5 h-3.5 text-[#D97706] shrink-0" strokeWidth={1.75} />
                  <span className={`truncate ${booking.note ? 'text-[#1C1B18]' : 'text-[#8A847C] italic'}`}>
                    {booking.note || 'Thêm ghi chú đặt phòng...'}
                  </span>
                </span>
                <Pencil className="w-3 h-3 text-[#8A847C] shrink-0" strokeWidth={1.6} />
              </button>
            )}
          </div>

          {/* 3-Column Financial Summary: Tổng cộng | Đã thanh toán | Còn lại */}
          <div
            data-testid="quick-preview-finance"
            className="grid grid-cols-3 divide-x divide-[#E7E3DA] rounded-xl border border-[#E7E3DA] bg-white overflow-hidden"
          >
            <div className="p-2.5 text-center">
              <div className="text-[10px] text-[#8A847C] font-medium">Tổng cộng</div>
              <div className="font-mono-num text-[13px] font-semibold text-[#1C1B18] mt-0.5">
                {formatCurrency(totalAmount)}
              </div>
            </div>
            <div className="p-2.5 text-center">
              <div className="text-[10px] text-[#8A847C] font-medium">Đã thanh toán</div>
              <div className="font-mono-num text-[13px] font-semibold text-[#0F5132] mt-0.5">
                {formatCurrency(totalPaid)}
              </div>
            </div>
            <div className="p-2.5 text-center bg-[#FAF9F6]">
              <div className="text-[10px] text-[#8A847C] font-medium">Còn lại</div>
              <div
                className={`font-mono-num text-[13px] font-bold mt-0.5 ${
                  totalBalance > 0 ? 'text-[#B45309]' : 'text-[#0F5132]'
                }`}
              >
                {formatCurrency(totalBalance)}
              </div>
            </div>
          </div>
        </div>

        {/* Fixed Bottom Action Bar (70% Primary + 30% Khác ▾) */}
        <div className="px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[#E7E3DA] bg-white flex items-center gap-2 shrink-0 relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handlePrimaryAction()}
            data-testid="quick-preview-primary-btn"
            className="flex-[7] min-h-[44px] px-4 rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-50 text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            {booking.status === 'reserved' ? (
              <LogIn className="w-4 h-4" strokeWidth={1.9} />
            ) : booking.status === 'in_house' ? (
              <LogOut className="w-4 h-4" strokeWidth={1.9} />
            ) : null}
            <span>{busy ? 'Đang xử lý...' : primaryLabel}</span>
          </button>

          <div className="flex-[3] relative">
            <button
              type="button"
              onClick={() => setShowMoreMenu((v) => !v)}
              data-testid="quick-preview-more-btn"
              className="relative z-50 w-full min-h-[44px] px-3 rounded-xl border border-[#E7E3DA] bg-[#FAF9F6] hover:bg-[#F1EFEA] text-[#1C1B18] text-[13px] font-semibold inline-flex items-center justify-center gap-1 transition-colors"
            >
              <span>Khác</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${showMoreMenu ? 'rotate-180' : ''}`}
                strokeWidth={1.75}
              />
            </button>

            {showMoreMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMoreMenu(false)}
                />
                <div
                  data-testid="quick-preview-more-menu"
                  className="absolute right-0 bottom-12 z-50 w-52 bg-white border border-[#E7E3DA] rounded-xl shadow-2xl py-1.5 text-[13px]"
                >
                  {(booking.status === 'reserved' || booking.status === 'in_house') && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreMenu(false);
                        onOpenDetail({ initialTab: 'details', openTransfer: true });
                      }}
                      className="w-full min-h-[40px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#1C1B18] flex items-center gap-2"
                    >
                      <ArrowRightLeft className="w-4 h-4 text-[#57534E]" strokeWidth={1.6} />
                      <span>Đổi phòng</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowMoreMenu(false);
                      onOpenDetail({ initialTab: 'payment' });
                    }}
                    className="w-full min-h-[40px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#0F5132] font-medium flex items-center gap-2"
                  >
                    <CreditCard className="w-4 h-4" strokeWidth={1.6} />
                    <span>Thu tiền / VietQR</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMessageGuest}
                    className="w-full min-h-[40px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#1C1B18] flex items-center gap-2"
                  >
                    <MessageSquare className="w-4 h-4 text-[#2563EB]" strokeWidth={1.6} />
                    <span>Nhắn tin khách</span>
                  </button>
                  {booking.status === 'reserved' && (
                    <>
                      <div className="my-1 border-t border-[#F1EFEA]" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          setShowCancelModal(true);
                        }}
                        className="w-full min-h-[40px] px-3.5 text-left hover:bg-[#FEF2F2] text-[#B91C1C] font-medium flex items-center gap-2"
                      >
                        <Ban className="w-4 h-4" strokeWidth={1.6} />
                        <span>Hủy đơn</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showCancelModal && (
        <CancelBookingModal
          bookingsScope={isMultiRoomGroup ? reservedSiblings.length > 0 ? reservedSiblings : groupSiblings : [booking]}
          onClose={() => setShowCancelModal(false)}
        />
      )}
    </div>
  );
};
