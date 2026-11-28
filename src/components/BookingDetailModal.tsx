import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  BedDouble,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  FileText,
  History,
  LogIn,
  LogOut,
  Merge,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  StickyNote,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type {
  Booking,
  DailyRate,
  FormTemplateType,
  PaymentMethod,
  Room,
  ServiceCatalogItem,
  ServiceItemGroup,
} from '../types/pms';
import { classifyServiceGroup, getServiceGroupLabel } from '../lib/revenueMetrics';
import {
  calculateHourlyRoomTotal,
  diffDays,
  formatCurrency,
  formatDateTimeVN,
  formatDateVN,
  formatShortDate,
  getBookingGuestBalance,
  getCancellationTypeLabel,
  getDepositResolutionLabel,
  getOtaCancelStatusLabel,
  getPaymentMethodLabel,
  getSourceLabel,
  getStatusLabel,
  isBookingBlockingCalendar,
  isDateRangeOverlap,
  sumDailyRates,
  todayISO,
} from '../lib/utils';
import {
  addBookingService,
  bulkCheckInGroup,
  checkInBooking,
  checkOutBooking,
  consolidateRoomIntoTarget,
  mergeBookingsIntoGroup,
  recordTransaction,
  removeBookingService,
  transferBookingRoom,
  undoBookingAction,
  updateBookingNote,
  updateBookingPricing,
  updateHourlySurcharge,
  upsertGuestProfile,
} from '../lib/pmsActions';
import { buildVietQrUrl } from '../lib/vietqr';
import { PricingEditor } from './PricingEditor';
import { OccupantOcrPanel } from './OccupantOcrPanel';
import { CancelBookingModal } from './CancelBookingModal';
import { DepositResolutionModal } from './DepositResolutionModal';
import { UndoCancelModal } from './UndoCancelModal';
import { PostStayAccountingModal, type PostStayModalMode } from './PostStayAccountingModal';
import { ReclassifyPaymentModal } from './ReclassifyPaymentModal';

export type BookingDetailTab = 'details' | 'occupants' | 'payment' | 'history';

interface BookingDetailModalProps {
  bookingId: string;
  initialTab?: BookingDetailTab;
  openTransferInitially?: boolean;
  preselectedTransferRoom?: Room | null;
  onClose: () => void;
  onOpenFormPreview: (booking: Booking, type: FormTemplateType) => void;
}

export const BookingDetailModal: React.FC<BookingDetailModalProps> = ({
  bookingId,
  initialTab = 'details',
  openTransferInitially = false,
  preselectedTransferRoom = null,
  onClose,
  onOpenFormPreview,
}) => {
  const {
    bookings,
    groups,
    activeRooms,
    roomTypes,
    guests,
    customerGroups,
    transactions,
    postCheckoutAdjustments,
    auditLogs,
    hotelConfig,
    actor,
    isAdmin,
    staffProfile,
    notify,
    triggerUndoBanner,
  } = usePms();

  const rootBooking = bookings.find((b) => b.id === bookingId);

  const groupRecord = useMemo(
    () => (rootBooking?.groupId ? groups.find((g) => g.id === rootBooking.groupId) : undefined),
    [groups, rootBooking?.groupId]
  );

  const groupSiblings = useMemo(() => {
    if (!rootBooking) return [];
    if (!rootBooking.groupId) return [rootBooking];
    const list = bookings
      .filter((b) => b.groupId === rootBooking.groupId)
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
    return list.length > 0 ? list : [rootBooking];
  }, [bookings, rootBooking]);

  const [tab, setTab] = useState<BookingDetailTab>(initialTab);
  const [selectedRoomId, setSelectedRoomId] = useState<string>(bookingId);

  // Sync selected room & tab whenever bookingId changes (eliminates stale room/code mismatch!)
  useEffect(() => {
    setSelectedRoomId(bookingId);
    setTab(initialTab);
  }, [bookingId, initialTab]);

  const booking = useMemo(
    () => groupSiblings.find((b) => b.id === selectedRoomId) || rootBooking,
    [groupSiblings, selectedRoomId, rootBooking]
  );

  // Accordion state per room card + inline sub-editors (pricing / services / transfer)
  const [expandedRoomIds, setExpandedRoomIds] = useState<Record<string, boolean>>(() => ({
    [bookingId]: true,
  }));
  const [activeRoomSubPanel, setActiveRoomSubPanel] = useState<{
    bookingId: string;
    panel: 'pricing' | 'services' | 'transfer';
  } | null>(() =>
    openTransferInitially || preselectedTransferRoom
      ? { bookingId, panel: 'transfer' }
      : null
  );
  const [openRoomActionMenuId, setOpenRoomActionMenuId] = useState<string | null>(null);

  // General Info inline editing (Guest name/phone + Booking Note)
  const [editingGuestBasic, setEditingGuestBasic] = useState(false);
  const [guestNameDraft, setGuestNameDraft] = useState('');
  const [guestPhoneDraft, setGuestPhoneDraft] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  // Pricing edit state (scoped to active sub-panel room)
  const [editRates, setEditRates] = useState<DailyRate[]>([]);
  const [editTierId, setEditTierId] = useState<string | null>(null);
  const [editHourlyHours, setEditHourlyHours] = useState<number>(2);
  const [editHourlyTotal, setEditHourlyTotal] = useState<number>(0);

  // Service state (quick-pick from centralized serviceCatalog OR custom entry)
  const [serviceCatalogFilter, setServiceCatalogFilter] = useState<'all' | ServiceItemGroup>('all');
  const [serviceCustomMode, setServiceCustomMode] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [serviceCategory, setServiceCategory] = useState<ServiceItemGroup>('drink');
  const [serviceName, setServiceName] = useState('');
  const [serviceQty, setServiceQty] = useState(1);
  const [servicePrice, setServicePrice] = useState(20000);
  const [surchargeAmount, setSurchargeAmount] = useState(0);
  const [surchargeNote, setSurchargeNote] = useState('');

  // Payment form state
  const [payAmount, setPayAmount] = useState(0);
  const [payType, setPayType] = useState<'payment' | 'deposit' | 'refund'>('payment');
  const [payMethod, setPayMethod] = useState<PaymentMethod>(
    rootBooking?.source === 'ota' ? 'ota_debt' : 'bank_transfer'
  );
  const [payNote, setPayNote] = useState('');
  const [showInlineQr, setShowInlineQr] = useState(false);

  // Transfer & Merge state
  const [transferRoomId, setTransferRoomId] = useState(preselectedTransferRoom?.id || '');
  const [transferPricingMode, setTransferPricingMode] = useState<
    'new_room_rate' | 'keep_old_rate' | 'custom_rate'
  >('new_room_rate');
  const [transferCustomRate, setTransferCustomRate] = useState(400000);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeMode, setMergeMode] = useState<'billing' | 'consolidate'>('billing');

  // Header overflow menu, Undo, and Sub-modals
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showUndoBox, setShowUndoBox] = useState(false);
  const [undoReason, setUndoReason] = useState('');
  const [cancelScope, setCancelScope] = useState<Booking[] | null>(null);
  const [depositResBooking, setDepositResBooking] = useState<Booking | null>(null);
  const [undoCancelBooking, setUndoCancelBooking] = useState<Booking | null>(null);
  const [postStayTarget, setPostStayTarget] = useState<{
    booking: Booking;
    mode: PostStayModalMode;
  } | null>(null);
  const [reclassifyTx, setReclassifyTx] = useState<(typeof transactions)[number] | null>(null);
  const [busy, setBusy] = useState(false);

  // Android Back button support (Layer 2: closes BookingDetailModal cleanly without losing Layer 1 Quick-Preview — StrictMode safe)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = () => {
    const st = window.history.state as { lfpmsLayer?: string } | null;
    if (st?.lfpmsLayer === 'booking_detail') {
      window.history.back();
      return;
    }
    onCloseRef.current();
  };

  useEffect(() => {
    try {
      const currentState = window.history.state as { lfpmsLayer?: string } | null;
      if (currentState?.lfpmsLayer !== 'booking_detail') {
        window.history.pushState({ lfpmsLayer: 'booking_detail', bookingId }, '');
      }
    } catch {
      // Ignore History API restrictions
    }

    const handlePopState = () => {
      const st = window.history.state as { lfpmsLayer?: string } | null;
      if (st?.lfpmsLayer === 'booking_detail') return;
      onCloseRef.current();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

  useEffect(() => {
    if (!rootBooking) return;
    setGuestNameDraft(rootBooking.primaryGuestName || '');
    setGuestPhoneDraft(rootBooking.primaryGuestPhone || '');
    setNoteDraft(rootBooking.note || '');
  }, [rootBooking?.id, rootBooking?.primaryGuestName, rootBooking?.primaryGuestPhone, rootBooking?.note]);

  const siblingIdSet = useMemo(() => new Set(groupSiblings.map((b) => b.id)), [groupSiblings]);
  const siblingCodeSet = useMemo(() => new Set(groupSiblings.map((b) => b.bookingCode)), [groupSiblings]);

  const scopeTransactions = useMemo(
    () =>
      transactions
        .filter((t) => (t.bookingId ? siblingIdSet.has(t.bookingId) : false))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [transactions, siblingIdSet]
  );

  const scopePostAdjustments = useMemo(
    () =>
      postCheckoutAdjustments.filter((a) => siblingIdSet.has(a.bookingId)),
    [postCheckoutAdjustments, siblingIdSet]
  );

  const scopeAuditLogs = useMemo(() => {
    const gId = rootBooking?.groupId || '';
    return auditLogs.filter((l) => {
      if (l.targetId && (siblingIdSet.has(l.targetId) || (gId && l.targetId === gId))) return true;
      const lbl = l.targetLabel || '';
      for (const code of siblingCodeSet) {
        if (code && lbl.includes(code)) return true;
      }
      if (groupRecord?.groupCode && lbl.includes(groupRecord.groupCode)) return true;
      return false;
    });
  }, [auditLogs, siblingIdSet, siblingCodeSet, rootBooking?.groupId, groupRecord?.groupCode]);

  const chainBookings = useMemo(() => {
    if (!booking?.bookingChainId) return [];
    return bookings
      .filter((b) => b.bookingChainId === booking.bookingChainId)
      .sort((a, b) => (a.chainSequence || 1) - (b.chainSequence || 1));
  }, [bookings, booking?.bookingChainId]);

  const activeServiceCatalog = useMemo(
    () =>
      (hotelConfig.serviceCatalog || [])
        .filter((item) => item.isActive !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0)),
    [hotelConfig.serviceCatalog]
  );

  const filteredServiceCatalog = useMemo(
    () =>
      serviceCatalogFilter === 'all'
        ? activeServiceCatalog
        : activeServiceCatalog.filter((item) => item.category === serviceCatalogFilter),
    [activeServiceCatalog, serviceCatalogFilter]
  );

  if (!rootBooking || !booking) return null;

  const isMultiRoomGroup = groupSiblings.length > 1;
  const headerCode = isMultiRoomGroup
    ? groupRecord?.groupCode || rootBooking.bookingCode.replace(/-\d+$/, '')
    : rootBooking.bookingCode;

  const primaryGuestRecord = guests.find((g) => g.id === rootBooking.primaryGuestId);
  const primaryGuestGroup = primaryGuestRecord?.customerGroupId
    ? customerGroups.find((cg) => cg.id === primaryGuestRecord.customerGroupId)
    : undefined;

  const nonCancelledSiblings = groupSiblings.filter(
    (b) => b.status !== 'cancelled' && b.status !== 'no_show'
  );
  const metricsScope = nonCancelledSiblings.length > 0 ? nonCancelledSiblings : groupSiblings;
  const scopeTotalAmount = metricsScope.reduce(
    (s, b) => s + (b.grossRoomTotal || 0) + (b.serviceTotal || 0) + (b.hourlySurcharge || 0),
    0
  );
  const scopeTotalPaid = metricsScope.reduce(
    (s, b) => s + (b.depositPaid || 0) + (b.guestPaid || 0),
    0
  );
  const scopeTotalBalance = Math.max(
    0,
    metricsScope.reduce((s, b) => s + Math.max(0, getBookingGuestBalance(b)), 0)
  );

  const guestBalance = getBookingGuestBalance(booking);
  const today = todayISO();
  const defaultCiTime = hotelConfig.checkInTime || '14:00';
  const defaultCoTime = hotelConfig.checkOutTime || '12:00';

  const allRoomsExpanded = groupSiblings.every((b) => Boolean(expandedRoomIds[b.id]));
  const toggleAllRooms = () => {
    if (allRoomsExpanded) {
      setExpandedRoomIds({});
      setActiveRoomSubPanel(null);
    } else {
      const next: Record<string, boolean> = {};
      for (const b of groupSiblings) next[b.id] = true;
      setExpandedRoomIds(next);
    }
  };

  const toggleSingleRoom = (id: string) => {
    setExpandedRoomIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openRoomSubPanel = (rb: Booking, panel: 'pricing' | 'services' | 'transfer') => {
    setExpandedRoomIds((prev) => ({ ...prev, [rb.id]: true }));
    setSelectedRoomId(rb.id);
    if (activeRoomSubPanel?.bookingId === rb.id && activeRoomSubPanel.panel === panel) {
      setActiveRoomSubPanel(null);
      return;
    }
    if (panel === 'pricing') {
      setEditRates(rb.dailyRates || []);
      setEditTierId(rb.selectedPriceTierId || null);
      setEditHourlyHours(rb.hourlyHours || 2);
      setEditHourlyTotal(rb.grossRoomTotal || 0);
    } else if (panel === 'services') {
      setSurchargeAmount(rb.hourlySurcharge || 0);
      setSurchargeNote(rb.hourlySurchargeNote || '');
    } else if (panel === 'transfer') {
      setTransferRoomId(preselectedTransferRoom?.id || '');
    }
    setActiveRoomSubPanel({ bookingId: rb.id, panel });
  };

  const getTransferableRoomsFor = (rb: Booking) => {
    const start = rb.status === 'in_house' ? todayISO() : rb.checkIn;
    return activeRooms.filter((r) => {
      if (r.id === rb.roomId || r.hkStatus === 'maintenance') return false;
      const conflict = bookings.some(
        (b) =>
          b.id !== rb.id &&
          b.roomId === r.id &&
          isBookingBlockingCalendar(b.status) &&
          isDateRangeOverlap(b.checkIn, b.checkOut, start, rb.checkOut)
      );
      return !conflict;
    });
  };

  const mergeCandidatesFor = (rb: Booking) =>
    bookings.filter(
      (b) => b.id !== rb.id && (b.status === 'in_house' || b.status === 'reserved')
    );

  const vietQrUrl = buildVietQrUrl({
    bankAccount: hotelConfig.bankAccount,
    amount: Math.max(0, payAmount || guestBalance),
    addInfo: `THANH TOAN ${booking.bookingCode} P${booking.roomNumber}`,
  });

  // --- Action Handlers ---
  const handleCheckInRoom = async (rb: Booking) => {
    setBusy(true);
    try {
      await checkInBooking(rb, actor);
      notify(`Đã Check-in P.${rb.roomNumber} (${rb.primaryGuestName})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi Check-in', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkCheckInAll = async () => {
    const reservedList = groupSiblings.filter((b) => b.status === 'reserved');
    if (reservedList.length === 0) return;
    setBusy(true);
    try {
      if (reservedList.length === 1) {
        await checkInBooking(reservedList[0], actor);
        notify(`Đã Check-in P.${reservedList[0].roomNumber}`);
      } else {
        const count = await bulkCheckInGroup(reservedList, actor);
        notify(`Đã Check-in cả đoàn (${count} phòng)`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi Check-in đoàn', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOutRoom = async (rb: Booking) => {
    setBusy(true);
    try {
      await checkOutBooking(rb, actor, { earlyCheckOut: false });
      notify(`Đã trả phòng P.${rb.roomNumber} — Phòng chuyển sang Chờ dọn`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi trả phòng', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveGeneralGuest = async () => {
    if (!guestNameDraft.trim()) {
      notify('Họ tên khách không được để trống', 'warning');
      return;
    }
    setBusy(true);
    try {
      await upsertGuestProfile(
        {
          id: rootBooking.primaryGuestId,
          fullName: guestNameDraft.trim(),
          phone: guestPhoneDraft.trim(),
          guestCategory: primaryGuestRecord?.guestCategory || 'vietnamese',
          nationality: primaryGuestRecord?.nationality || 'VN',
        },
        guests,
        false
      );
      notify('Đã cập nhật thông tin khách hàng');
      setEditingGuestBasic(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi cập nhật khách', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNote = async () => {
    setBusy(true);
    try {
      await updateBookingNote(rootBooking, noteDraft, actor);
      notify('Đã lưu ghi chú đặt phòng');
      setEditingNote(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi lưu ghi chú', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePricingForRoom = async (rb: Booking) => {
    setBusy(true);
    try {
      if (rb.bookingMode === 'hourly') {
        await updateBookingPricing(
          rb,
          {
            dailyRates: [{ date: rb.checkIn, rate: editHourlyTotal }],
            selectedPriceTierId: null,
            hourlyHours: editHourlyHours,
            hourlyRoomTotal: editHourlyTotal,
          },
          actor
        );
      } else {
        await updateBookingPricing(
          rb,
          {
            dailyRates: editRates,
            selectedPriceTierId: editTierId,
          },
          actor
        );
      }
      notify(`Đã lưu giá phòng P.${rb.roomNumber}`);
      setActiveRoomSubPanel(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi lưu giá phòng', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSelectCatalogItem = (item: ServiceCatalogItem) => {
    setServiceCustomMode(false);
    setSelectedCatalogId(item.id);
    setServiceName(item.name);
    setServicePrice(item.price);
    setServiceCategory(item.category);
  };

  const handleAddServiceForRoom = async (e: React.FormEvent, rb: Booking) => {
    e.preventDefault();
    if (!serviceName.trim() || servicePrice <= 0) {
      notify('Vui lòng chọn dịch vụ hoặc nhập tên & đơn giá hợp lệ', 'warning');
      return;
    }
    setBusy(true);
    try {
      await addBookingService(
        rb,
        {
          name: serviceName.trim(),
          quantity: serviceQty,
          unitPrice: servicePrice,
          category: serviceCategory,
          catalogItemId: serviceCustomMode ? undefined : selectedCatalogId || undefined,
        },
        actor
      );
      setServiceName('');
      setSelectedCatalogId('');
      setServiceQty(1);
      notify(`Đã thêm dịch vụ vào P.${rb.roomNumber}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSurchargeForRoom = async (rb: Booking) => {
    setBusy(true);
    try {
      await updateHourlySurcharge(rb, surchargeAmount, surchargeNote, actor);
      notify(`Đã lưu phụ thu P.${rb.roomNumber}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (payAmount <= 0) {
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
          payType === 'deposit'
            ? 'Tiền cọc phòng'
            : payType === 'refund'
              ? 'Hoàn tiền khách'
              : 'Thanh toán tiền phòng',
        amount: payAmount,
        method: payMethod,
        note: payNote,
        actor,
        accountingLockDate: hotelConfig.accountingLockDate,
      });
      setPayAmount(0);
      setPayNote('');
      notify(`Đã ghi nhận giao dịch cho P.${booking.roomNumber}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi ghi nhận giao dịch', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleTransferRoom = async (rb: Booking) => {
    const targetRoom = activeRooms.find((r) => r.id === transferRoomId);
    if (!targetRoom) {
      notify('Vui lòng chọn phòng đích cần chuyển', 'warning');
      return;
    }
    const targetType = roomTypes.find((rt) => rt.id === targetRoom.roomTypeId);
    const defaultTier = targetType?.priceTiers.find((p) => p.isDefault) || targetType?.priceTiers[0];
    const resolvedTargetRate =
      transferPricingMode === 'custom_rate'
        ? transferCustomRate
        : transferPricingMode === 'keep_old_rate'
          ? rb.dailyRates?.[0]?.rate || defaultTier?.price || 400000
          : defaultTier?.price || 400000;
    setBusy(true);
    try {
      await transferBookingRoom({
        booking: rb,
        targetRoom,
        transferDate: today,
        pricingMode: transferPricingMode,
        targetRoomRate: resolvedTargetRate,
        actor,
      });
      notify(`Đã chuyển P.${rb.roomNumber} → P.${targetRoom.roomNumber}`);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi chuyển phòng', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleMergeRoom = async (rb: Booking) => {
    const target = bookings.find((b) => b.id === mergeTargetId);
    if (!target) {
      notify('Vui lòng chọn đơn đích để ghép', 'warning');
      return;
    }
    setBusy(true);
    try {
      if (mergeMode === 'billing') {
        await mergeBookingsIntoGroup([rb, target], '', actor);
        notify(`Đã ghép hóa đơn P.${rb.roomNumber} chung với P.${target.roomNumber}`);
      } else {
        await consolidateRoomIntoTarget(rb, target, actor);
        notify(`Đã gộp toàn bộ khách & phí P.${rb.roomNumber} sang P.${target.roomNumber}`);
      }
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi ghép phòng', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleUndoNow = async () => {
    if (!undoReason.trim()) {
      notify('Vui lòng nhập lý do hoàn tác', 'warning');
      return;
    }
    setBusy(true);
    try {
      await undoBookingAction({ booking, reason: undoReason.trim(), actor });
      triggerUndoBanner({
        bookingId: booking.id,
        actionType: 'undo',
        label: `Đã hoàn tác P.${booking.roomNumber}`,
        previousState: {},
      });
      setShowUndoBox(false);
      setUndoReason('');
      notify('Đã hoàn tác thao tác thành công');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Không thể hoàn tác', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reservedSiblings = groupSiblings.filter((b) => b.status === 'reserved');
  const inHouseSiblings = groupSiblings.filter((b) => b.status === 'in_house');
  const initials = (rootBooking.primaryGuestName || 'KH')
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join('');

  const statusBadgeClass = (st: Booking['status']) =>
    st === 'in_house'
      ? 'bg-[#E8F3EC] text-[#0F5132]'
      : st === 'reserved'
        ? 'bg-[#FFFBEB] text-[#B45309]'
        : st === 'cancelled' || st === 'no_show'
          ? 'bg-[#FEF2F2] text-[#B91C1C]'
          : 'bg-[#E6EFF1] text-[#335C67]';

  return (
    <div
      data-testid="booking-detail-modal-backdrop"
      className="fixed inset-0 left-0 right-0 top-0 bottom-0 w-screen max-w-[100vw] z-50 bg-black/45 flex justify-end overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Chi tiết đơn đặt phòng"
        data-testid="booking-detail-modal"
        className="bg-white border-l border-[#E7E3DA] w-full max-w-[100vw] sm:max-w-2xl h-full flex flex-col shadow-2xl overflow-hidden"
      >
        {/* COMPACT 1-LINE FIXED HEADER (52px) */}
        <div
          data-testid="booking-detail-header"
          className="h-[52px] px-2.5 sm:px-4 border-b border-[#E7E3DA] bg-white flex items-center justify-between gap-2 shrink-0"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={requestClose}
              aria-label="Quay lại"
              data-testid="booking-detail-back-btn"
              className="w-9 h-9 rounded-lg hover:bg-[#F5F4F0] text-[#1C1B18] flex items-center justify-center shrink-0"
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={1.9} />
            </button>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(headerCode);
                notify(`Đã sao chép mã ${headerCode}`, 'info');
              }}
              data-testid="booking-detail-header-code"
              className="inline-flex items-center gap-1 font-mono-num text-[14px] font-bold text-[#1C1B18] hover:text-[#0F5132] truncate"
              title="Bấm sao chép mã đơn"
            >
              {!isMultiRoomGroup && (
                <span className="text-[#0F5132]">P.{rootBooking.roomNumber} ·</span>
              )}
              <span className="truncate">{headerCode}</span>
              <Copy className="w-3 h-3 text-[#8A847C] shrink-0" strokeWidth={1.6} />
            </button>

            {isMultiRoomGroup ? (
              <span
                data-testid="booking-detail-room-count"
                className="px-2 py-0.5 rounded-full bg-[#E8F3EC] text-[#0F5132] text-[11px] font-semibold shrink-0"
              >
                {groupSiblings.length} phòng
              </span>
            ) : (
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${statusBadgeClass(
                  rootBooking.status
                )}`}
              >
                {getStatusLabel(rootBooking.status)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 relative">
            <button
              type="button"
              onClick={() => setShowHeaderMenu((v) => !v)}
              aria-label="Tùy chọn khác"
              data-testid="booking-detail-header-menu-btn"
              className="relative z-50 w-9 h-9 rounded-lg hover:bg-[#F5F4F0] text-[#57534E] flex items-center justify-center"
            >
              <MoreVertical className="w-4 h-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Đóng"
              data-testid="booking-detail-close-btn"
              className="w-9 h-9 rounded-lg hover:bg-[#F5F4F0] text-[#57534E] flex items-center justify-center"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>

            {showHeaderMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowHeaderMenu(false)}
                />
                <div className="absolute right-0 top-10 z-50 w-60 bg-white border border-[#E7E3DA] rounded-xl shadow-2xl py-1.5 text-[12px]">
                  {booking.status !== 'cancelled' &&
                    booking.status !== 'no_show' &&
                    booking.lastActionSnapshot &&
                    !['check_in', 'check_out', 'early_checkout'].includes(
                      String(booking.lastActionSnapshot.action || '')
                    ) &&
                    staffProfile?.permissions.canUndoAction && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowHeaderMenu(false);
                          setShowUndoBox(true);
                        }}
                        className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FFFBEB] text-[#92400E] font-medium flex items-center gap-2"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Hoàn tác thao tác vừa rồi
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      onOpenFormPreview(booking, 'payment_receipt');
                    }}
                    className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#1C1B18] flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#0F5132]" /> In Phiếu thanh toán & VietQR
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      onOpenFormPreview(booking, 'booking_confirmation');
                    }}
                    className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#1C1B18] flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#57534E]" /> In Phiếu xác nhận đặt phòng
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      onOpenFormPreview(booking, 'registration_card');
                    }}
                    className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#1C1B18] flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#57534E]" /> In Phiếu đăng ký nhận phòng
                  </button>

                  {booking.status === 'checked_out' && isAdmin && (
                    <>
                      <div className="my-1 border-t border-[#F1EFEA]" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowHeaderMenu(false);
                          setPostStayTarget({ booking, mode: 'reopen_checked_out' });
                        }}
                        className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#0F5132] font-medium"
                      >
                        Mở lại đơn (Hóa đơn / Lưu trú)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowHeaderMenu(false);
                          setPostStayTarget({ booking, mode: 'post_checkout_adjustment' });
                        }}
                        className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#1C1B18]"
                      >
                        Điều chỉnh / Phụ thu sau Check-out
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowHeaderMenu(false);
                          setPostStayTarget({ booking, mode: 'void_checked_out' });
                        }}
                        className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FEF2F2] text-[#B91C1C] font-medium"
                      >
                        Hủy đơn đã trả phòng (Void)
                      </button>
                    </>
                  )}

                  {reservedSiblings.length > 0 && (
                    <>
                      <div className="my-1 border-t border-[#F1EFEA]" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowHeaderMenu(false);
                          setCancelScope(isMultiRoomGroup ? reservedSiblings : [booking]);
                        }}
                        className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FEF2F2] text-[#B91C1C] font-medium"
                      >
                        {isMultiRoomGroup ? 'Hủy một phần / cả đoàn' : 'Hủy đặt phòng'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Universal Undo Reason Bar */}
        {showUndoBox && (
          <div className="px-4 py-2.5 bg-[#FFFBEB] border-b border-[#FDE68A] flex flex-wrap items-center gap-2 shrink-0">
            <input
              type="text"
              value={undoReason}
              onChange={(e) => setUndoReason(e.target.value)}
              placeholder="Nhập lý do hoàn tác (bắt buộc lưu vết)..."
              className="flex-1 min-w-[200px] h-9 px-3 rounded-lg border border-[#F59E0B] bg-white text-[12px]"
            />
            <button
              type="button"
              onClick={() => void handleUndoNow()}
              disabled={busy}
              className="h-9 px-3.5 rounded-lg bg-[#B45309] text-white text-[12px] font-medium"
            >
              Xác nhận
            </button>
          </div>
        )}

        {/* COMPACT 4-TAB BAR (Zero clipping on 390px screens!) */}
        <div
          data-testid="booking-detail-tabs"
          className="grid grid-cols-4 border-b border-[#E5E2DC] bg-[#FAF9F6] shrink-0"
        >
          {(
            [
              { id: 'details', label: 'Chi tiết' },
              { id: 'occupants', label: 'Khách & OCR' },
              { id: 'payment', label: 'Thanh toán' },
              { id: 'history', label: 'Lịch sử' },
            ] as Array<{ id: BookingDetailTab; label: string }>
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`booking-detail-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`min-h-[42px] px-1 text-[12px] sm:text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap text-center ${active
                  ? 'border-[#0F5132] text-[#0F5132] bg-white font-semibold'
                  : 'border-transparent text-[#57534E] hover:text-[#1C1B18]'
                  }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* MAIN SCROLLABLE CONTENT */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4 bg-[#FAF9F6]/50">
          {/* Status / Pending Deposit / Cancelled Alerts */}
          {(booking.status === 'cancelled' || booking.status === 'no_show') && (
            <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[12px] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-[#991B1B]">
                  {booking.status === 'no_show'
                    ? 'Không đến (No-show)'
                    : booking.cancellationType
                      ? getCancellationTypeLabel(booking.cancellationType)
                      : 'Đơn đã hủy'}
                  {booking.cancelledAt ? ` • ${formatDateTimeVN(booking.cancelledAt)}` : ''}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {booking.depositResolutionStatus === 'pending_deposit_resolution' && (
                    <button
                      type="button"
                      onClick={() => setDepositResBooking(booking)}
                      className="h-8 px-3 rounded-lg bg-[#D97706] text-white font-semibold"
                    >
                      Xử lý cọc treo ({formatCurrency(booking.pendingDepositAmount)})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setUndoCancelBooking(booking)}
                    className="h-8 px-3 rounded-lg border border-[#1B5E4B] bg-white text-[#1B5E4B] font-medium"
                  >
                    Khôi phục đơn
                  </button>
                </div>
              </div>
              {booking.cancellationReason && (
                <div className="text-[#7F1D1D]">Lý do: {booking.cancellationReason}</div>
              )}
              {booking.depositResolutionStatus && booking.depositResolutionStatus !== 'none' && (
                <div className="text-[#92400E] font-medium">
                  Tiền cọc: {getDepositResolutionLabel(booking.depositResolutionStatus)}
                  {booking.otaCancelStatus && booking.otaCancelStatus !== 'none'
                    ? ` • OTA: ${getOtaCancelStatusLabel(booking.otaCancelStatus)}`
                    : ''}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 1: CHI TIẾT (HIERARCHICAL ACCORDION) ================= */}
          {tab === 'details' && (
            <>
              {/* KHỐI 1 — THÔNG TIN CHUNG */}
              <section
                data-testid="detail-general-info"
                className="bg-white border border-[#E7E3DA] rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-bold tracking-wider uppercase text-[#8A847C]">
                    Thông tin chung
                  </h3>
                  {!editingGuestBasic && (
                    <button
                      type="button"
                      onClick={() => setEditingGuestBasic(true)}
                      className="text-[12px] text-[#0F5132] font-medium inline-flex items-center gap-1 hover:underline"
                    >
                      <Pencil className="w-3 h-3" /> Sửa
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[#E8F3EC] text-[#0F5132] font-bold text-[14px] flex items-center justify-center shrink-0 uppercase">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editingGuestBasic ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={guestNameDraft}
                          onChange={(e) => setGuestNameDraft(e.target.value)}
                          placeholder="Họ và tên khách"
                          className="w-full h-9 px-2.5 rounded-lg border border-[#0F5132] text-[13px]"
                        />
                        <input
                          type="tel"
                          value={guestPhoneDraft}
                          onChange={(e) => setGuestPhoneDraft(e.target.value)}
                          placeholder="Số điện thoại"
                          className="w-full h-9 px-2.5 rounded-lg border border-[#E7E3DA] text-[13px] font-mono-num"
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleSaveGeneralGuest()}
                            className="h-8 px-3 rounded-lg bg-[#0F5132] text-white text-[12px] font-medium"
                          >
                            Lưu
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingGuestBasic(false)}
                            className="h-8 px-3 rounded-lg border border-[#E7E3DA] text-[#57534E] text-[12px]"
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-[15px] text-[#1C1B18] truncate">
                            {isMultiRoomGroup && groupRecord?.leaderName
                              ? groupRecord.leaderName
                              : rootBooking.primaryGuestName}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const name =
                                (isMultiRoomGroup && groupRecord?.leaderName) ||
                                rootBooking.primaryGuestName;
                              navigator.clipboard?.writeText(name);
                              notify(`Đã sao chép tên "${name}"`, 'info');
                            }}
                            className="p-1 text-[#8A847C] hover:text-[#0F5132]"
                            title="Sao chép tên khách"
                          >
                            <Copy className="w-3.5 h-3.5" strokeWidth={1.6} />
                          </button>
                          {primaryGuestGroup && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                              style={{
                                backgroundColor: `${primaryGuestGroup.color}18`,
                                borderColor: `${primaryGuestGroup.color}40`,
                                color: primaryGuestGroup.color,
                              }}
                            >
                              {primaryGuestGroup.name}
                            </span>
                          )}
                        </div>
                        {groupRecord?.groupName && (
                          <div className="text-[12px] text-[#0F5132] font-medium truncate">
                            Đoàn: {groupRecord.groupName}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Aligned Key-Value Rows */}
                <div className="divide-y divide-[#F3F0E9] border-t border-[#F3F0E9] text-[13px]">
                  <div className="py-2 flex items-center justify-between gap-3">
                    <span className="text-[#8A847C]">Số điện thoại</span>
                    {rootBooking.primaryGuestPhone || groupRecord?.leaderPhone ? (
                      <button
                        type="button"
                        onClick={() => {
                          const ph = rootBooking.primaryGuestPhone || groupRecord?.leaderPhone || '';
                          navigator.clipboard?.writeText(ph);
                          notify(`Đã sao chép SĐT ${ph}`, 'info');
                        }}
                        className="font-mono-num font-medium text-[#1C1B18] hover:text-[#0F5132] inline-flex items-center gap-1"
                      >
                        {rootBooking.primaryGuestPhone || groupRecord?.leaderPhone}
                        <Copy className="w-3 h-3 text-[#8A847C]" />
                      </button>
                    ) : (
                      <span className="text-[#8A847C]">—</span>
                    )}
                  </div>

                  <div className="py-2 flex items-center justify-between gap-3">
                    <span className="text-[#8A847C]">Email</span>
                    {primaryGuestRecord?.email ? (
                      <span className="font-medium text-[#1C1B18] truncate max-w-[60%] text-right">
                        {primaryGuestRecord.email}
                      </span>
                    ) : (
                      <span className="text-[#8A847C]">—</span>
                    )}
                  </div>

                  <div className="py-2 flex items-center justify-between gap-3">
                    <span className="text-[#8A847C]">Nguồn đặt phòng</span>
                    <span className="font-medium text-[#1C1B18] text-right">
                      {getSourceLabel(
                        rootBooking.source,
                        rootBooking.otaChannel,
                        rootBooking.sourceLabel
                      )}
                      {rootBooking.otaBookingRef ? ` (${rootBooking.otaBookingRef})` : ''}
                    </span>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-3">
                    <span className="text-[#8A847C]">Ngày đặt</span>
                    <span className="font-mono-num text-[#1C1B18]">
                      {rootBooking.createdAt ? formatDateTimeVN(rootBooking.createdAt) : '—'}
                    </span>
                  </div>

                  <div className="pt-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#8A847C] inline-flex items-center gap-1">
                        <StickyNote className="w-3.5 h-3.5 text-[#D97706]" />
                        Ghi chú đặt phòng
                      </span>
                      {!editingNote && (
                        <button
                          type="button"
                          onClick={() => setEditingNote(true)}
                          className="text-[12px] text-[#0F5132] font-medium hover:underline"
                        >
                          {rootBooking.note ? 'Sửa' : '+ Thêm'}
                        </button>
                      )}
                    </div>
                    {editingNote ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          autoFocus
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Nhập ghi chú..."
                          className="flex-1 h-9 px-2.5 rounded-lg border border-[#0F5132] text-[12px]"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSaveNote()}
                          className="h-9 px-3 rounded-lg bg-[#0F5132] text-white text-[12px] font-medium"
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNote(false);
                            setNoteDraft(rootBooking.note || '');
                          }}
                          className="h-9 px-2.5 rounded-lg border border-[#E7E3DA] text-[#57534E] text-[12px]"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`text-[12px] ${rootBooking.note ? 'text-[#1C1B18]' : 'text-[#8A847C] italic'
                          }`}
                      >
                        {rootBooking.note || 'Chưa có ghi chú'}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* KHỐI 2 — PHÒNG · {số_phòng} (ACCORDION CARDS) */}
              <section data-testid="detail-rooms-section" className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 px-1">
                  <h3 className="text-[11px] font-bold tracking-wider uppercase text-[#57534E] inline-flex items-center gap-1.5">
                    <BedDouble className="w-3.5 h-3.5 text-[#0F5132]" strokeWidth={1.75} />
                    <span>PHÒNG · {groupSiblings.length}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={toggleAllRooms}
                    data-testid="toggle-all-rooms-btn"
                    className="min-h-[34px] px-2.5 rounded-lg text-[12px] font-semibold text-[#0F5132] hover:bg-[#E8F3EC] transition-colors"
                  >
                    {allRoomsExpanded ? 'Thu gọn tất cả' : 'Mở rộng tất cả'}
                  </button>
                </div>

                {groupSiblings.map((rb) => {
                  const isExp = Boolean(expandedRoomIds[rb.id]);
                  const rbIsHourly = rb.bookingMode === 'hourly';
                  const rbTotal =
                    (rb.grossRoomTotal || 0) + (rb.serviceTotal || 0) + (rb.hourlySurcharge || 0);
                  const rbCiTime = rb.checkInTime || defaultCiTime;
                  const rbCoTime = rb.checkOutTime || defaultCoTime;
                  const rbCanEarlyCo = !rbIsHourly && rb.status === 'in_house' && today < rb.checkOut;
                  const rbSub = activeRoomSubPanel?.bookingId === rb.id ? activeRoomSubPanel.panel : null;
                  const rbRoomType = roomTypes.find((rt) => rt.id === rb.roomTypeId);

                  return (
                    <div
                      key={rb.id}
                      data-testid={`room-accordion-card-${rb.roomNumber}`}
                      className="bg-white border border-[#E7E3DA] rounded-2xl overflow-visible shadow-2xs"
                    >
                      {/* Accordion Summary Header */}
                      <div className="p-3.5 flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => toggleSingleRoom(rb.id)}
                          data-testid={`room-accordion-toggle-${rb.roomNumber}`}
                          className="flex-1 min-w-0 text-left space-y-1"
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <ChevronDown
                              className={`w-4 h-4 text-[#57534E] shrink-0 transition-transform ${isExp ? '' : '-rotate-90'
                                }`}
                              strokeWidth={2}
                            />
                            <span className="font-mono-num text-[15px] font-bold text-[#1C1B18]">
                              {rb.roomNumber}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusBadgeClass(
                                rb.status
                              )}`}
                            >
                              {getStatusLabel(rb.status)}
                            </span>
                            {rbIsHourly && (
                              <span className="px-1.5 py-0.5 rounded bg-[#FFFBEB] text-[#B45309] text-[10px] font-medium">
                                {rb.hourlyHours || 1} giờ
                              </span>
                            )}
                          </div>
                          <div className="pl-5 text-[12px] font-mono-num text-[#57534E] leading-snug">
                            {formatShortDate(rb.checkIn)} · {rbCiTime} →{' '}
                            {formatShortDate(rb.checkOut)} · {rbCoTime} ·{' '}
                            {rbIsHourly ? `${rb.hourlyHours || 1}h` : `${rb.nights} đêm`} ·{' '}
                            {Math.max(1, rb.occupantCount || 1)} NL ·{' '}
                            <strong className="text-[#1C1B18]">{formatCurrency(rbTotal)}</strong>
                          </div>
                        </button>

                        {/* Per-Room "Thao tác" Action Menu */}
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenRoomActionMenuId((cur) => (cur === rb.id ? null : rb.id));
                            }}
                            data-testid={`room-action-btn-${rb.roomNumber}`}
                            className="min-h-[36px] px-2.5 rounded-lg border border-[#E7E3DA] bg-[#FAF9F6] hover:border-[#0F5132] text-[12px] font-semibold text-[#1C1B18] inline-flex items-center gap-1"
                          >
                            <span>Thao tác</span>
                            <ChevronDown className="w-3.5 h-3.5 text-[#8A847C]" />
                          </button>

                          {openRoomActionMenuId === rb.id && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setOpenRoomActionMenuId(null)}
                              />
                              <div className="absolute right-0 top-10 z-50 w-52 bg-white border border-[#E7E3DA] rounded-xl shadow-2xl py-1.5 text-[12px]">
                                {rb.status === 'reserved' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenRoomActionMenuId(null);
                                      void handleCheckInRoom(rb);
                                    }}
                                    className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#E8F3EC] text-[#0F5132] font-semibold flex items-center gap-2"
                                  >
                                    <LogIn className="w-3.5 h-3.5" /> Nhận phòng P.{rb.roomNumber}
                                  </button>
                                )}
                                {rb.status === 'in_house' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenRoomActionMenuId(null);
                                      void handleCheckOutRoom(rb);
                                    }}
                                    className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#E8F3EC] text-[#0F5132] font-semibold flex items-center gap-2"
                                  >
                                    <LogOut className="w-3.5 h-3.5" /> Trả phòng P.{rb.roomNumber}
                                  </button>
                                )}
                                {rbCanEarlyCo && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenRoomActionMenuId(null);
                                      setPostStayTarget({ booking: rb, mode: 'early_checkout' });
                                    }}
                                    className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FFFBEB] text-[#B45309] font-medium"
                                  >
                                    Trả phòng sớm
                                  </button>
                                )}
                                {(rb.status === 'reserved' || rb.status === 'in_house') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenRoomActionMenuId(null);
                                      openRoomSubPanel(rb, 'transfer');
                                    }}
                                    className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#1C1B18] flex items-center gap-2"
                                  >
                                    <ArrowRightLeft className="w-3.5 h-3.5 text-[#57534E]" /> Đổi phòng / Ghép đơn
                                  </button>
                                )}
                                {rb.status === 'in_house' && staffProfile?.permissions.canUndoAction && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenRoomActionMenuId(null);
                                      setPostStayTarget({ booking: rb, mode: 'reverse_checkin' });
                                    }}
                                    className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FAF9F6] text-[#57534E]"
                                  >
                                    Đảo Check-in nhầm
                                  </button>
                                )}
                                {rb.status === 'reserved' && (
                                  <>
                                    <div className="my-1 border-t border-[#F1EFEA]" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenRoomActionMenuId(null);
                                        setCancelScope([rb]);
                                      }}
                                      className="w-full min-h-[38px] px-3.5 text-left hover:bg-[#FEF2F2] text-[#B91C1C] font-medium"
                                    >
                                      Hủy phòng P.{rb.roomNumber}
                                    </button>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Expanded Body */}
                      {isExp && (
                        <div
                          data-testid={`room-accordion-body-${rb.roomNumber}`}
                          className="px-3.5 pb-3.5 pt-2 border-t border-[#F1EFEA] space-y-2.5 text-[13px]"
                        >
                          {/* Visual Check-in ── [Nights] ── Check-out inside room card */}
                          <div className="p-2.5 rounded-xl bg-[#FAF9F6] border border-[#EFECE4] flex items-center justify-between gap-2 text-[12px]">
                            <div>
                              <div className="text-[10px] text-[#8A847C]">Nhận phòng</div>
                              <div className="font-mono-num font-semibold text-[#1C1B18]">
                                {formatShortDate(rb.checkIn)} · {rbCiTime}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="w-3 h-px bg-[#D6D1C7]" />
                              <span className="px-2 py-0.5 rounded-full bg-white border border-[#E7E3DA] font-mono-num text-[11px] font-semibold text-[#0F5132]">
                                {rbIsHourly ? `${rb.hourlyHours || 1} giờ` : `${rb.nights} đêm`}
                              </span>
                              <span className="w-3 h-px bg-[#D6D1C7]" />
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] text-[#8A847C]">Trả phòng</div>
                              <div className="font-mono-num font-semibold text-[#1C1B18]">
                                {formatShortDate(rb.checkOut)} · {rbCoTime}
                              </div>
                            </div>
                          </div>

                          {/* Structured Detail Rows */}
                          <div className="divide-y divide-[#F3F0E9]">
                            <div className="py-2 flex items-center justify-between gap-2">
                              <span className="text-[#8A847C]">Mã đặt phòng</span>
                              <span className="font-mono-num text-[12px] font-medium text-[#1C1B18]">
                                {rb.bookingCode}
                              </span>
                            </div>
                            <div className="py-2 flex items-center justify-between gap-2">
                              <span className="text-[#8A847C]">Loại phòng</span>
                              <span className="font-medium text-[#1C1B18] text-right">
                                {rb.roomTypeName}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRoomId(rb.id);
                                setTab('occupants');
                              }}
                              className="w-full py-2 flex items-center justify-between gap-2 text-left hover:bg-[#FAF9F6] rounded-lg px-1 -mx-1"
                            >
                              <span className="text-[#8A847C]">Khách lưu trú</span>
                              <span className="font-medium text-[#1C1B18] inline-flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-[#0F5132]" />
                                {rb.primaryGuestName} ({Math.max(1, rb.occupantCount || 1)})
                                <ChevronRight className="w-4 h-4 text-[#8A847C]" />
                              </span>
                            </button>

                            {/* Clickable Room Rate Row -> Inline Pricing Editor */}
                            <button
                              type="button"
                              onClick={() => openRoomSubPanel(rb, 'pricing')}
                              data-testid={`room-edit-pricing-btn-${rb.roomNumber}`}
                              className="w-full py-2 flex items-center justify-between gap-2 text-left hover:bg-[#FAF9F6] rounded-lg px-1 -mx-1"
                            >
                              <span className="text-[#8A847C]">Tiền phòng phải thu</span>
                              <span className="font-mono-num font-semibold text-[#0F5132] inline-flex items-center gap-1">
                                {formatCurrency(rb.grossRoomTotal)}
                                <ChevronRight
                                  className={`w-4 h-4 text-[#8A847C] transition-transform ${rbSub === 'pricing' ? 'rotate-90 text-[#0F5132]' : ''
                                    }`}
                                />
                              </span>
                            </button>

                            {rbSub === 'pricing' && (
                              <div
                                data-testid={`room-pricing-editor-${rb.roomNumber}`}
                                className="py-3 px-2.5 my-1 rounded-xl bg-[#FAF9F6] border border-[#E7E3DA] space-y-3"
                              >
                                {rbIsHourly ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[11px] text-[#57534E] mb-1">
                                        Số giờ nghỉ
                                      </label>
                                      <input
                                        type="number"
                                        min={1}
                                        max={12}
                                        value={editHourlyHours}
                                        onChange={(e) => {
                                          const h = Math.max(1, Number(e.target.value) || 1);
                                          setEditHourlyHours(h);
                                          setEditHourlyTotal(
                                            calculateHourlyRoomTotal(h, rbRoomType?.hourlyPricing)
                                          );
                                        }}
                                        className="w-full h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] text-[#57534E] mb-1">
                                        Tổng tiền phòng giờ (VNĐ)
                                      </label>
                                      <input
                                        type="number"
                                        min={0}
                                        step={10000}
                                        value={editHourlyTotal}
                                        onChange={(e) =>
                                          setEditHourlyTotal(Number(e.target.value) || 0)
                                        }
                                        className="w-full h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px]"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <PricingEditor
                                    roomType={rbRoomType}
                                    dailyRates={editRates}
                                    selectedTierId={editTierId}
                                    onChange={(nextRates, nextTierId) => {
                                      setEditRates(nextRates);
                                      if (nextTierId !== undefined) setEditTierId(nextTierId);
                                    }}
                                    compact
                                  />
                                )}
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setActiveRoomSubPanel(null)}
                                    className="h-8 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[12px] text-[#57534E]"
                                  >
                                    Đóng
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleSavePricingForRoom(rb)}
                                    data-testid={`room-save-pricing-btn-${rb.roomNumber}`}
                                    className="h-8 px-3.5 rounded-lg bg-[#0F5132] text-white text-[12px] font-medium"
                                  >
                                    Lưu giá P.{rb.roomNumber}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Clickable Services & Surcharge Row -> Inline Service Picker */}
                            <button
                              type="button"
                              onClick={() => openRoomSubPanel(rb, 'services')}
                              data-testid={`room-edit-services-btn-${rb.roomNumber}`}
                              className="w-full py-2 flex items-center justify-between gap-2 text-left hover:bg-[#FAF9F6] rounded-lg px-1 -mx-1"
                            >
                              <span className="text-[#8A847C]">
                                Tiền dịch vụ ({(rb.services || []).length}) &amp; Phụ thu
                              </span>
                              <span className="font-mono-num font-semibold text-[#1C1B18] inline-flex items-center gap-1">
                                {formatCurrency((rb.serviceTotal || 0) + (rb.hourlySurcharge || 0))}
                                <ChevronRight
                                  className={`w-4 h-4 text-[#8A847C] transition-transform ${rbSub === 'services' ? 'rotate-90 text-[#0F5132]' : ''
                                    }`}
                                />
                              </span>
                            </button>

                            {rbSub === 'services' && (
                              <div
                                data-testid={`room-services-editor-${rb.roomNumber}`}
                                className="py-3 px-2.5 my-1 rounded-xl bg-[#FAF9F6] border border-[#E7E3DA] space-y-3"
                              >
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {(['all', 'drink', 'food', 'service'] as const).map((cat) => (
                                    <button
                                      key={cat}
                                      type="button"
                                      onClick={() => {
                                        setServiceCustomMode(false);
                                        setServiceCatalogFilter(cat);
                                      }}
                                      className={`h-7 px-2.5 rounded-md text-[11px] font-medium border ${!serviceCustomMode && serviceCatalogFilter === cat
                                        ? 'bg-[#0F5132] text-white border-[#0F5132]'
                                        : 'bg-white text-[#57534E] border-[#E5E2DC]'
                                        }`}
                                    >
                                      {cat === 'all' ? 'Tất cả' : getServiceGroupLabel(cat)}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setServiceCustomMode(true);
                                      setSelectedCatalogId('');
                                      setServiceName('');
                                    }}
                                    className={`h-7 px-2.5 rounded-md text-[11px] font-medium border ${serviceCustomMode
                                      ? 'bg-[#D97706] text-white border-[#D97706]'
                                      : 'bg-white text-[#57534E] border-[#E5E2DC]'
                                      }`}
                                  >
                                    + Nhập tự do
                                  </button>
                                </div>

                                {!serviceCustomMode && filteredServiceCatalog.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                                    {filteredServiceCatalog.map((item) => (
                                      <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => handleSelectCatalogItem(item)}
                                        className={`px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${selectedCatalogId === item.id
                                          ? 'border-[#0F5132] bg-[#E8F3EC] text-[#0F5132] font-semibold'
                                          : 'border-[#E5E2DC] bg-white text-[#1C1B18]'
                                          }`}
                                      >
                                        {item.name} ·{' '}
                                        <span className="font-mono-num">
                                          {formatCurrency(item.price)}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}

                                <form
                                  onSubmit={(e) => void handleAddServiceForRoom(e, rb)}
                                  className="grid grid-cols-2 sm:grid-cols-12 gap-2"
                                >
                                  <input
                                    type="text"
                                    value={serviceName}
                                    onChange={(e) => setServiceName(e.target.value)}
                                    placeholder="Tên dịch vụ..."
                                    className="col-span-2 sm:col-span-5 h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                                  />
                                  <input
                                    type="number"
                                    min={1}
                                    value={serviceQty}
                                    onChange={(e) => setServiceQty(Number(e.target.value) || 1)}
                                    className="sm:col-span-2 h-9 px-2 rounded-lg border border-[#E5E2DC] bg-white text-[12px] font-mono-num"
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    step={5000}
                                    value={servicePrice}
                                    onChange={(e) => setServicePrice(Number(e.target.value) || 0)}
                                    className="sm:col-span-3 h-9 px-2 rounded-lg border border-[#E5E2DC] bg-white text-[12px] font-mono-num"
                                  />
                                  <button
                                    type="submit"
                                    disabled={busy}
                                    data-testid={`room-service-submit-btn-${rb.roomNumber}`}
                                    className="col-span-2 sm:col-span-2 h-9 rounded-lg bg-[#0F5132] text-white text-[12px] font-medium inline-flex items-center justify-center gap-1"
                                  >
                                    <Plus className="w-3.5 h-3.5" /> Thêm
                                  </button>
                                </form>

                                {(rb.services || []).length > 0 && (
                                  <div className="divide-y divide-[#E5E2DC] border border-[#E5E2DC] rounded-lg bg-white text-[12px]">
                                    {(rb.services || []).map((sv) => (
                                      <div
                                        key={sv.id}
                                        className="px-2.5 py-2 flex items-center justify-between gap-2"
                                      >
                                        <div className="min-w-0">
                                          <div className="font-medium text-[#1C1B18] truncate">
                                            {sv.name}{' '}
                                            <span className="text-[10px] text-[#8A847C]">
                                              ({getServiceGroupLabel(classifyServiceGroup(sv.category))})
                                            </span>
                                          </div>
                                          <div className="text-[11px] font-mono-num text-[#57534E]">
                                            {sv.quantity} × {formatCurrency(sv.unitPrice)} ={' '}
                                            <strong>{formatCurrency(sv.total)}</strong>
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            await removeBookingService(
                                              rb,
                                              sv.id,
                                              hotelConfig.accountingLockDate
                                            );
                                            notify('Đã xóa dịch vụ');
                                          }}
                                          className="p-1.5 text-[#8A847C] hover:text-[#B91C1C]"
                                          aria-label="Xóa dịch vụ"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Surcharge inline */}
                                <div className="pt-2 border-t border-[#E5E2DC] grid grid-cols-1 sm:grid-cols-12 gap-2">
                                  <input
                                    type="number"
                                    min={0}
                                    step={10000}
                                    value={surchargeAmount}
                                    onChange={(e) => setSurchargeAmount(Number(e.target.value) || 0)}
                                    placeholder="Phụ thu giờ (VNĐ)"
                                    className="sm:col-span-4 h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px] font-mono-num"
                                  />
                                  <input
                                    type="text"
                                    value={surchargeNote}
                                    onChange={(e) => setSurchargeNote(e.target.value)}
                                    placeholder="Lý do phụ thu (nhận sớm / trả trễ)..."
                                    className="sm:col-span-5 h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                                  />
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleSaveSurchargeForRoom(rb)}
                                    className="sm:col-span-3 h-8 rounded-lg border border-[#0F5132] text-[#0F5132] bg-white hover:bg-[#E8F3EC] text-[12px] font-medium"
                                  >
                                    Lưu phụ thu
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Inline Transfer / Merge Panel if triggered */}
                            {rbSub === 'transfer' && (
                              <div className="py-3 px-2.5 my-1 rounded-xl bg-[#FAF9F6] border border-[#E7E3DA] space-y-3 text-[12px]">
                                <div className="font-semibold text-[#1C1B18] flex items-center gap-1.5">
                                  <ArrowRightLeft className="w-3.5 h-3.5 text-[#0F5132]" />
                                  Đổi phòng (Split-Stay) cho P.{rb.roomNumber}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <select
                                    value={transferRoomId}
                                    onChange={(e) => setTransferRoomId(e.target.value)}
                                    className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white"
                                  >
                                    <option value="">-- Chọn phòng trống đích --</option>
                                    {getTransferableRoomsFor(rb).map((r) => (
                                      <option key={r.id} value={r.id}>
                                        P.{r.roomNumber} ({r.roomTypeName})
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={transferPricingMode}
                                    onChange={(e) =>
                                      setTransferPricingMode(
                                        e.target.value as typeof transferPricingMode
                                      )
                                    }
                                    className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white"
                                  >
                                    <option value="new_room_rate">Theo giá phòng mới</option>
                                    <option value="keep_old_rate">Giữ nguyên giá phòng cũ</option>
                                    <option value="custom_rate">Nhập giá tùy chỉnh</option>
                                  </select>
                                </div>
                                {transferPricingMode === 'custom_rate' && (
                                  <input
                                    type="number"
                                    value={transferCustomRate}
                                    onChange={(e) =>
                                      setTransferCustomRate(Number(e.target.value) || 0)
                                    }
                                    className="w-full h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white font-mono-num"
                                  />
                                )}
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setActiveRoomSubPanel(null)}
                                    className="h-8 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[#57534E]"
                                  >
                                    Đóng
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy || !transferRoomId}
                                    onClick={() => void handleTransferRoom(rb)}
                                    className="h-8 px-3.5 rounded-lg bg-[#0F5132] disabled:opacity-50 text-white font-medium"
                                  >
                                    Xác nhận đổi phòng
                                  </button>
                                </div>

                                <div className="pt-2 border-t border-[#E5E2DC] space-y-2">
                                  <div className="font-semibold text-[#1C1B18] flex items-center gap-1.5">
                                    <Merge className="w-3.5 h-3.5 text-[#0F5132]" />
                                    Ghép đơn / Gộp hóa đơn
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <select
                                      value={mergeTargetId}
                                      onChange={(e) => setMergeTargetId(e.target.value)}
                                      className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white"
                                    >
                                      <option value="">-- Chọn phòng/đơn đích --</option>
                                      {mergeCandidatesFor(rb).map((cand) => (
                                        <option key={cand.id} value={cand.id}>
                                          P.{cand.roomNumber} — {cand.primaryGuestName} ({cand.bookingCode})
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      value={mergeMode}
                                      onChange={(e) =>
                                        setMergeMode(e.target.value as 'billing' | 'consolidate')
                                      }
                                      className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white"
                                    >
                                      <option value="billing">Ghép chung hóa đơn đoàn</option>
                                      <option value="consolidate">Gộp khách & trả trống phòng này</option>
                                    </select>
                                  </div>
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      disabled={busy || !mergeTargetId}
                                      onClick={() => void handleMergeRoom(rb)}
                                      className="h-8 px-3.5 rounded-lg border border-[#0F5132] text-[#0F5132] bg-white disabled:opacity-50 font-medium"
                                    >
                                      Thực hiện ghép
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Room Total Line */}
                            <div className="pt-2.5 flex items-center justify-between gap-2 font-semibold">
                              <span className="text-[#1C1B18]">Tổng cộng phòng {rb.roomNumber}</span>
                              <span className="font-mono-num text-[14px] text-[#0F5132]">
                                {formatCurrency(rbTotal)}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            </>
          )}

          {/* ================= TAB 2: KHÁCH & OCR ================= */}
          {tab === 'occupants' && (
            <div className="space-y-3" data-testid="detail-tab-occupants-panel">
              {isMultiRoomGroup && (
                <div className="flex flex-wrap items-center gap-1.5 bg-white border border-[#E7E3DA] rounded-xl p-2">
                  <span className="text-[11px] font-medium text-[#8A847C] px-1">Chọn phòng:</span>
                  {groupSiblings.map((rb) => (
                    <button
                      key={rb.id}
                      type="button"
                      onClick={() => setSelectedRoomId(rb.id)}
                      className={`min-h-[34px] px-2.5 rounded-lg text-[12px] font-mono-num font-semibold transition-colors ${rb.id === booking.id
                        ? 'bg-[#0F5132] text-white'
                        : 'bg-[#FAF9F6] text-[#57534E] border border-[#E7E3DA]'
                        }`}
                    >
                      P.{rb.roomNumber}
                    </button>
                  ))}
                </div>
              )}
              <OccupantOcrPanel booking={booking} />
            </div>
          )}

          {/* ================= TAB 3: THANH TOÁN ================= */}
          {tab === 'payment' && (
            <div className="space-y-4" data-testid="detail-tab-payment-panel">
              {/* 3-Column Financial Summary */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded-xl bg-white border border-[#E7E3DA]">
                  <div className="text-[11px] text-[#8A847C]">
                    {isMultiRoomGroup ? 'Tổng cả đoàn' : 'Tổng hóa đơn'}
                  </div>
                  <div className="font-mono-num text-[14px] font-bold text-[#1C1B18] mt-0.5">
                    {formatCurrency(scopeTotalAmount)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-white border border-[#E7E3DA]">
                  <div className="text-[11px] text-[#8A847C]">Đã thanh toán</div>
                  <div className="font-mono-num text-[14px] font-bold text-[#0F5132] mt-0.5">
                    {formatCurrency(scopeTotalPaid)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E7E3DA]">
                  <div className="text-[11px] text-[#8A847C]">Còn thiếu</div>
                  <div
                    className={`font-mono-num text-[14px] font-bold mt-0.5 ${scopeTotalBalance > 0 ? 'text-[#B45309]' : 'text-[#0F5132]'
                      }`}
                  >
                    {formatCurrency(scopeTotalBalance)}
                  </div>
                </div>
              </div>

              {/* Room selector for recording payment when multi-room group */}
              {isMultiRoomGroup && (
                <div className="flex flex-wrap items-center gap-1.5 bg-white border border-[#E7E3DA] rounded-xl p-2">
                  <span className="text-[11px] font-medium text-[#8A847C] px-1">
                    Ghi thu cho phòng:
                  </span>
                  {groupSiblings.map((rb) => (
                    <button
                      key={rb.id}
                      type="button"
                      onClick={() => setSelectedRoomId(rb.id)}
                      className={`min-h-[34px] px-2.5 rounded-lg text-[12px] font-mono-num font-semibold ${rb.id === booking.id
                        ? 'bg-[#0F5132] text-white'
                        : 'bg-[#FAF9F6] text-[#57534E] border border-[#E7E3DA]'
                        }`}
                    >
                      P.{rb.roomNumber} ({formatCurrency(Math.max(0, getBookingGuestBalance(rb)))})
                    </button>
                  ))}
                </div>
              )}

              {/* Record Payment Form + Quick 50%/100% + VietQR */}
              <form
                onSubmit={(e) => void handleRecordPayment(e)}
                className="rounded-2xl border border-[#E7E3DA] bg-white p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#1C1B18]">
                    <CreditCard className="w-4 h-4 text-[#0F5132]" />
                    Thu tiền / Đặt cọc / Hoàn tiền (P.{booking.roomNumber})
                  </div>
                  {guestBalance > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setPayAmount(Math.round(guestBalance * 0.5))}
                        className="h-7 px-2 rounded-md border border-[#E7E3DA] bg-[#FAF9F6] font-mono-num font-medium"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayAmount(guestBalance)}
                        className="h-7 px-2 rounded-md bg-[#E8F3EC] text-[#0F5132] font-mono-num font-semibold"
                      >
                        100%
                      </button>
                      {vietQrUrl && (
                        <button
                          type="button"
                          onClick={() => setShowInlineQr((v) => !v)}
                          className="h-7 px-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] text-[#B45309] font-medium"
                        >
                          {showInlineQr ? 'Ẩn QR' : 'VietQR'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <select
                    value={payType}
                    onChange={(e) => setPayType(e.target.value as typeof payType)}
                    className="min-h-[40px] sm:h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px]"
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
                    placeholder={`Còn thiếu: ${Math.max(0, guestBalance)}`}
                    className="min-h-[40px] sm:h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px] font-mono-num"
                  />
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="min-h-[40px] sm:h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px]"
                  >
                    <option value="bank_transfer">Chuyển khoản (VietQR)</option>
                    <option value="cash">Tiền mặt</option>
                    <option value="card">Quẹt thẻ</option>
                    <option value="ota_debt">Công nợ OTA</option>
                  </select>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[40px] sm:h-9 px-4 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[13px] font-semibold"
                  >
                    Ghi nhận giao dịch
                  </button>
                </div>

                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Ghi chú phiếu thu (tùy chọn)..."
                  className="w-full h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
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
                    <span className="text-[11px] font-mono-num text-[#57534E]">
                      ND: THANH TOAN {booking.bookingCode} P{booking.roomNumber}
                    </span>
                  </div>
                )}
              </form>

              {/* Quick Print Forms */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(
                  [
                    { type: 'payment_receipt', label: 'Phiếu thanh toán & QR' },
                    { type: 'booking_confirmation', label: 'Phiếu xác nhận ĐP' },
                    { type: 'registration_card', label: 'Phiếu đăng ký lưu trú' },
                  ] as Array<{ type: FormTemplateType; label: string }>
                ).map((f) => (
                  <button
                    key={f.type}
                    type="button"
                    onClick={() => onOpenFormPreview(booking, f.type)}
                    className="min-h-[40px] px-3 rounded-xl border border-[#E7E3DA] bg-white hover:border-[#0F5132] text-[12px] font-medium text-[#1C1B18] inline-flex items-center justify-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#0F5132]" />
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>

              {/* Transactions List */}
              <div className="bg-white border border-[#E7E3DA] rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#F1EFEA] text-[12px] font-semibold text-[#57534E]">
                  Lịch sử thu chi ({scopeTransactions.length})
                </div>
                {scopeTransactions.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-[#8A847C]">
                    Chưa có giao dịch thanh toán nào.
                  </div>
                ) : (
                  <div className="divide-y divide-[#F1EFEA]">
                    {scopeTransactions.map((tx) => (
                      <div
                        key={tx.id}
                        className={`px-4 py-2.5 flex items-center justify-between gap-2 text-[12px] ${tx.status === 'voided_by_undo' ? 'opacity-50 line-through' : ''
                          }`}
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-[#1C1B18] truncate">
                            {tx.category} {tx.roomNumber ? `(P.${tx.roomNumber})` : ''}
                          </div>
                          <div className="text-[11px] text-[#8A847C]">
                            {formatDateVN(tx.date)} • {getPaymentMethodLabel(tx.method)} •{' '}
                            {tx.createdByName}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`font-mono-num font-semibold ${tx.direction === 'in' ? 'text-[#15803D]' : 'text-[#B91C1C]'
                              }`}
                          >
                            {tx.direction === 'in' ? '+' : '-'}
                            {formatCurrency(tx.amount)}
                          </span>
                          {isAdmin &&
                            tx.type !== 'reclassification_in' &&
                            tx.type !== 'reclassification_out' &&
                            tx.type !== 'reversal' && (
                              <button
                                type="button"
                                onClick={() => setReclassifyTx(tx)}
                                className="h-7 px-2 rounded border border-[#E5E2DC] hover:border-[#0F5132] text-[10px] text-[#57534E]"
                              >
                                Đổi PTTT
                              </button>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {scopePostAdjustments.length > 0 && (
                <div className="bg-white border border-[#E7E3DA] rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#F1EFEA] text-[12px] font-semibold text-[#57534E]">
                    Điều chỉnh sau Check-out ({scopePostAdjustments.length})
                  </div>
                  <div className="divide-y divide-[#F1EFEA] text-[12px]">
                    {scopePostAdjustments.map((adj) => (
                      <div key={adj.id} className="px-4 py-2.5 space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[#1C1B18]">{adj.addedItemsSummary}</span>
                          <span
                            className={`font-mono-num font-semibold ${adj.diffAmount >= 0 ? 'text-[#0F5132]' : 'text-[#B91C1C]'
                              }`}
                          >
                            {adj.diffAmount > 0 ? '+' : ''}
                            {formatCurrency(adj.diffAmount)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#8A847C]">
                          {formatDateVN(adj.accountingDate)} • {adj.performedByName} — {adj.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 4: LỊCH SỬ ================= */}
          {tab === 'history' && (
            <div className="space-y-3" data-testid="detail-tab-history-panel">
              {chainBookings.length > 1 && (
                <div className="bg-white border border-[#E7E3DA] rounded-2xl p-3.5 space-y-2">
                  <div className="text-[12px] font-semibold text-[#1C1B18]">
                    Chuỗi chuyển phòng (Split-Stay)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {chainBookings.map((cb) => (
                      <span
                        key={cb.id}
                        className="px-2.5 py-1 rounded-lg bg-[#FAF9F6] border border-[#E7E3DA] text-[11px] font-mono-num"
                      >
                        P.{cb.roomNumber} ({formatShortDate(cb.checkIn)} → {formatShortDate(cb.checkOut)}) ·{' '}
                        {getStatusLabel(cb.status)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white border border-[#E7E3DA] rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#F1EFEA] flex items-center gap-1.5 text-[12px] font-semibold text-[#57534E]">
                  <History className="w-3.5 h-3.5 text-[#0F5132]" />
                  Nhật ký thao tác &amp; Mốc lưu trú
                </div>
                <div className="divide-y divide-[#F1EFEA] text-[12px]">
                  {scopeAuditLogs.map((log) => (
                    <div key={log.id} className="px-4 py-2.5 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[#1C1B18]">{log.targetLabel}</span>
                        <span className="text-[11px] font-mono-num text-[#8A847C] shrink-0">
                          {formatDateTimeVN(log.timestamp)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#57534E]">
                        {log.reason || log.actionType} • <strong>{log.performedByName}</strong>
                      </div>
                    </div>
                  ))}

                  {/* Baseline booking milestones always shown */}
                  {groupSiblings.map((rb) => (
                    <div key={`mile_${rb.id}`} className="px-4 py-2.5 bg-[#FAF9F6]/60 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[#1C1B18]">
                          Tạo đơn P.{rb.roomNumber} ({rb.bookingCode})
                        </span>
                        <span className="text-[11px] font-mono-num text-[#8A847C]">
                          {rb.createdAt ? formatDateTimeVN(rb.createdAt) : formatDateVN(rb.checkIn)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#57534E]">
                        Lưu trú: {formatDateVN(rb.checkIn)} → {formatDateVN(rb.checkOut)}
                        {rb.actualCheckInAt ? ` • Nhận phòng: ${formatDateTimeVN(rb.actualCheckInAt)}` : ''}
                        {rb.actualCheckOutAt ? ` • Trả phòng: ${formatDateTimeVN(rb.actualCheckOutAt)}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FIXED THUMB-ZONE PRIMARY ACTION BAR (Bottom) */}
        <div
          data-testid="booking-detail-bottom-bar"
          className="px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[#E7E3DA] bg-white flex items-center gap-2 shrink-0"
        >
          {reservedSiblings.length > 0 ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleBulkCheckInAll()}
                data-testid="detail-primary-action-btn"
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-50 text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <LogIn className="w-4 h-4" strokeWidth={2} />
                <span>
                  {isMultiRoomGroup && reservedSiblings.length > 1
                    ? `Nhận phòng (${reservedSiblings.length} phòng)`
                    : 'Nhận phòng'}
                </span>
              </button>
              {scopeTotalBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setTab('payment')}
                  className="min-h-[44px] px-3.5 rounded-xl border border-[#0F5132]/30 bg-[#E8F3EC] text-[#0F5132] text-[13px] font-semibold inline-flex items-center gap-1 shrink-0"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Thu tiền</span>
                </button>
              )}
            </>
          ) : inHouseSiblings.length > 0 ? (
            <>
              {scopeTotalBalance > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setTab('payment')}
                    data-testid="detail-primary-action-btn"
                    className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <CreditCard className="w-4 h-4" strokeWidth={2} />
                    <span>Thu tiền ({formatCurrency(scopeTotalBalance)})</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCheckOutRoom(inHouseSiblings[0])}
                    className="min-h-[44px] px-3.5 rounded-xl border border-[#E7E3DA] bg-[#FAF9F6] text-[#1C1B18] text-[13px] font-semibold inline-flex items-center gap-1 shrink-0"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Trả phòng</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleCheckOutRoom(inHouseSiblings[0])}
                  data-testid="detail-primary-action-btn"
                  className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-50 text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-4 h-4" strokeWidth={2} />
                  <span>
                    Trả phòng {isMultiRoomGroup ? `P.${inHouseSiblings[0].roomNumber}` : ''}
                  </span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => onOpenFormPreview(booking, 'payment_receipt')}
              data-testid="detail-primary-action-btn"
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <FileText className="w-4 h-4" strokeWidth={2} />
              <span>Xem &amp; In phiếu thanh toán</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-modals */}
      {cancelScope && (
        <CancelBookingModal
          bookingsScope={cancelScope}
          onClose={() => setCancelScope(null)}
        />
      )}

      {depositResBooking && (
        <DepositResolutionModal
          booking={depositResBooking}
          onClose={() => setDepositResBooking(null)}
        />
      )}

      {undoCancelBooking && (
        <UndoCancelModal
          booking={undoCancelBooking}
          onClose={() => setUndoCancelBooking(null)}
        />
      )}

      {postStayTarget && (
        <PostStayAccountingModal
          booking={postStayTarget.booking}
          mode={postStayTarget.mode}
          onClose={() => setPostStayTarget(null)}
          onProceedToCancelAfterReverse={() => {
            const b = postStayTarget.booking;
            setPostStayTarget(null);
            setCancelScope([b]);
          }}
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
