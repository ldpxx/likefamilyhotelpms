import React, { useMemo, useState } from 'react';
import { Award, Clock, History, UserCheck, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, BookingMode, DailyRate, Guest, PaymentMethod, Room } from '../types/pms';
import {
  addDays,
  buildDailyRates,
  calculateHourlyRoomTotal,
  diffDays,
  formatCurrency,
  formatDateVN,
  isBookingBlockingCalendar,
  isLoyalGuest,
  sumDailyRates,
  todayISO,
} from '../lib/utils';
import { doBookingIntervalsOverlap, isRoomBlockedByMaintenance } from '../lib/revenueMetrics';
import { createBooking, findMatchingGuests } from '../lib/pmsActions';
import { PricingEditor } from './PricingEditor';
import { DateInputVN } from './DateInputVN';

interface BookingCreateModalProps {
  initialRoom?: Room;
  initialCheckIn?: string;
  initialCheckOut?: string;
  onClose: () => void;
  onCreated?: (booking: Booking) => void;
}

function addHoursToTime(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const totalMin = ((h || 0) * 60 + (m || 0) + hours * 60) % (24 * 60);
  const nh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const nm = String(totalMin % 60).padStart(2, '0');
  return `${nh}:${nm}`;
}

export const BookingCreateModal: React.FC<BookingCreateModalProps> = ({
  initialRoom,
  initialCheckIn,
  initialCheckOut,
  onClose,
  onCreated,
}) => {
  const {
    activeRooms,
    roomTypes,
    activeBookingSources,
    bookings,
    maintenances,
    hotelConfig,
    guests,
    actor,
    staffProfile,
    notify,
  } = usePms();

  const [bookingMode, setBookingMode] = useState<BookingMode>('daily');
  const [roomId, setRoomId] = useState(initialRoom?.id || activeRooms[0]?.id || '');
  const [checkIn, setCheckIn] = useState(initialCheckIn || todayISO());
  const [checkOut, setCheckOut] = useState(
    initialCheckOut || addDays(initialCheckIn || todayISO(), 1)
  );

  // Hourly mode states (3-tier progressive formula)
  const [hourlyHours, setHourlyHours] = useState<number>(2);
  const [checkInTime, setCheckInTime] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [hourlyTotalOverride, setHourlyTotalOverride] = useState<number | null>(null);

  const selectedRoom = activeRooms.find((r) => r.id === roomId) || activeRooms[0];
  const selectedRoomType = roomTypes.find((rt) => rt.id === selectedRoom?.roomTypeId);
  const defaultTier =
    selectedRoomType?.priceTiers.find((t) => t.isDefault) || selectedRoomType?.priceTiers[0];

  const [selectedTierId, setSelectedTierId] = useState<string | null>(defaultTier?.id || null);
  const [dailyRates, setDailyRates] = useState<DailyRate[]>(() =>
    buildDailyRates(
      initialCheckIn || todayISO(),
      initialCheckOut || addDays(initialCheckIn || todayISO(), 1),
      defaultTier?.price || 350000
    )
  );

  const [guestCategory, setGuestCategory] = useState<'vietnamese' | 'foreigner'>('vietnamese');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestIdNumber, setGuestIdNumber] = useState('');
  const [guestNationality, setGuestNationality] = useState('Việt Nam');
  const [guestGender, setGuestGender] = useState('');
  const [guestAddress, setGuestAddress] = useState('');
  const [guestDob, setGuestDob] = useState('');
  const [guestIdIssueDate, setGuestIdIssueDate] = useState('');
  const [matchedGuest, setMatchedGuest] = useState<Guest | null>(null);

  // Unified Booking Source (Direct + Active OTA channels)
  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    activeBookingSources[0]?.id || 'src_walk_in'
  );
  const [otaBookingRef, setOtaBookingRef] = useState('');

  const selectedSourceCfg = activeBookingSources.find((s) => s.id === selectedSourceId);
  const isOtaSource = selectedSourceCfg?.kind === 'ota';

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [depositPaid, setDepositPaid] = useState(0);
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>('bank_transfer');
  const [note, setNote] = useState('');
  const [checkInImmediately, setCheckInImmediately] = useState(checkIn === todayISO());
  const [submitting, setSubmitting] = useState(false);

  const stayNights = Math.max(1, diffDays(checkIn, checkOut));

  const autoHourlyTotal = useMemo(
    () => calculateHourlyRoomTotal(hourlyHours, selectedRoomType?.hourlyPricing),
    [hourlyHours, selectedRoomType?.hourlyPricing]
  );
  const effectiveHourlyTotal =
    hourlyTotalOverride !== null ? hourlyTotalOverride : autoHourlyTotal;

  const recomputeDates = (nextIn: string, nextOut: string, nextRoomId = roomId) => {
    const r = activeRooms.find((rm) => rm.id === nextRoomId);
    const rt = roomTypes.find((t) => t.id === r?.roomTypeId);
    const tier = rt?.priceTiers.find((p) => p.isDefault) || rt?.priceTiers[0];
    setDailyRates((prev) => buildDailyRates(nextIn, nextOut, tier?.price || 350000, prev));
  };

  const handleRoomChange = (nextRoomId: string) => {
    setRoomId(nextRoomId);
    const r = activeRooms.find((rm) => rm.id === nextRoomId);
    const rt = roomTypes.find((t) => t.id === r?.roomTypeId);
    const tier = rt?.priceTiers.find((p) => p.isDefault) || rt?.priceTiers[0];
    setSelectedTierId(tier?.id || null);
    setDailyRates(buildDailyRates(checkIn, checkOut, tier?.price || 350000));
    setHourlyTotalOverride(null);
  };

  const handleSourceChange = (nextId: string) => {
    setSelectedSourceId(nextId);
    const cfg = activeBookingSources.find((s) => s.id === nextId);
    if (cfg?.kind === 'ota') {
      setPaymentMethod('ota_debt');
    } else if (paymentMethod === 'ota_debt') {
      setPaymentMethod('cash');
    }
  };

  // Real-time 3-layer repeat guest auto-matching
  const repeatMatches = useMemo(
    () =>
      findMatchingGuests(guests, {
        idNumber: guestIdNumber,
        phone: guestPhone,
        fullName: guestName,
      }),
    [guests, guestIdNumber, guestPhone, guestName]
  );

  const applyRepeatGuest = (g: Guest) => {
    setMatchedGuest(g);
    setGuestName(g.fullName);
    setGuestPhone(g.phone || '');
    setGuestIdNumber(g.idNumber || '');
    setGuestCategory(g.guestCategory || 'vietnamese');
    setGuestNationality(g.nationality || (g.guestCategory === 'vietnamese' ? 'Việt Nam' : ''));
    setGuestGender(g.gender || '');
    setGuestAddress(g.address || '');
    setGuestDob(g.dob || '');
    setGuestIdIssueDate(g.idIssueDate || '');
  };

  // v2.2.1 #7: Hourly bookings use same-day checkIn === checkOut (nights = 0) + 5-min cleaning buffer
  const effectiveCheckOut = bookingMode === 'hourly' ? checkIn : checkOut;
  const computedCheckOutTime =
    bookingMode === 'hourly' ? addHoursToTime(checkInTime, hourlyHours) : undefined;
  const bufferMinutes = hotelConfig.hourlyCleaningBufferMinutes ?? 5;

  const conflictBooking = useMemo(() => {
    if (!selectedRoom) return null;
    if (bookingMode === 'daily' && checkOut <= checkIn) return null;
    const candidate = {
      bookingMode,
      checkIn,
      checkOut: effectiveCheckOut,
      checkInTime: bookingMode === 'hourly' ? checkInTime : undefined,
      checkOutTime: computedCheckOutTime,
      hourlyHours: bookingMode === 'hourly' ? hourlyHours : undefined,
    };
    return bookings.find(
      (b) =>
        b.roomId === selectedRoom.id &&
        isBookingBlockingCalendar(b.status) &&
        doBookingIntervalsOverlap(
          b,
          candidate,
          hotelConfig.checkInTime || '14:00',
          hotelConfig.checkOutTime || '12:00',
          bufferMinutes
        )
    );
  }, [
    bookings,
    selectedRoom,
    bookingMode,
    checkIn,
    checkOut,
    effectiveCheckOut,
    checkInTime,
    computedCheckOutTime,
    hourlyHours,
    hotelConfig.checkInTime,
    hotelConfig.checkOutTime,
    bufferMinutes,
  ]);

  const maintenanceConflict = useMemo(() => {
    if (!selectedRoom) return false;
    const rangeEnd = bookingMode === 'hourly' ? addDays(checkIn, 1) : checkOut;
    if (isRoomBlockedByMaintenance(selectedRoom.id, maintenances, checkIn, rangeEnd)) return true;
    return selectedRoom.hkStatus === 'maintenance' && checkIn <= todayISO();
  }, [selectedRoom, maintenances, bookingMode, checkIn, checkOut]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoom) return;
    if (bookingMode === 'daily' && checkOut <= checkIn) {
      notify('Ngày trả phòng phải sau ngày nhận phòng ít nhất 1 đêm', 'error');
      return;
    }
    if (maintenanceConflict) {
      notify(
        `P.${selectedRoom.roomNumber} đang khóa bảo trì trong khoảng ngày đã chọn`,
        'error'
      );
      return;
    }
    if (conflictBooking) {
      notify(
        `P.${selectedRoom.roomNumber} bị trùng lịch (hoặc chưa đủ ${bufferMinutes} phút dọn phòng) với đơn ${conflictBooking.bookingCode} (${conflictBooking.primaryGuestName})`,
        'error'
      );
      return;
    }

    const mappedSource: Booking['source'] = isOtaSource
      ? 'ota'
      : selectedSourceId === 'src_loyal'
      ? 'loyal_guest'
      : selectedSourceId === 'src_phone'
      ? 'phone'
      : selectedSourceId === 'src_zalo'
      ? 'zalo'
      : selectedSourceId === 'src_facebook'
      ? 'facebook'
      : selectedSourceId === 'src_corporate'
      ? 'corporate'
      : 'walk_in';

    setSubmitting(true);
    try {
      const created = await createBooking(
        {
          room: selectedRoom,
          bookingMode,
          hourlyHours: bookingMode === 'hourly' ? hourlyHours : undefined,
          hourlyRoomTotal: bookingMode === 'hourly' ? effectiveHourlyTotal : undefined,
          checkInTime: bookingMode === 'hourly' ? checkInTime : undefined,
          checkOutTime:
            bookingMode === 'hourly' ? addHoursToTime(checkInTime, hourlyHours) : undefined,
          checkIn,
          checkOut: effectiveCheckOut,
          guestName,
          guestPhone,
          guestCategory,
          guestIdNumber,
          guestNationality,
          guestGender,
          guestAddress,
          guestDob,
          guestIdIssueDate,
          existingGuestId: matchedGuest?.id,
          source: mappedSource,
          sourceLabel: selectedSourceCfg?.name,
          otaChannel: isOtaSource ? selectedSourceCfg?.name || 'OTA' : null,
          otaBookingRef: isOtaSource ? otaBookingRef : null,
          selectedPriceTierId: selectedTierId,
          dailyRates,
          paymentMethod,
          depositPaid,
          depositMethod,
          note,
          checkInImmediately,
          accountingLockDate: hotelConfig.accountingLockDate,
        },
        guests,
        actor
      );
      notify(
        `Đã tạo đơn ${created.bookingCode} — P.${created.roomNumber}${
          bookingMode === 'hourly' ? ` (${hourlyHours} giờ)` : ` (${stayNights} đêm)`
        }${checkInImmediately ? ' — Đã Check-in' : ''}`
      );
      onCreated?.(created);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi tạo đặt phòng', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const hp = selectedRoomType?.hourlyPricing || {
    firstHourPrice: 150000,
    secondHourPrice: 50000,
    additionalHourPrice: 30000,
  };

  return (
    <div
      className="fixed inset-0 left-0 right-0 top-0 bottom-0 w-screen max-w-[100vw] z-50 bg-black/40 flex justify-end overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border-l border-[#E7E3DA] w-full max-w-[100vw] sm:max-w-2xl h-full flex flex-col shadow-2xl overflow-hidden">
        <div className="shrink-0 bg-white border-b border-[#E7E3DA] px-4 sm:px-6 py-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-[#1C1B18]">Đặt phòng mới</h2>
            <p className="text-[12px] text-[#57534E] font-mono-num truncate">
              {selectedRoom ? `P.${selectedRoom.roomNumber}` : 'Chọn phòng'} ·{' '}
              {bookingMode === 'hourly'
                ? `${formatDateVN(checkIn)} (${hourlyHours} giờ)`
                : `${formatDateVN(checkIn)} → ${formatDateVN(checkOut)} (${stayNights} đêm)`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#FAF9F6] flex items-center justify-center text-[#57534E] shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Booking Mode Toggle: Theo ngày/đêm vs Theo giờ */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex flex-wrap p-1 rounded-xl bg-[#F3F0E9] max-w-full">
              <button
                type="button"
                onClick={() => setBookingMode('daily')}
                className={`h-8 px-4 rounded-lg text-[13px] font-medium transition-colors ${
                  bookingMode === 'daily' ? 'bg-[#0F5132] text-white' : 'text-[#57534E]'
                }`}
              >
                Đặt theo ngày / đêm
              </button>
              <button
                type="button"
                onClick={() => {
                  setBookingMode('hourly');
                  setCheckInImmediately(true);
                }}
                className={`h-8 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                  bookingMode === 'hourly' ? 'bg-[#0F5132] text-white' : 'text-[#57534E]'
                }`}
              >
                <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
                Đặt phòng theo giờ
              </button>
            </div>

            {/* Automatic Prominent Stay Duration Badge */}
            <div className="px-3.5 py-1.5 rounded-lg bg-[#E8F3EC] border border-[#0F5132]/25 text-[#0F5132] text-[13px] font-semibold font-mono-num">
              {bookingMode === 'hourly'
                ? `Nghỉ giờ: ${hourlyHours} giờ (${checkInTime} → ${addHoursToTime(
                    checkInTime,
                    hourlyHours
                  )})`
                : `Tổng thời gian ở: ${stayNights} đêm / ${stayNights} ngày`}
            </div>
          </div>

          {/* Room & Dates (dd/mm/YYYY) + Direct Editable Nights Input */}
          <div className="p-4 rounded-xl bg-[#FAF9F6] border border-[#E7E3DA] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-4">
                <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                  Chọn phòng
                </label>
                <select
                  value={roomId}
                  onChange={(e) => handleRoomChange(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px] focus:outline-none focus:border-[#0F5132]"
                >
                  {activeRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      P.{r.roomNumber} — {r.roomTypeName} ({r.floor})
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                  {bookingMode === 'hourly' ? 'Ngày sử dụng' : 'Ngày đến'}
                </label>
                <DateInputVN
                  required
                  value={checkIn}
                  onChange={(v) => {
                    setCheckIn(v);
                    const nextOut = v >= checkOut ? addDays(v, 1) : checkOut;
                    setCheckOut(nextOut);
                    recomputeDates(v, nextOut);
                  }}
                />
              </div>

              {bookingMode === 'daily' ? (
                <>
                  <div className="sm:col-span-3">
                    <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                      Ngày đi
                    </label>
                    <DateInputVN
                      required
                      min={addDays(checkIn, 1)}
                      value={checkOut}
                      onChange={(v) => {
                        setCheckOut(v);
                        recomputeDates(checkIn, v);
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                      Số đêm
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={stayNights}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                        const nextOut = addDays(checkIn, n);
                        setCheckOut(nextOut);
                        recomputeDates(checkIn, nextOut);
                      }}
                      className="w-full h-9 px-2.5 text-center rounded-lg border border-[#E7E3DA] bg-white font-mono-num text-[13px] font-semibold focus:outline-none focus:border-[#0F5132]"
                    />
                  </div>
                </>
              ) : (
                <div className="sm:col-span-5 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                      Giờ vào
                    </label>
                    <input
                      type="time"
                      value={checkInTime}
                      onChange={(e) => setCheckInTime(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-lg border border-[#E7E3DA] bg-white font-mono-num text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                      Số giờ
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={hourlyHours}
                      onChange={(e) => {
                        setHourlyHours(Math.max(1, Math.min(12, Number(e.target.value) || 1)));
                        setHourlyTotalOverride(null);
                      }}
                      className="w-full h-9 px-2.5 text-center rounded-lg border border-[#E7E3DA] bg-white font-mono-num text-[13px]"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {maintenanceConflict && (
            <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[13px] text-[#991B1B]">
              Phòng P.{selectedRoom?.roomNumber} đang trong lịch bảo trì / khóa sửa chữa vào thời điểm đã chọn. Vui lòng chọn phòng khác hoặc hoàn tất bảo trì trước.
            </div>
          )}

          {conflictBooking && (
            <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[13px] text-[#991B1B]">
              Cảnh báo trùng lịch (gồm {bufferMinutes} phút đệm dọn phòng): P.{selectedRoom?.roomNumber} đã có đơn{' '}
              <span className="font-mono-num font-semibold">{conflictBooking.bookingCode}</span> (
              {conflictBooking.primaryGuestName}:{' '}
              {conflictBooking.bookingMode === 'hourly'
                ? `${formatDateVN(conflictBooking.checkIn)} ${conflictBooking.checkInTime || ''} → ${conflictBooking.checkOutTime || ''}`
                : `${formatDateVN(conflictBooking.checkIn)} → ${formatDateVN(conflictBooking.checkOut)}`}
              ).
            </div>
          )}

          {/* Guest info + Real-time Repeat Guest Matching & Loyal Badge */}
          <div className="space-y-3 pt-2 border-t border-[#E5E2DC]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-[#1C1B18]">
                Thông tin khách đại diện
              </span>
              <div className="inline-flex p-0.5 rounded-lg bg-[#F1EFEA] text-[12px]">
                <button
                  type="button"
                  onClick={() => {
                    setGuestCategory('vietnamese');
                    setGuestNationality('Việt Nam');
                  }}
                  className={`px-3 py-1 rounded-md font-medium ${
                    guestCategory === 'vietnamese' ? 'bg-white text-[#1C1B18]' : 'text-[#57534E]'
                  }`}
                >
                  Khách Việt Nam
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGuestCategory('foreigner');
                    if (guestNationality === 'Việt Nam') setGuestNationality('');
                  }}
                  className={`px-3 py-1 rounded-md font-medium ${
                    guestCategory === 'foreigner' ? 'bg-white text-[#1C1B18]' : 'text-[#57534E]'
                  }`}
                >
                  Khách nước ngoài
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Họ và tên khách *</label>
                <input
                  type="text"
                  required
                  value={guestName}
                  onChange={(e) => {
                    setGuestName(e.target.value);
                    setMatchedGuest(null);
                  }}
                  placeholder="Nguyễn Văn An"
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px] focus:outline-none focus:border-[#1B5E4B]"
                />
              </div>
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Số điện thoại</label>
                <input
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => {
                    setGuestPhone(e.target.value);
                    setMatchedGuest(null);
                  }}
                  placeholder="0905 111 222"
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px] font-mono-num focus:outline-none focus:border-[#1B5E4B]"
                />
              </div>
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">
                  {guestCategory === 'vietnamese' ? 'Số CCCD' : 'Số Hộ chiếu / Passport'}
                </label>
                <input
                  type="text"
                  value={guestIdNumber}
                  onChange={(e) => {
                    setGuestIdNumber(e.target.value);
                    setMatchedGuest(null);
                  }}
                  placeholder={guestCategory === 'vietnamese' ? '048090001234' : 'P12345678'}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px] font-mono-num focus:outline-none focus:border-[#1B5E4B]"
                />
              </div>
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Quốc tịch</label>
                <input
                  type="text"
                  value={guestNationality}
                  onChange={(e) => setGuestNationality(e.target.value)}
                  placeholder="Việt Nam / Korea / USA..."
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px] focus:outline-none focus:border-[#1B5E4B]"
                />
              </div>
            </div>

            {/* Real-time Repeat Guest Auto-fill Suggestions */}
            {repeatMatches.length > 0 && !matchedGuest && (
              <div className="p-3 rounded-xl bg-[#E8F2EE]/70 border border-[#1B5E4B]/30 space-y-2">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#1B5E4B]">
                  <History className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Phát hiện khách đã từng lưu trú — bấm để điền tự động toàn bộ hồ sơ:
                </div>
                <div className="flex flex-wrap gap-2">
                  {repeatMatches.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => applyRepeatGuest(g)}
                      className="px-3 py-2 rounded-lg bg-white border border-[#E5E2DC] hover:border-[#1B5E4B] text-left text-[12px] transition-colors"
                    >
                      <div className="font-medium text-[#1C1B18] flex items-center gap-1.5">
                        <span>{g.fullName}</span>
                        {isLoyalGuest((g.totalStays || 0) + 1) && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] text-[10px] font-semibold">
                            <Award className="w-3 h-3" strokeWidth={1.5} />
                            Khách hàng thân quen
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#57534E] font-mono-num">
                        {g.phone || '—'} • Đã ở {g.totalStays || 1} lần
                        {g.idNumber ? ` • ${g.idNumber}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {matchedGuest && (
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="inline-flex items-center gap-1.5 text-[#15803D] bg-[#ECFDF5] px-2.5 py-1 rounded-lg">
                  <UserCheck className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Đã điền tự động hồ sơ khách cũ (Lần thứ {(matchedGuest.totalStays || 0) + 1})
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FEF3C7] text-[#92400E] font-semibold">
                  <Award className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Khách hàng thân quen
                </span>
              </div>
            )}
          </div>

          {/* Simplified Source / OTA & Payment Method (incl. Công nợ OTA) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#E5E2DC]">
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Nguồn đặt phòng / Kênh OTA
              </label>
              <select
                value={selectedSourceId}
                onChange={(e) => handleSourceChange(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <optgroup label="Nguồn trực tiếp">
                  {activeBookingSources
                    .filter((s) => s.kind === 'direct')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Kênh OTA (Nhập trực tiếp tiền thực thu)">
                  {activeBookingSources
                    .filter((s) => s.kind === 'ota')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Phương thức thanh toán chính
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="cash">Tiền mặt</option>
                <option value="bank_transfer">Chuyển khoản (VietQR)</option>
                <option value="card">Quẹt thẻ</option>
                <option value="ota_debt">Công nợ OTA</option>
              </select>
            </div>

            {isOtaSource ? (
              <div>
                <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                  Mã đặt phòng OTA (tùy chọn)
                </label>
                <input
                  type="text"
                  value={otaBookingRef}
                  onChange={(e) => setOtaBookingRef(e.target.value)}
                  placeholder="VD: AGD-992817"
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px] font-mono-num"
                />
              </div>
            ) : (
              <div>
                <label className="block text-[12px] font-medium text-[#57534E] mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Nhận phòng muộn, tầng cao..."
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
              </div>
            )}
          </div>

          {isOtaSource && (
            <div className="p-2.5 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[12px] text-[#9A3412]">
              Đơn kênh <strong>{selectedSourceCfg?.name}</strong>: Nhập trực tiếp số tiền thực tế
              khách sạn thu về vào bảng giá bên dưới (không tính % hoa hồng). Nếu OTA thanh toán sau,
              chọn phương thức <strong>Công nợ OTA</strong>.
            </div>
          )}

          {/* Pricing Section: Daily PricingEditor OR 3-Tier Hourly Calculator */}
          {bookingMode === 'daily' ? (
            <PricingEditor
              roomType={selectedRoomType}
              dailyRates={dailyRates}
              selectedTierId={selectedTierId}
              onChange={(next, tierId) => {
                setDailyRates(next);
                if (tierId !== undefined) setSelectedTierId(tierId);
              }}
              disabled={!staffProfile?.permissions.canEditPrice}
            />
          ) : (
            <div className="rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-semibold text-[#1C1B18]">
                  Tính tiền theo giờ (3 bậc lũy tiến — {selectedRoomType?.name})
                </div>
                <div className="text-[15px] font-semibold font-mono-num text-[#1B5E4B]">
                  Tổng tiền giờ: {formatCurrency(effectiveHourlyTotal)}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[12px] font-mono-num bg-white border border-[#E5E2DC] rounded-lg p-2.5">
                <div>
                  <span className="text-[#57534E]">Giờ 1:</span>{' '}
                  <strong>{formatCurrency(hp.firstHourPrice)}</strong>
                </div>
                <div>
                  <span className="text-[#57534E]">Giờ 2:</span>{' '}
                  <strong>+{formatCurrency(hp.secondHourPrice)}</strong>
                </div>
                <div>
                  <span className="text-[#57534E]">Từ giờ 3 trở đi:</span>{' '}
                  <strong>+{formatCurrency(hp.additionalHourPrice)}/giờ</strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px] text-[#57534E] font-mono-num">
                  Công thức ({hourlyHours}h):{' '}
                  {hourlyHours === 1
                    ? formatCurrency(hp.firstHourPrice)
                    : hourlyHours === 2
                    ? `${formatCurrency(hp.firstHourPrice)} + ${formatCurrency(hp.secondHourPrice)}`
                    : `${formatCurrency(hp.firstHourPrice)} + ${formatCurrency(
                        hp.secondHourPrice
                      )} + ${hourlyHours - 2} × ${formatCurrency(hp.additionalHourPrice)}`}{' '}
                  = <strong>{formatCurrency(autoHourlyTotal)}</strong>
                </div>

                {staffProfile?.permissions.canEditPrice && (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#57534E]">Sửa tổng tiền thỏa thuận:</span>
                    <input
                      type="number"
                      min={0}
                      step={10000}
                      value={effectiveHourlyTotal}
                      onChange={(e) => setHourlyTotalOverride(Math.max(0, Number(e.target.value) || 0))}
                      className="w-32 h-8 px-2.5 text-right rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px] font-semibold"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Deposit */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Tiền đặt cọc tại quầy
              </label>
              <input
                type="number"
                min={0}
                step={50000}
                value={depositPaid}
                onChange={(e) => setDepositPaid(Math.max(0, Number(e.target.value) || 0))}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px] font-mono-num"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Hình thức thu cọc
              </label>
              <select
                value={depositMethod}
                onChange={(e) => setDepositMethod(e.target.value as PaymentMethod)}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="bank_transfer">Chuyển khoản (VietQR)</option>
                <option value="cash">Tiền mặt</option>
                <option value="card">Quẹt thẻ</option>
                <option value="ota_debt">Công nợ OTA</option>
              </select>
            </div>
            {isOtaSource && (
              <div>
                <label className="block text-[12px] font-medium text-[#57534E] mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi chú đơn OTA..."
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#E5E2DC]">
            <label className="inline-flex items-center gap-2 text-[13px] text-[#1C1B18] cursor-pointer">
              <input
                type="checkbox"
                checked={checkInImmediately}
                onChange={(e) => setCheckInImmediately(e.target.checked)}
                className="w-4 h-4 accent-[#1B5E4B]"
              />
              Làm thủ tục Nhận phòng (Check-in) ngay lập tức
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg border border-[#E5E2DC] text-[13px] font-medium text-[#57534E] hover:bg-[#F7F6F3]"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={submitting || Boolean(conflictBooking)}
                className="h-9 px-5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-50 text-white text-[13px] font-medium transition-colors"
              >
                {submitting
                  ? 'Đang lưu...'
                  : checkInImmediately
                  ? 'Tạo đơn & Check-in'
                  : 'Xác nhận đặt phòng'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
