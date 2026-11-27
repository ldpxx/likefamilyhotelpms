import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Award,
  Clock,
  Copy,
  CreditCard,
  FileText,
  LogIn,
  LogOut,
  Merge,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, DailyRate, FormTemplateType, PaymentMethod, Room } from '../types/pms';
import {
  calculateHourlyRoomTotal,
  diffDays,
  formatCurrency,
  formatDateTimeVN,
  formatDateVN,
  getBookingGuestBalance,
  getCancellationTypeLabel,
  getDepositResolutionLabel,
  getOtaCancelStatusLabel,
  getPaymentMethodLabel,
  getSourceLabel,
  getStatusLabel,
  isBookingBlockingCalendar,
  isDateRangeOverlap,
  isLoyalGuest,
  sumDailyRates,
  todayISO,
} from '../lib/utils';
import {
  addBookingService,
  checkInBooking,
  checkOutBooking,
  consolidateRoomIntoTarget,
  mergeBookingsIntoGroup,
  recordTransaction,
  removeBookingService,
  transferBookingRoom,
  undoBookingAction,
  updateBookingPricing,
  updateHourlySurcharge,
} from '../lib/pmsActions';
import { buildVietQrUrl } from '../lib/vietqr';
import { PricingEditor } from './PricingEditor';
import { OccupantOcrPanel } from './OccupantOcrPanel';
import { CancelBookingModal } from './CancelBookingModal';
import { DepositResolutionModal } from './DepositResolutionModal';
import { UndoCancelModal } from './UndoCancelModal';
import { PostStayAccountingModal, type PostStayModalMode } from './PostStayAccountingModal';
import { ReclassifyPaymentModal } from './ReclassifyPaymentModal';

interface BookingDetailModalProps {
  bookingId: string;
  initialTab?: 'overview' | 'occupants' | 'pricing' | 'transfer' | 'forms';
  preselectedTransferRoom?: Room | null;
  onClose: () => void;
  onOpenFormPreview: (booking: Booking, type: FormTemplateType) => void;
}

export const BookingDetailModal: React.FC<BookingDetailModalProps> = ({
  bookingId,
  initialTab = 'overview',
  preselectedTransferRoom = null,
  onClose,
  onOpenFormPreview,
}) => {
  const {
    bookings,
    activeRooms,
    roomTypes,
    guests,
    transactions,
    postCheckoutAdjustments,
    hotelConfig,
    actor,
    isAdmin,
    staffProfile,
    notify,
    triggerUndoBanner,
  } = usePms();

  const booking = bookings.find((b) => b.id === bookingId);
  const [tab, setTab] = useState<'overview' | 'occupants' | 'pricing' | 'transfer' | 'forms'>(
    preselectedTransferRoom ? 'transfer' : initialTab
  );

  // Pricing edit state (daily or hourly)
  const [editRates, setEditRates] = useState<DailyRate[]>(booking?.dailyRates || []);
  const [editTierId, setEditTierId] = useState<string | null>(
    booking?.selectedPriceTierId || null
  );
  const [editHourlyHours, setEditHourlyHours] = useState<number>(booking?.hourlyHours || 2);
  const [editHourlyTotal, setEditHourlyTotal] = useState<number>(booking?.grossRoomTotal || 0);

  // Service state
  const [serviceName, setServiceName] = useState('');
  const [serviceQty, setServiceQty] = useState(1);
  const [servicePrice, setServicePrice] = useState(20000);

  // Hourly surcharge state
  const [surchargeAmount, setSurchargeAmount] = useState(booking?.hourlySurcharge || 0);
  const [surchargeNote, setSurchargeNote] = useState(booking?.hourlySurchargeNote || '');

  // Payment form state
  const [payAmount, setPayAmount] = useState(0);
  const [payType, setPayType] = useState<'payment' | 'deposit' | 'refund'>('payment');
  const [payMethod, setPayMethod] = useState<PaymentMethod>(
    booking?.source === 'ota' ? 'ota_debt' : 'bank_transfer'
  );
  const [payNote, setPayNote] = useState('');

  // Transfer room state
  const [transferRoomId, setTransferRoomId] = useState(preselectedTransferRoom?.id || '');
  const [transferPricingMode, setTransferPricingMode] = useState<
    'new_room_rate' | 'keep_old_rate' | 'custom_rate'
  >('new_room_rate');
  const [transferCustomRate, setTransferCustomRate] = useState(400000);

  // Room Merge state
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeMode, setMergeMode] = useState<'billing' | 'consolidate'>('billing');

  // Undo prompt & v2.0.0 Cancellation / Part C Post-Stay Modals
  const [showUndoBox, setShowUndoBox] = useState(false);
  const [undoReason, setUndoReason] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showInlineQr, setShowInlineQr] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDepositResModal, setShowDepositResModal] = useState(false);
  const [showUndoCancelModal, setShowUndoCancelModal] = useState(false);
  const [postStayMode, setPostStayMode] = useState<PostStayModalMode | null>(null);
  const [reclassifyTx, setReclassifyTx] = useState<(typeof transactions)[number] | null>(null);
  const [busy, setBusy] = useState(false);

  const chainBookings = useMemo(() => {
    if (!booking?.bookingChainId) return [];
    return bookings
      .filter((b) => b.bookingChainId === booking.bookingChainId)
      .sort((a, b) => (a.chainSequence || 1) - (b.chainSequence || 1));
  }, [bookings, booking?.bookingChainId]);

  const bookingTransactions = useMemo(
    () => transactions.filter((t) => t.bookingId === booking?.id),
    [transactions, booking?.id]
  );

  const bookingPostAdjustments = useMemo(
    () => postCheckoutAdjustments.filter((a) => a.bookingId === booking?.id),
    [postCheckoutAdjustments, booking?.id]
  );

  const transferableRooms = useMemo(() => {
    if (!booking) return [];
    const start = booking.status === 'in_house' ? todayISO() : booking.checkIn;
    return activeRooms.filter((r) => {
      if (r.id === booking.roomId || r.hkStatus === 'maintenance') return false;
      const conflict = bookings.some(
        (b) =>
          b.id !== booking.id &&
          b.roomId === r.id &&
          isBookingBlockingCalendar(b.status) &&
          isDateRangeOverlap(b.checkIn, b.checkOut, start, booking.checkOut)
      );
      return !conflict;
    });
  }, [activeRooms, bookings, booking]);

  const mergeCandidates = useMemo(() => {
    if (!booking) return [];
    return bookings.filter(
      (b) => b.id !== booking.id && (b.status === 'in_house' || b.status === 'reserved')
    );
  }, [bookings, booking]);

  if (!booking) return null;

  const roomType = roomTypes.find((rt) => rt.id === booking.roomTypeId);
  const primaryGuestRecord = guests.find((g) => g.id === booking.primaryGuestId);
  const effectiveStayCount = Math.max(
    primaryGuestRecord?.totalStays || 0,
    booking.guestStayCount || 0
  );
  const showLoyalBadge = isLoyalGuest(effectiveStayCount) || booking.isReturningGuest;

  const guestBalance = getBookingGuestBalance(booking);
  const today = todayISO();
  const isHourly = booking.bookingMode === 'hourly';
  const canEarlyCheckout = !isHourly && booking.status === 'in_house' && today < booking.checkOut;

  const earlyStayedNights = Math.max(1, diffDays(booking.checkIn, today));
  const earlyGross = sumDailyRates(booking.dailyRates.slice(0, earlyStayedNights));
  const earlyPaid = (booking.depositPaid || 0) + (booking.guestPaid || 0);
  const earlySuggestedRefund = Math.max(
    0,
    earlyPaid - (earlyGross + (booking.serviceTotal || 0) + (booking.hourlySurcharge || 0))
  );

  const vietQrUrl = buildVietQrUrl({
    bankAccount: hotelConfig.bankAccount,
    amount: Math.max(0, guestBalance),
    addInfo: `THANH TOAN ${booking.bookingCode} P${booking.roomNumber}`,
  });

  const handleCheckIn = async () => {
    setBusy(true);
    try {
      await checkInBooking(booking, actor);
      notify(`Đã Check-in P.${booking.roomNumber} (${booking.primaryGuestName})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi Check-in', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async (early = false) => {
    setBusy(true);
    try {
      await checkOutBooking(booking, actor, {
        earlyCheckOut: early,
        refundAmount: early ? earlySuggestedRefund : 0,
        refundMethod: 'cash',
      });
      notify(
        early
          ? `Đã chốt trả phòng sớm P.${booking.roomNumber} (${earlyStayedNights} đêm)`
          : `Đã trả phòng P.${booking.roomNumber} — Phòng chuyển sang Chờ dọn`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi trả phòng', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setShowCancelModal(true);
  };

  const handleUndoNow = async () => {
    if (!undoReason.trim()) {
      notify('Vui lòng nhập lý do hoàn tác để lưu vết kiểm toán', 'warning');
      return;
    }
    setBusy(true);
    try {
      await undoBookingAction({ booking, reason: undoReason, actor });
      setShowUndoBox(false);
      setUndoReason('');
      notify('Đã hoàn tác thao tác và ghi nhận vào nhật ký audit_logs');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Không thể hoàn tác', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePricing = async () => {
    setBusy(true);
    try {
      if (isHourly) {
        await updateBookingPricing(
          booking,
          { hourlyHours: editHourlyHours, hourlyRoomTotal: editHourlyTotal },
          actor
        );
      } else {
        await updateBookingPricing(
          booking,
          { dailyRates: editRates, selectedPriceTierId: editTierId },
          actor
        );
      }
      notify('Đã cập nhật bảng giá phòng');
    } finally {
      setBusy(false);
    }
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceName.trim()) return;
    await addBookingService(
      booking,
      { name: serviceName, quantity: serviceQty, unitPrice: servicePrice },
      actor
    );
    setServiceName('');
    setServiceQty(1);
    notify('Đã thêm dịch vụ vào hóa đơn phòng');
  };

  const handleSaveSurcharge = async () => {
    await updateHourlySurcharge(booking, surchargeAmount, surchargeNote, actor);
    notify('Đã cập nhật phụ thu nhận sớm / trả muộn');
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = payAmount > 0 ? payAmount : Math.max(0, guestBalance);
    if (amount <= 0 && payMethod !== 'ota_debt') {
      notify('Vui lòng nhập số tiền lớn hơn 0', 'warning');
      return;
    }
    setBusy(true);
    try {
      await recordTransaction({
        booking,
        type: payType,
        direction: payType === 'refund' ? 'out' : 'in',
        category:
          payMethod === 'ota_debt'
            ? 'Ghi nhận Công nợ OTA'
            : payType === 'deposit'
            ? 'Thu tiền đặt cọc'
            : payType === 'refund'
            ? 'Hoàn tiền cho khách'
            : 'Thanh toán tiền phòng & dịch vụ',
        amount: payMethod === 'ota_debt' ? booking.grossRoomTotal : amount,
        method: payMethod,
        note: payNote || `Đơn ${booking.bookingCode} - P.${booking.roomNumber}`,
        accountingLockDate: hotelConfig.accountingLockDate,
        actor,
      });
      setPayAmount(0);
      setPayNote('');
      notify(`Đã ghi nhận giao dịch (${getPaymentMethodLabel(payMethod)})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi ghi nhận thanh toán', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleTransferRoom = async () => {
    const targetRoom = activeRooms.find((r) => r.id === transferRoomId);
    if (!targetRoom) {
      notify('Vui lòng chọn phòng đích muốn chuyển sang', 'warning');
      return;
    }
    const targetRt = roomTypes.find((t) => t.id === targetRoom.roomTypeId);
    const targetDefaultRate =
      targetRt?.priceTiers.find((p) => p.isDefault)?.price ||
      targetRt?.priceTiers[0]?.price ||
      350000;
    const oldRate = booking.dailyRates[0]?.rate || 350000;
    const chosenRate =
      transferPricingMode === 'new_room_rate'
        ? targetDefaultRate
        : transferPricingMode === 'keep_old_rate'
        ? oldRate
        : transferCustomRate;

    setBusy(true);
    try {
      const { newBooking } = await transferBookingRoom({
        booking,
        targetRoom,
        transferDate: booking.status === 'in_house' ? todayISO() : booking.checkIn,
        pricingMode: transferPricingMode,
        targetRoomRate: chosenRate,
        actor,
      });
      notify(`Đã chuyển phòng sang P.${newBooking.roomNumber} (${newBooking.bookingCode})`);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi chuyển phòng', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleMergeRooms = async () => {
    const target = bookings.find((b) => b.id === mergeTargetId);
    if (!target) {
      notify('Vui lòng chọn phòng muốn ghép', 'warning');
      return;
    }
    setBusy(true);
    try {
      if (mergeMode === 'billing') {
        const grp = await mergeBookingsIntoGroup(
          [booking, target],
          `Nhóm ghép P.${booking.roomNumber} + P.${target.roomNumber}`,
          actor
        );
        notify(`Đã gộp hóa đơn chung vào ${grp.groupName}`);
      } else {
        await consolidateRoomIntoTarget(booking, target, actor);
        notify(
          `Đã dồn khách & kết chuyển công nợ P.${booking.roomNumber} sang P.${target.roomNumber}`
        );
        onClose();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi ghép phòng', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border-l border-[#E7E3DA] w-full max-w-3xl h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Top Drawer Header with Initials Avatar & 1-Click Copy */}
        <div className="px-4 sm:px-6 py-4 border-b border-[#E7E3DA] flex flex-nowrap items-start justify-between gap-3 bg-white shrink-0">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#E8F3EC] text-[#0F5132] font-bold text-[13px] flex items-center justify-center shrink-0 uppercase">
              {(booking.primaryGuestName || 'KH')
                .split(/\s+/)
                .filter(Boolean)
                .slice(-2)
                .map((w) => w[0])
                .join('')}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono-num text-[15px] font-bold text-[#0F5132]">
                  P.{booking.roomNumber}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(booking.bookingCode);
                    notify(`Đã sao chép mã đơn ${booking.bookingCode}`, 'info');
                  }}
                  title="Sao chép mã đặt phòng"
                  className="inline-flex items-center gap-1 font-mono-num text-[12px] text-[#57534E] hover:text-[#0F5132]"
                >
                  {booking.bookingCode}
                  <Copy className="w-3 h-3" strokeWidth={1.5} />
                </button>
                <span className="px-2 py-0.5 rounded-full bg-[#E8F3EC] text-[11px] font-semibold text-[#0F5132]">
                  {getStatusLabel(booking.status)}
                </span>
                {isHourly && (
                  <span className="px-2 py-0.5 rounded-full bg-[#FFFBEB] text-[11px] font-medium text-[#B45309] inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" strokeWidth={1.5} />
                    Nghỉ giờ ({booking.hourlyHours || 1}h)
                  </span>
                )}
                <span className="px-2 py-0.5 rounded-full bg-[#FAF9F6] border border-[#E7E3DA] text-[11px] font-medium text-[#57534E]">
                  {getSourceLabel(booking.source, booking.otaChannel, booking.sourceLabel)}
                </span>
                {showLoyalBadge && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#B45309] text-[11px] font-semibold">
                    <Award className="w-3 h-3" strokeWidth={1.5} />
                    Khách hàng thân quen
                  </span>
                )}
                {booking.groupName && (
                  <span className="px-2 py-0.5 rounded-full bg-[#F3F0E9] text-[11px] font-medium text-[#1C1B18]">
                    Đoàn: {booking.groupName}
                  </span>
                )}
                {booking.isBillingReopened && (
                  <span className="px-2 py-0.5 rounded-full bg-[#FFFBEB] border border-[#FDE68A] text-[11px] font-medium text-[#92400E]">
                    Mở lại sửa hóa đơn (không chiếm phòng)
                  </span>
                )}
                {booking.voidCheckedOutAt && (
                  <span className="px-2 py-0.5 rounded-full bg-[#FEF2F2] border border-[#FECACA] text-[11px] font-medium text-[#B91C1C]">
                    Đã hủy ghi nhận sau Check-out
                  </span>
                )}
              </div>
              <p className="text-[13px] text-[#57534E] mt-0.5 flex flex-wrap items-center gap-1.5">
                <strong className="text-[#1C1B18]">{booking.primaryGuestName}</strong>
                {booking.primaryGuestPhone && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(booking.primaryGuestPhone);
                      notify(`Đã sao chép SĐT ${booking.primaryGuestPhone}`, 'info');
                    }}
                    className="inline-flex items-center gap-1 font-mono-num text-[12px] hover:text-[#0F5132]"
                    title="Sao chép SĐT"
                  >
                    • {booking.primaryGuestPhone}
                    <Copy className="w-3 h-3" strokeWidth={1.5} />
                  </button>
                )}
                <span className="font-mono-num text-[12px]">
                  •{' '}
                  {isHourly
                    ? `${formatDateVN(booking.checkIn)} (${booking.checkInTime || ''} → ${
                        booking.checkOutTime || ''
                      } • ${booking.hourlyHours || 1} giờ)`
                    : `${formatDateVN(booking.checkIn)} → ${formatDateVN(booking.checkOut)} (${
                        booking.nights
                      } đêm)`}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {booking.status !== 'cancelled' &&
              booking.status !== 'no_show' &&
              booking.lastActionSnapshot &&
              !['check_in', 'check_out', 'early_checkout'].includes(
                String(booking.lastActionSnapshot.action || '')
              ) &&
              staffProfile?.permissions.canUndoAction && (
                <button
                  type="button"
                  onClick={() => setShowUndoBox((v) => !v)}
                  className="h-8 px-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] text-[#92400E] text-[12px] font-medium inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Hoàn tác
                </button>
              )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[#FAF9F6] flex items-center justify-center text-[#57534E]"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Universal Undo Reason Bar */}
        {showUndoBox && (
          <div className="px-6 py-3 bg-[#FFFBEB] border-b border-[#FDE68A] flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={undoReason}
              onChange={(e) => setUndoReason(e.target.value)}
              placeholder="Nhập lý do hoàn tác (bắt buộc để lưu vết kiểm toán)..."
              className="flex-1 min-w-[220px] h-8 px-3 rounded-lg border border-[#F59E0B] bg-white text-[12px]"
            />
            <button
              type="button"
              onClick={handleUndoNow}
              disabled={busy}
              className="h-8 px-3.5 rounded-lg bg-[#B45309] text-white text-[12px] font-medium"
            >
              Xác nhận hoàn tác
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="px-6 border-b border-[#E5E2DC] bg-[#FAF9F6] flex overflow-x-auto gap-1">
          {[
            { id: 'overview', label: 'Tổng quan & Thanh toán' },
            { id: 'occupants', label: `Khách lưu trú (${booking.occupantCount}) & AI OCR` },
            { id: 'pricing', label: 'Giá phòng, Dịch vụ & Phụ thu' },
            { id: 'transfer', label: 'Đổi / Ghép phòng' },
            { id: 'forms', label: 'Biểu mẫu & VietQR' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id as typeof tab);
                if (t.id === 'pricing') {
                  setEditRates(booking.dailyRates);
                  setEditHourlyHours(booking.hourlyHours || 2);
                  setEditHourlyTotal(booking.grossRoomTotal);
                }
              }}
              className={`shrink-0 px-3.5 py-2.5 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-[#1B5E4B] text-[#1B5E4B]'
                  : 'border-transparent text-[#57534E] hover:text-[#1C1B18]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {tab === 'overview' && (
            <>
              {chainBookings.length > 1 && (
                <div className="p-3.5 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] space-y-1.5 text-[12px]">
                  <div className="font-semibold text-[#1E40AF]">
                    Chuỗi chặng chuyển phòng (Split-Stay — {chainBookings.length} chặng)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {chainBookings.map((leg) => (
                      <div
                        key={leg.id}
                        className={`px-2.5 py-1 rounded-lg border ${
                          leg.id === booking.id
                            ? 'bg-[#1D4ED8] text-white border-[#1D4ED8]'
                            : 'bg-white text-[#1C1B18] border-[#BFDBFE]'
                        }`}
                      >
                        Chặng {leg.chainSequence || 1}: P.{leg.roomNumber} ({leg.nights}đ) •{' '}
                        {formatCurrency(leg.grossRoomTotal)}
                      </div>
                    ))}
                  </div>
                  <div className="text-[#1E3A8A] font-mono-num">
                    Tổng tiền phòng gộp cả chuỗi:{' '}
                    <strong>
                      {formatCurrency(chainBookings.reduce((s, l) => s + l.grossRoomTotal, 0))}
                    </strong>
                  </div>
                </div>
              )}

              {/* Financial Summary Grid (Simplified OTA — Direct Receivable Amount) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl border border-[#E5E2DC] bg-[#FAF9F6]">
                  <div className="text-[11px] text-[#57534E]">
                    {isHourly ? `Tiền phòng giờ (${booking.hourlyHours}h)` : 'Tiền phòng thực thu'}
                  </div>
                  <div className="mt-1 text-[16px] font-semibold font-mono-num text-[#1C1B18]">
                    {formatCurrency(booking.grossRoomTotal)}
                  </div>
                  {booking.paymentMethod === 'ota_debt' && (
                    <div className="text-[11px] text-[#C2410C] font-medium">
                      Hình thức: Công nợ OTA
                    </div>
                  )}
                </div>
                <div className="p-3.5 rounded-xl border border-[#E5E2DC] bg-[#FAF9F6]">
                  <div className="text-[11px] text-[#57534E]">Dịch vụ & Phụ thu giờ</div>
                  <div className="mt-1 text-[16px] font-semibold font-mono-num text-[#1C1B18]">
                    {formatCurrency((booking.serviceTotal || 0) + (booking.hourlySurcharge || 0))}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-[#E5E2DC] bg-[#FAF9F6]">
                  <div className="text-[11px] text-[#57534E]">Khách đã cọc / thanh toán</div>
                  <div className="mt-1 text-[16px] font-semibold font-mono-num text-[#15803D]">
                    {formatCurrency((booking.depositPaid || 0) + (booking.guestPaid || 0))}
                  </div>
                </div>
                <div
                  className={`p-3.5 rounded-xl border ${
                    guestBalance > 0
                      ? 'border-[#FDE68A] bg-[#FFFBEB]'
                      : 'border-[#A7F3D0] bg-[#ECFDF5]'
                  }`}
                >
                  <div className="text-[11px] text-[#57534E]">Khách cần thanh toán tại quầy</div>
                  <div
                    className={`mt-1 text-[16px] font-semibold font-mono-num ${
                      guestBalance > 0 ? 'text-[#B45309]' : 'text-[#15803D]'
                    }`}
                  >
                    {formatCurrency(Math.max(0, guestBalance))}
                  </div>
                  {(booking.transferredBalance || 0) > 0 && (
                    <div className="text-[11px] text-[#0F5132] mt-0.5 font-mono-num">
                      Gồm công nợ nhận chuyển: +{formatCurrency(booking.transferredBalance || 0)}
                    </div>
                  )}
                  {booking.consolidatedInto && (
                    <div className="text-[11px] text-[#57534E] mt-0.5">
                      Đã chuyển công nợ ({formatCurrency(booking.balanceTransferredOut || 0)}) sang đơn ghép
                    </div>
                  )}
                </div>
              </div>

              {/* v2.0.0 Cancellation / No-Show Status & Strict Undo Cancel Card */}
              {(booking.status === 'cancelled' || booking.status === 'no_show') && (
                <div className="p-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2]/60 space-y-3 text-[12px]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-[13px] font-semibold text-[#991B1B]">
                        {getCancellationTypeLabel(booking.cancellationType)} •{' '}
                        {getStatusLabel(booking.status)}
                      </div>
                      <div className="text-[#57534E]">
                        Lý do: <strong>{booking.cancellationReason || '—'}</strong> • Thực hiện bởi{' '}
                        {booking.cancelledBy || '—'} ({formatDateTimeVN(booking.cancelledAt)})
                      </div>
                      <div className="text-[#1C1B18]">
                        Xử lý tiền cọc:{' '}
                        <strong>{getDepositResolutionLabel(booking.depositResolutionStatus)}</strong>
                        {booking.depositResolutionStatus === 'pending_deposit_resolution' && (
                          <span className="ml-1.5 font-mono-num font-semibold text-[#B45309]">
                            (Đang treo {formatCurrency(booking.pendingDepositAmount)})
                          </span>
                        )}
                        {booking.depositTransferredToBookingCode && (
                          <span className="ml-1.5 text-[#1B5E4B]">
                            → Đơn {booking.depositTransferredToBookingCode}
                          </span>
                        )}
                      </div>
                      {booking.otaCancelStatus && booking.otaCancelStatus !== 'none' && (
                        <div className="text-[#9A3412]">
                          Trạng thái hủy OTA:{' '}
                          <strong>{getOtaCancelStatusLabel(booking.otaCancelStatus)}</strong>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {booking.depositResolutionStatus === 'pending_deposit_resolution' && (
                        <button
                          type="button"
                          onClick={() => setShowDepositResModal(true)}
                          className="h-8 px-3 rounded-lg bg-[#B45309] hover:bg-[#92400E] text-white text-[12px] font-medium"
                        >
                          Chốt xử lý cọc treo
                        </button>
                      )}
                      {staffProfile?.permissions.canUndoAction && (
                        <button
                          type="button"
                          onClick={() => setShowUndoCancelModal(true)}
                          className="h-8 px-3 rounded-lg border border-[#1B5E4B] bg-white hover:bg-[#E8F2EE] text-[#1B5E4B] text-[12px] font-medium inline-flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Khôi phục đơn (Undo Cancel)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {booking.status === 'reserved' && (
                  <>
                    <button
                      type="button"
                      onClick={handleCheckIn}
                      disabled={busy}
                      className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
                    >
                      <LogIn className="w-4 h-4" strokeWidth={1.5} />
                      Nhận phòng (Check-in)
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={busy}
                      className="h-9 px-4 rounded-lg border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] text-[13px] font-medium"
                    >
                      Hủy đặt phòng
                    </button>
                  </>
                )}

                {booking.status === 'in_house' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCheckOut(false)}
                      disabled={busy}
                      className="h-9 px-4 rounded-lg bg-[#1C1B18] hover:bg-black text-white text-[13px] font-medium inline-flex items-center gap-1.5"
                    >
                      <LogOut className="w-4 h-4" strokeWidth={1.5} />
                      Trả phòng (Check-out)
                    </button>
                    {canEarlyCheckout && (
                      <button
                        type="button"
                        onClick={() => setPostStayMode('early_checkout')}
                        disabled={busy}
                        className="h-9 px-4 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] hover:bg-[#FEF3C7] text-[#92400E] text-[13px] font-medium inline-flex items-center gap-1.5"
                      >
                        <Clock className="w-4 h-4" strokeWidth={1.5} />
                        Trả phòng sớm ({earlyStayedNights}đ
                        {earlySuggestedRefund > 0
                          ? ` • Dư ${formatCurrency(earlySuggestedRefund)}`
                          : ''}
                        )
                      </button>
                    )}
                    {staffProfile?.permissions.canUndoAction && (
                      <button
                        type="button"
                        onClick={() => setPostStayMode('reverse_checkin')}
                        disabled={busy}
                        className="h-9 px-3.5 rounded-lg border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] text-[13px] font-medium inline-flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Đảo Check-in nhầm
                      </button>
                    )}
                  </>
                )}

                {/* Part C Owner / SuperAdmin Controls for Checked-out Bookings */}
                {booking.status === 'checked_out' && isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPostStayMode('reopen_checked_out')}
                      className="h-9 px-3.5 rounded-lg border border-[#1B5E4B] bg-[#E8F2EE] hover:bg-[#D5EAE2] text-[#1B5E4B] text-[13px] font-medium"
                    >
                      Mở lại đơn (Hóa đơn / Lưu trú)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostStayMode('post_checkout_adjustment')}
                      className="h-9 px-3.5 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#F7F6F3] text-[#1C1B18] text-[13px] font-medium"
                    >
                      Điều chỉnh / Phụ thu sau Check-out
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostStayMode('void_checked_out')}
                      className="h-9 px-3.5 rounded-lg border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] text-[13px] font-medium"
                    >
                      Hủy đơn đã trả phòng (Void)
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => onOpenFormPreview(booking, 'payment_receipt')}
                  className="h-9 px-3.5 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#F7F6F3] text-[#1C1B18] text-[13px] font-medium inline-flex items-center gap-1.5"
                >
                  <FileText className="w-4 h-4" strokeWidth={1.5} />
                  Xuất Hóa đơn & VietQR
                </button>
              </div>

              {/* Record Payment Form (Quick 50% / 100% + Inline VietQR + Công nợ OTA) */}
              <form
                onSubmit={handleRecordPayment}
                className="rounded-xl border border-[#E7E3DA] bg-[#FAF9F6]/60 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[#1C1B18]">
                    <CreditCard className="w-4 h-4 text-[#0F5132]" strokeWidth={1.5} />
                    Thu tiền / Đặt cọc / Công nợ OTA / Hoàn tiền
                  </div>
                  {guestBalance > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-[#8A847C]">Nhập nhanh:</span>
                      <button
                        type="button"
                        onClick={() => setPayAmount(Math.round(guestBalance * 0.5))}
                        className="h-6 px-2 rounded-md border border-[#E7E3DA] bg-white hover:border-[#0F5132] hover:text-[#0F5132] font-mono-num font-medium"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayAmount(guestBalance)}
                        className="h-6 px-2 rounded-md border border-[#0F5132]/30 bg-[#E8F3EC] text-[#0F5132] hover:bg-[#0F5132] hover:text-white font-mono-num font-semibold"
                      >
                        100%
                      </button>
                      {vietQrUrl && (
                        <button
                          type="button"
                          onClick={() => setShowInlineQr((v) => !v)}
                          className="h-6 px-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] text-[#B45309] font-medium"
                        >
                          {showInlineQr ? 'Ẩn QR' : 'Hiện VietQR'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <select
                    value={payType}
                    onChange={(e) => setPayType(e.target.value as typeof payType)}
                    className="h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px]"
                  >
                    <option value="payment">Thu thanh toán</option>
                    <option value="deposit">Thu tiền cọc</option>
                    <option value="refund">Hoàn tiền khách</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={payAmount || ''}
                    onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
                    placeholder={`Còn lại: ${Math.max(0, guestBalance)}`}
                    className="h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px] font-mono-num"
                  />
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px]"
                  >
                    <option value="bank_transfer">Chuyển khoản (VietQR)</option>
                    <option value="cash">Tiền mặt</option>
                    <option value="card">Quẹt thẻ</option>
                    <option value="ota_debt">Công nợ OTA</option>
                  </select>
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-9 px-4 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[13px] font-medium"
                  >
                    Ghi nhận giao dịch
                  </button>
                </div>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Ghi chú phiếu thu (tùy chọn)..."
                  className="w-full h-8 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
                />
                {showInlineQr && guestBalance > 0 && vietQrUrl && (
                  <div className="pt-3 flex flex-col items-center gap-1.5 border-t border-[#E7E3DA] text-center">
                    <img
                      src={vietQrUrl}
                      alt="VietQR"
                      className="w-44 max-w-full h-auto rounded-xl border border-[#E7E3DA] bg-white p-2"
                    />
                    <span className="text-[12px] font-mono-num font-semibold text-[#1C1B18]">
                      {hotelConfig.bankAccount.bankId} • {hotelConfig.bankAccount.accountNo} •{' '}
                      {formatCurrency(Math.max(0, payAmount || guestBalance))}
                    </span>
                    <span className="text-[12px] font-mono-num text-[#57534E]">
                      ND: THANH TOAN {booking.bookingCode} P{booking.roomNumber}
                    </span>
                  </div>
                )}
              </form>

              {bookingTransactions.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold text-[#57534E]">
                    Lịch sử thu chi của đơn này
                  </h4>
                  <div className="border border-[#E5E2DC] rounded-xl divide-y divide-[#E5E2DC]">
                    {bookingTransactions.map((tx) => (
                      <div
                        key={tx.id}
                        className={`px-3.5 py-2.5 flex items-center justify-between text-[12px] ${
                          tx.status === 'voided_by_undo' ? 'opacity-50 line-through' : ''
                        }`}
                      >
                        <div>
                          <div className="font-medium text-[#1C1B18]">{tx.category}</div>
                          <div className="text-[11px] text-[#8A847C]">
                            {formatDateVN(tx.date)} • {getPaymentMethodLabel(tx.method)} •{' '}
                            {tx.createdByName}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div
                            className={`font-mono-num font-semibold ${
                              tx.direction === 'in' ? 'text-[#15803D]' : 'text-[#B91C1C]'
                            }`}
                          >
                            {tx.direction === 'in' ? '+' : '-'}
                            {formatCurrency(tx.amount)}
                          </div>
                          {isAdmin &&
                            tx.type !== 'reclassification_in' &&
                            tx.type !== 'reclassification_out' &&
                            tx.type !== 'reversal' && (
                              <button
                                type="button"
                                onClick={() => setReclassifyTx(tx)}
                                className="h-6 px-2 rounded border border-[#E5E2DC] hover:border-[#1B5E4B] text-[10px] text-[#57534E]"
                              >
                                Đổi PTTT
                              </button>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Part C Rule 6: Post-Checkout Adjustments History */}
              {bookingPostAdjustments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold text-[#57534E]">
                    Lịch sử Điều chỉnh & Phụ thu sau Check-out (`post_checkout_adjustments`)
                  </h4>
                  <div className="border border-[#E5E2DC] rounded-xl divide-y divide-[#E5E2DC] text-[12px]">
                    {bookingPostAdjustments.map((adj) => (
                      <div key={adj.id} className="px-3.5 py-2.5 space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[#1C1B18]">{adj.addedItemsSummary}</span>
                          <span
                            className={`font-mono-num font-semibold ${
                              adj.diffAmount >= 0 ? 'text-[#1B5E4B]' : 'text-[#B91C1C]'
                            }`}
                          >
                            {adj.diffAmount > 0 ? '+' : ''}
                            {formatCurrency(adj.diffAmount)}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono-num text-[#57534E]">
                          Hóa đơn: {formatCurrency(adj.oldTotal)} → {formatCurrency(adj.newTotal)} •
                          Hạch toán: {formatDateVN(adj.accountingDate)} • {adj.performedByName}
                        </div>
                        <div className="text-[11px] text-[#8A847C]">Lý do: {adj.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'occupants' && <OccupantOcrPanel booking={booking} />}

          {tab === 'pricing' && (
            <div className="space-y-5">
              {isHourly ? (
                <div className="rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] p-4 space-y-3">
                  <div className="text-[14px] font-semibold text-[#1C1B18]">
                    Điều chỉnh tiền phòng Theo Giờ (3 bậc lũy tiến)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[12px] text-[#57534E] mb-1">Số giờ ở thực tế</label>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={editHourlyHours}
                        onChange={(e) => {
                          const h = Math.max(1, Number(e.target.value) || 1);
                          setEditHourlyHours(h);
                          setEditHourlyTotal(calculateHourlyRoomTotal(h, roomType?.hourlyPricing));
                        }}
                        className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[#57534E] mb-1">
                        Tổng tiền phòng giờ (có thể sửa tay)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={10000}
                        value={editHourlyTotal}
                        onChange={(e) => setEditHourlyTotal(Math.max(0, Number(e.target.value) || 0))}
                        className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px] font-semibold text-[#1B5E4B]"
                      />
                    </div>
                    <div className="flex items-end">
                      {staffProfile?.permissions.canEditPrice && (
                        <button
                          type="button"
                          onClick={handleSavePricing}
                          disabled={busy}
                          className="w-full h-9 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium"
                        >
                          Lưu tiền phòng giờ
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <PricingEditor
                    roomType={roomType}
                    dailyRates={editRates}
                    selectedTierId={editTierId}
                    onChange={(next, tierId) => {
                      setEditRates(next);
                      if (tierId !== undefined) setEditTierId(tierId);
                    }}
                    disabled={!staffProfile?.permissions.canEditPrice}
                  />
                  {staffProfile?.permissions.canEditPrice && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSavePricing}
                        disabled={busy}
                        className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium"
                      >
                        Lưu thay đổi giá phòng
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Hourly Surcharge */}
              <div className="rounded-xl border border-[#E5E2DC] p-4 space-y-3">
                <div className="text-[13px] font-semibold text-[#1C1B18]">
                  Phụ thu Nhận phòng sớm / Trả phòng muộn theo giờ
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="number"
                    min={0}
                    step={50000}
                    value={surchargeAmount}
                    onChange={(e) => setSurchargeAmount(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="Số tiền phụ thu"
                    className="h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                  />
                  <input
                    type="text"
                    value={surchargeNote}
                    onChange={(e) => setSurchargeNote(e.target.value)}
                    placeholder="VD: Trả phòng muộn 3 giờ (15:00)"
                    className="h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={handleSaveSurcharge}
                    className="h-9 px-4 rounded-lg border border-[#1B5E4B] text-[#1B5E4B] hover:bg-[#E8F2EE] text-[13px] font-medium"
                  >
                    Cập nhật phụ thu
                  </button>
                </div>
              </div>

              {/* Services */}
              <div className="rounded-xl border border-[#E5E2DC] p-4 space-y-3">
                <div className="text-[13px] font-semibold text-[#1C1B18]">
                  Dịch vụ phát sinh / Minibar / Giặt ủi
                </div>
                <form onSubmit={handleAddService} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    type="text"
                    required
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder="Nước suối, thuê xe máy, giặt ủi..."
                    className="sm:col-span-5 h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                  />
                  <input
                    type="number"
                    min={1}
                    value={serviceQty}
                    onChange={(e) => setServiceQty(Math.max(1, Number(e.target.value) || 1))}
                    className="sm:col-span-2 h-9 px-2.5 text-center rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                  />
                  <input
                    type="number"
                    min={0}
                    step={5000}
                    value={servicePrice}
                    onChange={(e) => setServicePrice(Math.max(0, Number(e.target.value) || 0))}
                    className="sm:col-span-3 h-9 px-2.5 text-right rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-2 h-9 rounded-lg bg-[#1C1B18] text-white text-[13px] font-medium inline-flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Thêm
                  </button>
                </form>

                {(booking.services || []).length > 0 && (
                  <div className="divide-y divide-[#E5E2DC] border border-[#E5E2DC] rounded-lg">
                    {booking.services.map((s) => (
                      <div key={s.id} className="px-3 py-2 flex items-center justify-between text-[12px]">
                        <span>
                          {s.name} × <span className="font-mono-num">{s.quantity}</span> (
                          {formatCurrency(s.unitPrice)})
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono-num font-semibold">
                            {formatCurrency(s.total)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeBookingService(booking, s.id)}
                            className="text-[#8A847C] hover:text-[#B91C1C]"
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'transfer' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-xl border border-[#E5E2DC] p-4 space-y-3">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1C1B18]">
                  <ArrowRightLeft className="w-4 h-4 text-[#1B5E4B]" strokeWidth={1.5} />
                  Chuyển phòng (Split-Stay Chain)
                </div>
                <p className="text-[12px] text-[#57534E]">
                  Giữ nguyên lịch sử chặng cũ, chuyển phòng cũ sang Chờ dọn và mang toàn bộ hồ sơ
                  khách/ASM sang phòng mới.
                </p>

                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">
                    Chọn phòng trống đích
                  </label>
                  <select
                    value={transferRoomId}
                    onChange={(e) => setTransferRoomId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  >
                    <option value="">-- Chọn phòng trống --</option>
                    {transferableRooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        P.{r.roomNumber} — {r.roomTypeName} ({r.floor})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">
                    Cách tính giá phòng mới
                  </label>
                  <select
                    value={transferPricingMode}
                    onChange={(e) =>
                      setTransferPricingMode(e.target.value as typeof transferPricingMode)
                    }
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  >
                    <option value="new_room_rate">Áp dụng đơn giá mặc định của phòng mới</option>
                    <option value="keep_old_rate">Giữ nguyên giá phòng cũ (miễn phí nâng hạng)</option>
                    <option value="custom_rate">Nhập giá thỏa thuận mới</option>
                  </select>
                </div>

                {transferPricingMode === 'custom_rate' && (
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={transferCustomRate}
                    onChange={(e) => setTransferCustomRate(Number(e.target.value) || 0)}
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                  />
                )}

                <button
                  type="button"
                  onClick={handleTransferRoom}
                  disabled={busy || !transferRoomId}
                  className="w-full h-9 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-50 text-white text-[13px] font-medium"
                >
                  Xác nhận chuyển phòng
                </button>
              </div>

              <div className="rounded-xl border border-[#E5E2DC] p-4 space-y-3">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1C1B18]">
                  <Merge className="w-4 h-4 text-[#1B5E4B]" strokeWidth={1.5} />
                  Ghép phòng & Gộp hóa đơn
                </div>
                <p className="text-[12px] text-[#57534E]">
                  Gộp hóa đơn thanh toán chung vào 1 nhóm hoặc dồn khách từ phòng này sang ở chung
                  phòng khác và kết chuyển công nợ.
                </p>

                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">Hình thức ghép</label>
                  <select
                    value={mergeMode}
                    onChange={(e) => setMergeMode(e.target.value as typeof mergeMode)}
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  >
                    <option value="billing">Gộp hóa đơn thanh toán chung (giữ cả 2 phòng)</option>
                    <option value="consolidate">
                      Dồn khách sang ở chung phòng đích (trả P.{booking.roomNumber})
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">
                    Chọn phòng đích đang hoạt động
                  </label>
                  <select
                    value={mergeTargetId}
                    onChange={(e) => setMergeTargetId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  >
                    <option value="">-- Chọn phòng --</option>
                    {mergeCandidates.map((b) => (
                      <option key={b.id} value={b.id}>
                        P.{b.roomNumber} — {b.primaryGuestName} ({b.bookingCode})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleMergeRooms}
                  disabled={busy || !mergeTargetId}
                  className="w-full h-9 rounded-lg bg-[#1C1B18] hover:bg-black disabled:opacity-50 text-white text-[13px] font-medium"
                >
                  Thực hiện ghép phòng
                </button>
              </div>
            </div>
          )}

          {tab === 'forms' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-3">
                <h4 className="text-[14px] font-semibold text-[#1C1B18]">
                  Xuất biểu mẫu chuẩn gửi khách hàng (PNG / In PDF)
                </h4>
                <div className="space-y-2">
                  {[
                    {
                      type: 'booking_confirmation' as FormTemplateType,
                      title: '1. Phiếu Xác nhận Đặt phòng',
                      desc: 'Gửi qua Zalo / WhatsApp khi khách vừa đặt phòng',
                    },
                    {
                      type: 'payment_receipt' as FormTemplateType,
                      title: '2. Hóa đơn Thanh toán / Phiếu Thu',
                      desc: 'Kèm chi tiết tiền phòng/giờ, dịch vụ, phụ thu và mã VietQR',
                    },
                    {
                      type: 'registration_card' as FormTemplateType,
                      title: '3. Phiếu Đăng ký Nhận phòng',
                      desc: 'Danh sách khách lưu trú, thông tin Wi-Fi & khung chữ ký',
                    },
                  ].map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => onOpenFormPreview(booking, item.type)}
                      className="w-full text-left p-3.5 rounded-xl border border-[#E5E2DC] hover:border-[#1B5E4B] bg-white transition-colors"
                    >
                      <div className="text-[13px] font-semibold text-[#1C1B18]">{item.title}</div>
                      <div className="text-[12px] text-[#57534E]">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] p-4 flex flex-col items-center justify-center text-center">
                <div className="text-[13px] font-semibold text-[#1C1B18] mb-1">
                  Mã VietQR thanh toán động
                </div>
                <div className="text-[12px] font-mono-num text-[#1B5E4B] mb-3">
                  Số tiền cần thu: {formatCurrency(Math.max(0, guestBalance))}
                </div>
                {vietQrUrl ? (
                  <>
                    <img
                      src={vietQrUrl}
                      alt="VietQR"
                      className="w-56 h-auto rounded-xl border border-[#E5E2DC] bg-white p-2"
                    />
                    <div className="mt-2 text-[11px] font-mono-num text-[#57534E]">
                      {hotelConfig.bankAccount.bankId} • {hotelConfig.bankAccount.accountNo} •{' '}
                      {hotelConfig.bankAccount.accountName}
                    </div>
                  </>
                ) : (
                  <div className="text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-3">
                    Chưa nhập Số tài khoản ngân hàng. SuperAdmin vào mục Cài đặt để cấu hình VietQR
                    (MB Bank — LE DUC PHUONG).
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* GoHost-Inspired Sticky Bottom Action Bar (4 Priority Buttons + "... Khác" Menu) */}
        <div className="shrink-0 px-6 py-3 border-t border-[#E7E3DA] bg-white flex flex-wrap items-center justify-between gap-2 relative">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTab('pricing');
                setEditRates(booking.dailyRates);
                setEditHourlyHours(booking.hourlyHours || 2);
                setEditHourlyTotal(booking.grossRoomTotal);
              }}
              className="h-9 px-3.5 rounded-lg border border-[#E7E3DA] hover:bg-[#FAF9F6] text-[13px] font-medium text-[#1C1B18]"
            >
              Sửa giá / DV
            </button>

            {booking.status === 'reserved' && (
              <button
                type="button"
                onClick={handleCheckIn}
                disabled={busy}
                className="h-9 px-4 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
              >
                <LogIn className="w-4 h-4" strokeWidth={1.5} />
                Nhận phòng
              </button>
            )}

            {booking.status === 'in_house' && (
              <button
                type="button"
                onClick={() => handleCheckOut(false)}
                disabled={busy}
                className="h-9 px-4 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
                Trả phòng
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setTab('overview');
                if (guestBalance > 0) setPayAmount(guestBalance);
              }}
              className="h-9 px-3.5 rounded-lg border border-[#0F5132]/30 bg-[#E8F3EC] hover:bg-[#0F5132] text-[#0F5132] hover:text-white text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <CreditCard className="w-4 h-4" strokeWidth={1.5} />
              Thanh toán
            </button>

            {/* Grouped "... Khác" Popover Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu((v) => !v)}
                className="h-9 px-3 rounded-lg border border-[#E7E3DA] hover:bg-[#FAF9F6] text-[13px] font-medium text-[#57534E] inline-flex items-center gap-1"
              >
                <MoreHorizontal className="w-4 h-4" strokeWidth={1.5} />
                Khác
              </button>

              {showMoreMenu && (
                <div className="absolute bottom-11 left-0 w-60 bg-white border border-[#E7E3DA] rounded-xl shadow-xl py-1.5 z-50 text-[12px]">
                  {booking.status === 'in_house' && canEarlyCheckout && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreMenu(false);
                        setPostStayMode('early_checkout');
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-[#FAF9F6] text-[#B45309] font-medium"
                    >
                      Trả phòng sớm ({earlyStayedNights}đ)
                    </button>
                  )}
                  {booking.status === 'in_house' && staffProfile?.permissions.canUndoAction && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreMenu(false);
                        setPostStayMode('reverse_checkin');
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-[#FAF9F6] text-[#1C1B18]"
                    >
                      Đảo Check-in nhầm
                    </button>
                  )}
                  {(booking.status === 'reserved' || booking.status === 'in_house') && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreMenu(false);
                        setTab('transfer');
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-[#FAF9F6] text-[#1C1B18]"
                    >
                      Đổi phòng (Split-Stay) / Ghép đơn
                    </button>
                  )}
                  {booking.status === 'checked_out' && isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          setPostStayMode('reopen_checked_out');
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-[#FAF9F6] text-[#0F5132] font-medium"
                      >
                        Mở lại đơn (Hóa đơn / Lưu trú)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          setPostStayMode('post_checkout_adjustment');
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-[#FAF9F6] text-[#1C1B18]"
                      >
                        Điều chỉnh / Phụ thu sau Check-out
                      </button>
                    </>
                  )}

                  <div className="my-1 border-t border-[#F1EFEA]" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowMoreMenu(false);
                      onOpenFormPreview(booking, 'payment_receipt');
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-[#FAF9F6] text-[#1C1B18]"
                  >
                    Phiếu thanh toán &amp; VietQR
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMoreMenu(false);
                      onOpenFormPreview(booking, 'booking_confirmation');
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-[#FAF9F6] text-[#1C1B18]"
                  >
                    Phiếu xác nhận đặt phòng
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMoreMenu(false);
                      onOpenFormPreview(booking, 'registration_card');
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-[#FAF9F6] text-[#1C1B18]"
                  >
                    Phiếu đăng ký nhận phòng
                  </button>

                  {(booking.status === 'reserved' ||
                    (booking.status === 'checked_out' && isAdmin)) && (
                    <>
                      <div className="my-1 border-t border-[#F1EFEA]" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          if (booking.status === 'reserved') handleCancel();
                          else setPostStayMode('void_checked_out');
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-[#FEF2F2] text-[#B91C1C] font-medium"
                      >
                        {booking.status === 'reserved'
                          ? 'Hủy đặt phòng'
                          : 'Hủy đơn đã trả phòng (Void)'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="text-[12px] font-mono-num text-[#57534E]">
            Còn lại:{' '}
            <strong className={guestBalance > 0 ? 'text-[#B45309]' : 'text-[#0F5132]'}>
              {formatCurrency(Math.max(0, guestBalance))}
            </strong>
          </div>
        </div>
      </div>

      {showCancelModal && (
        <CancelBookingModal
          bookingsScope={[booking]}
          onClose={() => setShowCancelModal(false)}
        />
      )}

      {showDepositResModal && (
        <DepositResolutionModal
          booking={booking}
          onClose={() => setShowDepositResModal(false)}
        />
      )}

      {showUndoCancelModal && (
        <UndoCancelModal
          booking={booking}
          onClose={() => setShowUndoCancelModal(false)}
        />
      )}

      {postStayMode && (
        <PostStayAccountingModal
          booking={booking}
          mode={postStayMode}
          onClose={() => setPostStayMode(null)}
          onProceedToCancelAfterReverse={() => setShowCancelModal(true)}
        />
      )}

      {reclassifyTx && (
        <ReclassifyPaymentModal
          tx={reclassifyTx}
          onClose={() => setReclassifyTx(null)}
        />
      )}
    </div>
  );
};
