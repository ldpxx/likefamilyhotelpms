import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brush,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  MoveHorizontal,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, Room } from '../types/pms';
import {
  addDays,
  buildDailyRates,
  diffDays,
  formatCurrency,
  formatDateVN,
  formatShortDate,
  getBookingGuestBalance,
  getPaymentMethodLabel,
  getSourceLabel,
  getStatusLabel,
  getWeekdayLabelVN,
  isBookingBlockingCalendar,
  isWeekendISO,
  normalizeVietnamese,
  todayISO,
} from '../lib/utils';
import { doBookingIntervalsOverlap, isRoomBlockedByMaintenance } from '../lib/revenueMetrics';
import { updateBookingPricing } from '../lib/pmsActions';
import { DateInputVN } from './DateInputVN';

interface TimelineCalendarViewProps {
  onSelectBooking: (booking: Booking) => void;
  onCreateFromRange: (params: { room: Room; checkIn: string; checkOut: string }) => void;
  onRequestTransferRoom: (booking: Booking, targetRoom: Room) => void;
}

type ZoomLevel = 'day' | 14 | 30 | 60;
type TimelineGroupBy = 'floor' | 'room_type' | 'none';
type TimelineColorBy = 'status' | 'source';

const DAY_SLOTS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

function parseTimeToHours(hhmm?: string): number {
  if (!hhmm) return 14;
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
}

function getBookingStayPermitExpiry(b: Booking): string | null {
  for (const occ of b.occupants || []) {
    if (occ.stayPermitExpiryDate) return occ.stayPermitExpiryDate;
  }
  return null;
}

export const TimelineCalendarView: React.FC<TimelineCalendarViewProps> = ({
  onSelectBooking,
  onCreateFromRange,
  onRequestTransferRoom,
}) => {
  const { activeRooms: rooms, bookings, maintenances, hotelConfig, roomTypes, actor, notify } = usePms();
  const today = todayISO();
  const bufferMinutes = hotelConfig.hourlyCleaningBufferMinutes ?? 5;

  const [zoomDays, setZoomDays] = useState<ZoomLevel>(30);
  const [windowStart, setWindowStart] = useState(() => addDays(today, -14));
  const [windowLength, setWindowLength] = useState<number>(75);
  const [jumpDate, setJumpDate] = useState(today);
  const [floorFilter, setFloorFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Display Options Popover (GoHost-inspired personalizable view)
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [density, setDensity] = useState<'full' | 'compact'>('full');
  const [groupBy, setGroupBy] = useState<TimelineGroupBy>('floor');
  const [colorBy, setColorBy] = useState<TimelineColorBy>('status');
  const [showSummaryRow, setShowSummaryRow] = useState(true);

  // Rich Hover Tooltip (no click required to inspect booking!)
  const [hoveredInfo, setHoveredInfo] = useState<{
    booking: Booking;
    x: number;
    y: number;
  } | null>(null);

  // Drag-select empty cells to create booking
  const [dragSelect, setDragSelect] = useState<{
    roomId: string;
    startDate: string;
    endDate: string;
  } | null>(null);

  // Drag-and-drop booking onto another room row
  const [draggingBookingId, setDraggingBookingId] = useState<string | null>(null);
  const [dropTargetRoomId, setDropTargetRoomId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const initialScrolledRef = useRef(false);

  const colWidth = zoomDays === 'day' ? 88 : zoomDays === 14 ? 80 : zoomDays === 30 ? 50 : 32;
  const stickyWidth = 180;
  const rowHeightClass = density === 'compact' ? 'h-9' : 'h-11';
  const barHeightClass = density === 'compact' ? 'top-1 h-7' : 'top-1.5 h-8';

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const dates = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < windowLength; i++) {
      arr.push(addDays(windowStart, i));
    }
    return arr;
  }, [windowStart, windowLength]);

  const dateIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    dates.forEach((d, idx) => m.set(d, idx));
    return m;
  }, [dates]);

  const normalizedQuery = normalizeVietnamese(searchQuery.trim());

  const visibleRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (floorFilter !== 'all' && r.floor !== floorFilter) return false;
      if (!normalizedQuery) return true;
      const roomMatch = normalizeVietnamese(`${r.roomNumber} ${r.roomTypeName}`).includes(
        normalizedQuery
      );
      if (roomMatch) return true;
      return bookings.some(
        (b) =>
          b.roomId === r.id &&
          b.status !== 'cancelled' &&
          b.status !== 'no_show' &&
          normalizeVietnamese(
            `${b.bookingCode} ${b.primaryGuestName} ${b.primaryGuestPhone}`
          ).includes(normalizedQuery)
      );
    });
  }, [rooms, floorFilter, normalizedQuery, bookings]);

  const floors = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach((r) => set.add(r.floor));
    return Array.from(set);
  }, [rooms]);

  // Center on Today on initial mount
  useEffect(() => {
    if (zoomDays === 'day' || initialScrolledRef.current || !scrollRef.current) return;
    const todayIdx = dateIndexMap.get(today);
    if (todayIdx !== undefined) {
      scrollRef.current.scrollLeft = Math.max(0, (todayIdx - 2) * colWidth);
      initialScrolledRef.current = true;
    }
  }, [dateIndexMap, today, colWidth, zoomDays]);

  const scrollToDate = (iso: string) => {
    setJumpDate(iso);
    if (zoomDays === 'day') return;
    const idx = dateIndexMap.get(iso);
    if (idx !== undefined && scrollRef.current) {
      scrollRef.current.scrollTo({
        left: Math.max(0, (idx - 2) * colWidth),
        behavior: 'smooth',
      });
    } else {
      setWindowStart(addDays(iso, -14));
      setWindowLength(75);
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = 12 * colWidth;
        }
      }, 40);
    }
  };

  const handleScroll = () => {
    if (zoomDays === 'day') return;
    const el = scrollRef.current;
    if (!el) return;
    const nearRight = el.scrollWidth - el.scrollLeft - el.clientWidth < colWidth * 6;
    const nearLeft = el.scrollLeft < colWidth * 4;

    if (nearRight && windowLength < 365) {
      setWindowLength((prev) => prev + 21);
    } else if (nearLeft && windowLength < 365) {
      const prependDays = 21;
      setWindowStart((prev) => addDays(prev, -prependDays));
      setWindowLength((prev) => prev + prependDays);
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft += prependDays * colWidth;
        }
      });
    }
  };

  const shiftDays = (delta: number) => {
    if (zoomDays === 'day') {
      setJumpDate((d) => addDays(d, delta));
      return;
    }
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: delta * colWidth, behavior: 'smooth' });
  };

  // Daily availability & occupancy summary
  const dailySummary = useMemo(() => {
    const totalRooms = visibleRooms.length;
    const visibleRoomIds = new Set(visibleRooms.map((r) => r.id));
    const activeBookings = bookings.filter(
      (b) => b.status !== 'cancelled' && b.status !== 'no_show' && visibleRoomIds.has(b.roomId)
    );

    return dates.map((d) => {
      const occupiedRoomIds = new Set<string>();
      for (const r of visibleRooms) {
        if (
          isRoomBlockedByMaintenance(r.id, maintenances, d, addDays(d, 1)) ||
          (r.hkStatus === 'maintenance' && d === today)
        ) {
          occupiedRoomIds.add(r.id);
        }
      }
      for (const b of activeBookings) {
        const covers =
          b.bookingMode === 'hourly' ? b.checkIn === d : b.checkIn <= d && b.checkOut > d;
        if (covers) {
          occupiedRoomIds.add(b.roomId);
        }
      }
      const vacant = Math.max(0, totalRooms - occupiedRoomIds.size);
      const occPct = totalRooms > 0 ? Math.round((occupiedRoomIds.size / totalRooms) * 100) : 0;
      return { date: d, vacant, occPct };
    });
  }, [dates, visibleRooms, bookings, maintenances, today]);

  // Bookings indexed by roomId
  const bookingsByRoom = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (b.status === 'cancelled' || b.status === 'no_show') continue;
      const list = map.get(b.roomId) || [];
      list.push(b);
      map.set(b.roomId, list);
    }
    return map;
  }, [bookings]);

  // Finish drag-select range
  useEffect(() => {
    const handleMouseUp = () => {
      if (!dragSelect) return;
      const room = rooms.find((r) => r.id === dragSelect.roomId);
      if (room) {
        const start =
          dragSelect.startDate <= dragSelect.endDate ? dragSelect.startDate : dragSelect.endDate;
        const rawEnd =
          dragSelect.startDate <= dragSelect.endDate ? dragSelect.endDate : dragSelect.startDate;
        const checkOut = addDays(rawEnd, 1);

        const maintBlocked =
          isRoomBlockedByMaintenance(room.id, maintenances, start, checkOut) ||
          (room.hkStatus === 'maintenance' && start <= today);
        const conflict = bookings.some(
          (b) =>
            b.roomId === room.id &&
            isBookingBlockingCalendar(b.status) &&
            doBookingIntervalsOverlap(
              b,
              { bookingMode: 'daily', checkIn: start, checkOut },
              hotelConfig.checkInTime || '14:00',
              hotelConfig.checkOutTime || '12:00',
              bufferMinutes
            )
        );
        if (maintBlocked) {
          notify(`P.${room.roomNumber} đang khóa bảo trì trong khoảng ngày đã chọn`, 'warning');
        } else if (conflict) {
          notify(`P.${room.roomNumber} đã có đơn trùng trong khoảng ngày đã chọn`, 'warning');
        } else {
          onCreateFromRange({ room, checkIn: start, checkOut });
        }
      }
      setDragSelect(null);
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [dragSelect, rooms, bookings, maintenances, today, hotelConfig, bufferMinutes, notify, onCreateFromRange]);

  const handleDropOnRoom = (targetRoom: Room) => {
    setDropTargetRoomId(null);
    if (!draggingBookingId) return;
    const booking = bookings.find((b) => b.id === draggingBookingId);
    setDraggingBookingId(null);
    if (!booking || booking.roomId === targetRoom.id) return;

    const rangeEnd = booking.bookingMode === 'hourly' ? addDays(booking.checkIn, 1) : booking.checkOut;
    if (
      isRoomBlockedByMaintenance(targetRoom.id, maintenances, booking.checkIn, rangeEnd) ||
      (targetRoom.hkStatus === 'maintenance' && booking.checkIn <= today)
    ) {
      notify(`Không thể chuyển sang P.${targetRoom.roomNumber} vì phòng đang bảo trì`, 'error');
      return;
    }

    const conflict = bookings.some(
      (b) =>
        b.id !== booking.id &&
        b.roomId === targetRoom.id &&
        isBookingBlockingCalendar(b.status) &&
        doBookingIntervalsOverlap(
          b,
          booking,
          hotelConfig.checkInTime || '14:00',
          hotelConfig.checkOutTime || '12:00',
          bufferMinutes
        )
    );
    if (conflict) {
      notify(
        `Không thể chuyển sang P.${targetRoom.roomNumber} vì đã có đơn trùng ngày (${formatShortDate(
          booking.checkIn
        )} - ${formatShortDate(booking.checkOut)})`,
        'error'
      );
      return;
    }
    onRequestTransferRoom(booking, targetRoom);
  };

  const handleExtendOneNight = async (e: React.MouseEvent, booking: Booking) => {
    e.stopPropagation();
    const nextCheckOut = addDays(booking.checkOut, 1);
    if (isRoomBlockedByMaintenance(booking.roomId, maintenances, booking.checkOut, nextCheckOut)) {
      notify(`P.${booking.roomNumber} có lịch bảo trì vào ngày ${formatShortDate(booking.checkOut)}`, 'warning');
      return;
    }
    const conflict = bookings.some(
      (b) =>
        b.id !== booking.id &&
        b.roomId === booking.roomId &&
        isBookingBlockingCalendar(b.status) &&
        doBookingIntervalsOverlap(
          b,
          { ...booking, checkOut: nextCheckOut },
          hotelConfig.checkInTime || '14:00',
          hotelConfig.checkOutTime || '12:00',
          bufferMinutes
        )
    );
    if (conflict) {
      notify(
        `P.${booking.roomNumber} đã có khách đặt vào ngày ${formatShortDate(booking.checkOut)}`,
        'warning'
      );
      return;
    }
    const lastRate =
      booking.dailyRates[booking.dailyRates.length - 1]?.rate ||
      roomTypes.find((rt) => rt.id === booking.roomTypeId)?.priceTiers[0]?.price ||
      350000;
    const nextRates = buildDailyRates(booking.checkIn, nextCheckOut, lastRate, booking.dailyRates);
    await updateBookingPricing(
      booking,
      {
        dailyRates: nextRates,
        checkOut: nextCheckOut,
        reason: 'Gia hạn thêm 1 đêm trực tiếp trên lịch',
      },
      actor
    );
    notify(
      `Đã gia hạn ${booking.bookingCode} (P.${booking.roomNumber}) thêm 1 đêm tới ${formatShortDate(
        nextCheckOut
      )}`
    );
  };

  // Like Family Brand Colors: Forest Emerald (#0F5132), Warm Amber (#D97706), Terracotta OTA (#C2410C), Slate Teal Checked-out (#335C67)
  const getBarClasses = (b: Booking) => {
    if (b.status === 'checked_out' || b.status === 'transferred') {
      return 'bg-[#E6EFF1] text-[#335C67] border border-[#BFD5DA]';
    }
    if (colorBy === 'source') {
      if (b.source === 'ota') return 'bg-[#C2410C] text-white border border-[#9A3412]';
      if (b.source === 'zalo' || b.source === 'facebook')
        return 'bg-[#B45309] text-white border border-[#92400E]';
      if (b.source === 'group' || b.groupId) return 'bg-[#335C67] text-white border border-[#24444D]';
      return 'bg-[#0F5132] text-white border border-[#0B3D26]';
    }
    // colorBy === 'status'
    if (b.status === 'in_house') {
      return 'bg-[#0F5132] text-white border border-[#0B3D26]';
    }
    if (b.source === 'ota') {
      return 'bg-[#C2410C] text-white border border-[#9A3412]';
    }
    return 'bg-[#D97706] text-white border border-[#B45309]';
  };

  // Group rooms according to user display preference
  const groupedRooms = useMemo(() => {
    if (groupBy === 'none') {
      return [{ label: '', rooms: visibleRooms }];
    }
    const map = new Map<string, Room[]>();
    for (const r of visibleRooms) {
      const key = groupBy === 'room_type' ? r.roomTypeName : r.floor;
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([label, list]) => ({ label, rooms: list }));
  }, [visibleRooms, groupBy]);

  const windowEnd = dates[dates.length - 1];
  const nowHours = new Date().getHours() + new Date().getMinutes() / 60;
  const nowDayLinePx = (nowHours / 24) * (DAY_SLOTS.length * colWidth);

  const handleBarHover = (e: React.MouseEvent, b: Booking) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(window.innerWidth - 340, Math.max(16, rect.left));
    const y = rect.bottom + 8 + 220 > window.innerHeight ? Math.max(16, rect.top - 220) : rect.bottom + 8;
    setHoveredInfo({ booking: b, x, y });
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="bg-white border border-[#E7E3DA] rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Segmented Zoom: Ngày (Trục giờ) | 14 ngày | 30 ngày | 60 ngày */}
          <div className="flex items-center p-0.5 rounded-lg bg-[#F3F0E9] mr-1">
            {(
              [
                { id: 'day', label: 'Ngày (Giờ)' },
                { id: 14, label: '14 ngày' },
                { id: 30, label: '30 ngày' },
                { id: 60, label: '60 ngày' },
              ] as Array<{ id: ZoomLevel; label: string }>
            ).map((z) => (
              <button
                key={String(z.id)}
                type="button"
                onClick={() => setZoomDays(z.id)}
                className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors ${
                  zoomDays === z.id
                    ? 'bg-[#0F5132] text-white'
                    : 'text-[#57534E] hover:text-[#1C1B18]'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => scrollToDate(today)}
            className="h-8 px-3 rounded-lg border border-[#0F5132]/30 bg-[#E8F3EC] hover:bg-[#0F5132] text-[#0F5132] hover:text-white text-[12px] font-medium transition-colors"
          >
            Hôm nay
          </button>
          <button
            type="button"
            onClick={() => shiftDays(zoomDays === 'day' ? -1 : -7)}
            className="h-8 px-2 rounded-lg border border-[#E7E3DA] hover:bg-[#FAF9F6] text-[12px] text-[#1C1B18] inline-flex items-center"
            title={zoomDays === 'day' ? 'Ngày trước' : 'Lùi 1 tuần'}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => shiftDays(zoomDays === 'day' ? 1 : 7)}
            className="h-8 px-2 rounded-lg border border-[#E7E3DA] hover:bg-[#FAF9F6] text-[12px] text-[#1C1B18] inline-flex items-center"
            title={zoomDays === 'day' ? 'Ngày sau' : 'Tiến 1 tuần'}
          >
            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
          </button>

          <div className="w-36">
            <DateInputVN
              value={jumpDate}
              onChange={(v) => {
                if (v) scrollToDate(v);
              }}
              className="h-8 text-[12px]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search
              className="w-3.5 h-3.5 text-[#8A847C] absolute left-2.5 top-1/2 -translate-y-1/2"
              strokeWidth={1.5}
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm mã ĐP, khách, phòng..."
              className="w-full h-8 pl-8 pr-6 rounded-lg border border-[#E7E3DA] bg-white text-[12px] focus:outline-none focus:border-[#0F5132]"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono-num text-[#8A847C]">
              /
            </span>
          </div>

          <select
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
          >
            <option value="all">Tất cả tầng</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          {/* Display Options Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDisplayMenu((v) => !v)}
              className={`h-8 px-3 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1.5 ${
                showDisplayMenu
                  ? 'border-[#0F5132] bg-[#E8F3EC] text-[#0F5132]'
                  : 'border-[#E7E3DA] bg-white text-[#1C1B18] hover:bg-[#FAF9F6]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={1.5} />
              Hiển thị
            </button>

            {showDisplayMenu && (
              <div className="absolute right-0 mt-1.5 w-64 bg-white border border-[#E7E3DA] rounded-xl shadow-lg p-3.5 z-40 space-y-3 text-[12px]">
                <div className="font-semibold text-[#1C1B18]">Tuỳ chọn hiển thị lịch</div>

                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-[#8A847C] uppercase">Mật độ</div>
                  <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[#F3F0E9]">
                    <button
                      type="button"
                      onClick={() => setDensity('full')}
                      className={`h-7 rounded-md font-medium ${
                        density === 'full' ? 'bg-white text-[#0F5132] shadow-xs' : 'text-[#57534E]'
                      }`}
                    >
                      Đầy đủ
                    </button>
                    <button
                      type="button"
                      onClick={() => setDensity('compact')}
                      className={`h-7 rounded-md font-medium ${
                        density === 'compact' ? 'bg-white text-[#0F5132] shadow-xs' : 'text-[#57534E]'
                      }`}
                    >
                      Thu gọn
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-[#8A847C] uppercase">Nhóm theo</div>
                  {(
                    [
                      { id: 'floor', label: 'Tầng' },
                      { id: 'room_type', label: 'Loại phòng' },
                      { id: 'none', label: 'Chỉ phòng' },
                    ] as Array<{ id: TimelineGroupBy; label: string }>
                  ).map((opt) => (
                    <label key={opt.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                      <input
                        type="radio"
                        checked={groupBy === opt.id}
                        onChange={() => setGroupBy(opt.id)}
                        className="accent-[#0F5132]"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-[#8A847C] uppercase">Màu thanh theo</div>
                  <label className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="radio"
                      checked={colorBy === 'status'}
                      onChange={() => setColorBy('status')}
                      className="accent-[#0F5132]"
                    />
                    <span>Trạng thái nhận phòng</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="radio"
                      checked={colorBy === 'source'}
                      onChange={() => setColorBy('source')}
                      className="accent-[#0F5132]"
                    />
                    <span>Nguồn đặt phòng</span>
                  </label>
                </div>

                <label className="flex items-center justify-between pt-2 border-t border-[#F1EFEA] cursor-pointer">
                  <span>Hiện hàng Trống / Lấp đầy</span>
                  <input
                    type="checkbox"
                    checked={showSummaryRow}
                    onChange={(e) => setShowSummaryRow(e.target.checked)}
                    className="accent-[#0F5132]"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend & Interaction Hint */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[#57534E]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#0F5132]" /> Đang lưu trú
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#D97706]" /> Đặt trước
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#C2410C]" /> Kênh OTA
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#E6EFF1] border border-[#BFD5DA]" /> Đã trả phòng
          </span>
          <span className="inline-flex items-center gap-1 text-[#0F5132]">
            <CheckCheck className="w-3 h-3" strokeWidth={2} /> Đã thanh toán đủ
          </span>
          <span className="inline-flex items-center gap-1 text-[#D97706]">
            <Brush className="w-3 h-3" strokeWidth={1.75} /> Phòng bẩn
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[#8A847C]">
          <MoveHorizontal className="w-3.5 h-3.5" strokeWidth={1.5} />
          Rê chuột xem nhanh • Kéo ô trống để đặt phòng • Kéo thanh đơn đổi phòng • Bấm +1đ để gia hạn
        </div>
      </div>

      {/* HOURLY DAY VIEW (Trục 2 giờ 00:00–22:00 cho Nghỉ giờ & Bàn giao trong ngày) */}
      {zoomDays === 'day' ? (
        <div className="bg-white border border-[#E7E3DA] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-250px)] select-none isolate">
            <div style={{ width: stickyWidth + DAY_SLOTS.length * colWidth }}>
              <div className="sticky top-0 z-30 bg-[#FAF9F6] border-b border-[#E7E3DA]">
                <div className="flex">
                  <div
                    style={{ width: stickyWidth }}
                    className="sticky left-0 z-40 bg-[#FAF9F6] border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-3 py-2 shrink-0"
                  >
                    <div className="text-[12px] font-semibold text-[#1C1B18]">
                      {formatDateVN(jumpDate)}
                    </div>
                    <div className="text-[10px] text-[#8A847C]">
                      {getWeekdayLabelVN(jumpDate)} • Trục 24 giờ
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col">
                    <div className="bg-[#0F5132] text-white text-center py-1 text-[12px] font-semibold font-mono-num">
                      {formatDateVN(jumpDate)} ({getWeekdayLabelVN(jumpDate)})
                    </div>
                    <div className="flex bg-[#FAF9F6] border-t border-[#E7E3DA]">
                      {DAY_SLOTS.map((h) => (
                        <div
                          key={h}
                          style={{ width: colWidth }}
                          className="shrink-0 border-r border-[#E7E3DA] py-1 text-center font-mono-num text-[11px] text-[#57534E]"
                        >
                          {String(h).padStart(2, '0')}:00
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {groupedRooms.map((group) => (
                <React.Fragment key={group.label || 'all'}>
                  {group.label && (
                    <div className="flex bg-[#F3F0E9]/90 border-b border-[#E7E3DA]">
                      <div
                        style={{ width: stickyWidth }}
                        className="sticky left-0 z-20 bg-[#F3F0E9] border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-3 py-1 text-[11px] font-semibold text-[#57534E]"
                      >
                        {group.label} ({group.rooms.length} phòng)
                      </div>
                      <div className="flex-1" />
                    </div>
                  )}

                  {group.rooms.map((room) => {
                    const dayBookings = (bookingsByRoom.get(room.id) || []).filter((b) => {
                      if (b.bookingMode === 'hourly') return b.checkIn === jumpDate;
                      return b.checkIn <= jumpDate && b.checkOut >= jumpDate;
                    });
                    const totalTrackW = DAY_SLOTS.length * colWidth;

                    return (
                      <div
                        key={room.id}
                        className={`flex border-b border-[#E7E3DA] relative ${rowHeightClass} bg-white`}
                      >
                        <div
                          style={{ width: stickyWidth }}
                          className="sticky left-0 z-20 bg-white border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-3 flex items-center justify-between gap-2 shrink-0"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono-num text-[13px] font-semibold text-[#1C1B18]">
                                P.{room.roomNumber}
                              </span>
                              {(room.hkStatus === 'dirty' || room.hkStatus === 'cleaning') && (
                                <Brush className="w-3 h-3 text-[#D97706]" strokeWidth={1.75} />
                              )}
                            </div>
                            <div className="text-[10px] text-[#8A847C] truncate">
                              {room.roomTypeName}
                            </div>
                          </div>
                        </div>

                        <div className="relative flex flex-1 overflow-hidden">
                          {DAY_SLOTS.map((h) => (
                            <div
                              key={h}
                              style={{ width: colWidth }}
                              onClick={() =>
                                onCreateFromRange({
                                  room,
                                  checkIn: jumpDate,
                                  checkOut: addDays(jumpDate, 1),
                                })
                              }
                              className="h-full shrink-0 border-r border-[#F3F0E9] hover:bg-[#FAF9F6] cursor-pointer"
                            />
                          ))}

                          {/* Live Current Time Vertical Line */}
                          {jumpDate === today && (
                            <div
                              style={{ left: nowDayLinePx }}
                              className="absolute top-0 bottom-0 w-0.5 bg-[#0F5132] z-[8] pointer-events-none"
                            />
                          )}

                          {dayBookings.map((b) => {
                            let startH = 0;
                            let endH = 24;
                            if (b.bookingMode === 'hourly') {
                              startH = parseTimeToHours(b.checkInTime || '14:00');
                              endH = Math.min(24, startH + (b.hourlyHours || 2));
                            } else {
                              if (b.checkIn === jumpDate) startH = 14;
                              if (b.checkOut === jumpDate) endH = 12;
                            }
                            if (endH <= startH) return null;
                            const leftPx = (startH / 24) * totalTrackW;
                            const widthPx = Math.max(48, ((endH - startH) / 24) * totalTrackW);
                            const isPaidFull = getBookingGuestBalance(b) <= 0;

                            return (
                              <div
                                key={b.id}
                                onClick={() => onSelectBooking(b)}
                                onMouseEnter={(e) => handleBarHover(e, b)}
                                onMouseLeave={() => setHoveredInfo(null)}
                                style={{ left: leftPx, width: widthPx }}
                                className={`absolute ${barHeightClass} rounded-md px-2 flex items-center justify-between gap-1 text-[11px] font-medium cursor-pointer overflow-hidden shadow-xs z-[5] ${getBarClasses(
                                  b
                                )}`}
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  {b.bookingMode === 'hourly' && (
                                    <Clock className="w-3 h-3 shrink-0" strokeWidth={2} />
                                  )}
                                  <span className="truncate">{b.primaryGuestName}</span>
                                </div>
                                {isPaidFull && (
                                  <CheckCheck className="w-3 h-3 shrink-0 opacity-90" strokeWidth={2} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* MULTI-DAY CONTINUOUS TIMELINE MATRIX */
        <div className="bg-white border border-[#E7E3DA] rounded-2xl overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-250px)] select-none isolate"
          >
            <div style={{ width: stickyWidth + dates.length * colWidth }}>
              {/* Sticky Date Header + Availability Summary Row */}
              <div className="sticky top-0 z-30 bg-[#FAF9F6] border-b border-[#E7E3DA]">
                <div className="flex">
                  <div
                    style={{ width: stickyWidth }}
                    className="sticky left-0 z-40 bg-[#FAF9F6] border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-3 py-2 flex flex-col justify-center shrink-0"
                  >
                    <span className="text-[12px] font-semibold text-[#1C1B18]">
                      Phòng ({visibleRooms.length})
                    </span>
                    <span className="text-[10px] text-[#8A847C]">Cuộn ngang vô tận</span>
                  </div>
                  {dates.map((d) => {
                    const isToday = d === today;
                    const weekend = isWeekendISO(d);
                    const isFirstOfMonth = d.endsWith('-01');
                    return (
                      <div
                        key={d}
                        style={{ width: colWidth }}
                        className={`shrink-0 border-r border-[#E7E3DA] py-1.5 text-center ${
                          isToday
                            ? 'bg-[#0F5132] text-white'
                            : weekend
                            ? 'bg-[#F3EFE6] text-[#1C1B18]'
                            : 'bg-[#FAF9F6] text-[#1C1B18]'
                        } ${isFirstOfMonth ? 'border-l-2 border-l-[#0F5132]/50' : ''}`}
                      >
                        <div
                          className={`text-[10px] ${isToday ? 'text-white/80' : 'text-[#8A847C]'}`}
                        >
                          {getWeekdayLabelVN(d)}
                        </div>
                        <div className="text-[11px] font-mono-num font-semibold">
                          {zoomDays === 60 ? d.slice(8, 10) : formatShortDate(d)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {showSummaryRow && (
                  <div className="flex border-t border-[#E7E3DA] bg-white">
                    <div
                      style={{ width: stickyWidth }}
                      className="sticky left-0 z-40 bg-[#FAF9F6] border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-3 py-1 text-[11px] font-medium text-[#57534E] shrink-0"
                    >
                      Trống / Lấp đầy
                    </div>
                    {dailySummary.map((s) => (
                      <div
                        key={s.date}
                        style={{ width: colWidth }}
                        className={`shrink-0 border-r border-[#E7E3DA] py-1 text-center font-mono-num ${
                          s.date === today ? 'bg-[#E8F3EC]' : ''
                        }`}
                      >
                        <div
                          className={`text-[11px] font-semibold ${
                            s.vacant === 0 ? 'text-[#B91C1C]' : 'text-[#0F5132]'
                          }`}
                        >
                          {s.vacant}
                        </div>
                        {zoomDays !== 60 && (
                          <div className="text-[9px] text-[#8A847C]">{s.occPct}%</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Room Rows */}
              {groupedRooms.map((group) => (
                <React.Fragment key={group.label || 'all'}>
                  {group.label && (
                    <div className="flex bg-[#F3F0E9]/85 border-b border-[#E7E3DA]">
                      <div
                        style={{ width: stickyWidth }}
                        className="sticky left-0 z-20 bg-[#F3F0E9] border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-3 py-1 text-[11px] font-semibold text-[#57534E]"
                      >
                        {group.label} ({group.rooms.length} phòng)
                      </div>
                      <div className="flex-1" />
                    </div>
                  )}

                  {group.rooms.map((room) => {
                    const roomBookings = (bookingsByRoom.get(room.id) || []).filter((b) =>
                      b.bookingMode === 'hourly'
                        ? b.checkIn >= windowStart && b.checkIn <= windowEnd
                        : b.checkOut > windowStart && b.checkIn <= windowEnd
                    );
                    const isDropTarget = dropTargetRoomId === room.id;

                    return (
                      <div
                        key={room.id}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dropTargetRoomId !== room.id) setDropTargetRoomId(room.id);
                        }}
                        onDragLeave={() => {
                          if (dropTargetRoomId === room.id) setDropTargetRoomId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleDropOnRoom(room);
                        }}
                        className={`flex border-b border-[#E7E3DA] relative ${rowHeightClass} ${
                          isDropTarget ? 'bg-[#E8F3EC]/70' : 'bg-white'
                        }`}
                      >
                        {/* Sticky Left Room Cell */}
                        <div
                          style={{ width: stickyWidth }}
                          className="sticky left-0 z-20 bg-white border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-3 flex items-center justify-between gap-2 shrink-0"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  room.hkStatus === 'clean'
                                    ? 'bg-[#0F5132]'
                                    : room.hkStatus === 'dirty'
                                    ? 'bg-[#D97706]'
                                    : room.hkStatus === 'cleaning'
                                    ? 'bg-[#335C67]'
                                    : 'bg-[#B91C1C]'
                                }`}
                              />
                              <span className="font-mono-num text-[13px] font-semibold text-[#1C1B18]">
                                P.{room.roomNumber}
                              </span>
                            </div>
                            {density === 'full' && (
                              <div className="text-[10px] text-[#8A847C] truncate">
                                {room.roomTypeName}
                              </div>
                            )}
                          </div>
                          {(room.hkStatus === 'dirty' || room.hkStatus === 'cleaning') && (
                            <span title="Phòng bẩn — cần dọn" className="text-[#D97706] shrink-0">
                              <Brush className="w-3.5 h-3.5" strokeWidth={1.75} />
                            </span>
                          )}
                        </div>

                        {/* Grid Cells + Overlay Bars */}
                        <div className="relative flex flex-1 overflow-hidden">
                          {dates.map((d) => {
                            const isSelected =
                              dragSelect &&
                              dragSelect.roomId === room.id &&
                              d >=
                                (dragSelect.startDate <= dragSelect.endDate
                                  ? dragSelect.startDate
                                  : dragSelect.endDate) &&
                              d <=
                                (dragSelect.startDate <= dragSelect.endDate
                                  ? dragSelect.endDate
                                  : dragSelect.startDate);

                            const isMaintDay =
                              isRoomBlockedByMaintenance(room.id, maintenances, d, addDays(d, 1)) ||
                              (room.hkStatus === 'maintenance' && d === today);

                            return (
                              <div
                                key={d}
                                style={{ width: colWidth }}
                                title={isMaintDay ? `P.${room.roomNumber} đang bảo trì` : undefined}
                                onMouseDown={() =>
                                  setDragSelect({ roomId: room.id, startDate: d, endDate: d })
                                }
                                onMouseEnter={() => {
                                  if (dragSelect && dragSelect.roomId === room.id) {
                                    setDragSelect({ ...dragSelect, endDate: d });
                                  }
                                }}
                                className={`h-full shrink-0 border-r border-[#F3F0E9] cursor-crosshair transition-colors ${
                                  isMaintDay
                                    ? 'bg-[#FEF2F2] border-r-[#FECACA]'
                                    : isSelected
                                    ? 'bg-[#0F5132]/20'
                                    : d === today
                                    ? 'bg-[#0F5132]/[0.06] border-r-[#0F5132]/40'
                                    : isWeekendISO(d)
                                    ? 'bg-[#FAF8F3]'
                                    : 'hover:bg-[#FAF9F6]'
                                }`}
                              />
                            );
                          })}

                          {/* Booking Bars */}
                          {roomBookings.map((b) => {
                            const startOffset = diffDays(windowStart, b.checkIn);
                            const isBeforeWindow = b.checkIn < windowStart;
                            const effectiveStartDays = isBeforeWindow ? 0 : startOffset;
                            const rawEndDate =
                              b.bookingMode === 'hourly' && b.checkOut <= b.checkIn
                                ? addDays(b.checkIn, 1)
                                : b.checkOut;
                            const endOffset = diffDays(windowStart, rawEndDate);
                            const clampedEnd = Math.min(dates.length, endOffset);

                            const leftPx = isBeforeWindow
                              ? 0
                              : effectiveStartDays * colWidth + colWidth * 0.45;
                            const rightPx =
                              endOffset > dates.length
                                ? dates.length * colWidth
                                : clampedEnd * colWidth + colWidth * 0.45;
                            const widthPx = Math.max(colWidth * 0.6, rightPx - leftPx);

                            const paidTotal = (b.depositPaid || 0) + (b.guestPaid || 0);
                            const balance = getBookingGuestBalance(b);
                            const isPaidFull = balance <= 0;
                            const isPartiallyPaid = !isPaidFull && paidTotal > 0;

                            return (
                              <div
                                key={b.id}
                                draggable={b.status === 'reserved' || b.status === 'in_house'}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setHoveredInfo(null);
                                  setDraggingBookingId(b.id);
                                }}
                                onDragEnd={() => {
                                  setDraggingBookingId(null);
                                  setDropTargetRoomId(null);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onMouseEnter={(e) => handleBarHover(e, b)}
                                onMouseLeave={() => setHoveredInfo(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHoveredInfo(null);
                                  onSelectBooking(b);
                                }}
                                style={{ left: leftPx, width: widthPx }}
                                className={`group absolute ${barHeightClass} rounded-md px-2 flex items-center justify-between gap-1 text-[11px] font-medium cursor-pointer overflow-hidden shadow-xs z-[5] ${getBarClasses(
                                  b
                                )}`}
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  {b.source === 'ota' && (
                                    <span className="text-[9px] px-1 rounded bg-black/20 shrink-0">
                                      {(b.otaChannel || 'OTA').slice(0, 3)}
                                    </span>
                                  )}
                                  {b.bookingMode === 'hourly' && (
                                    <Clock className="w-3 h-3 shrink-0" strokeWidth={2} />
                                  )}
                                  <span className="truncate">{b.primaryGuestName}</span>
                                  {widthPx > 105 && (
                                    <span className="text-[10px] opacity-80 font-mono-num shrink-0">
                                      {b.bookingMode === 'hourly'
                                        ? `(${b.hourlyHours || 1}h)`
                                        : `(${b.nights}đ)`}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {b.groupName && widthPx > 70 && (
                                    <span className="px-1 rounded bg-black/20 text-[9px] font-bold">
                                      G
                                    </span>
                                  )}
                                  {b.hasStayPermitAlert && (
                                    <AlertTriangle
                                      className="w-3 h-3 text-[#FEF08A]"
                                      strokeWidth={2}
                                    />
                                  )}
                                  {b.hasPendingAsm && (
                                    <Globe className="w-3 h-3 text-[#FDE68A]" strokeWidth={2} />
                                  )}
                                  {widthPx > 60 && isPaidFull && (
                                    <CheckCheck className="w-3 h-3 opacity-90" strokeWidth={2.2} />
                                  )}
                                  {widthPx > 60 && isPartiallyPaid && (
                                    <Check className="w-3 h-3 opacity-90" strokeWidth={2.2} />
                                  )}
                                  {(b.status === 'reserved' || b.status === 'in_house') && (
                                    <button
                                      type="button"
                                      onClick={(e) => handleExtendOneNight(e, b)}
                                      title="Gia hạn thêm 1 đêm"
                                      className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded bg-black/25 hover:bg-black/45 text-[9px] font-mono-num transition-opacity"
                                    >
                                      +1đ
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Rich Floating Hover Popover (GoHost-inspired quick peek without opening modal) */}
      {hoveredInfo && (
        <div
          style={{ left: hoveredInfo.x, top: hoveredInfo.y }}
          className="fixed z-50 w-80 bg-white border border-[#E7E3DA] rounded-2xl shadow-xl p-4 pointer-events-none space-y-2.5 text-[12px]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold text-[14px] text-[#1C1B18] truncate">
              {hoveredInfo.booking.primaryGuestName}
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[#E8F3EC] text-[#0F5132] text-[10px] font-semibold shrink-0">
              {getStatusLabel(hoveredInfo.booking.status)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] border-t border-[#F1EFEA] pt-2">
            <div className="text-[#8A847C]">Mã đặt phòng</div>
            <div className="font-mono-num font-semibold text-[#1C1B18] text-right">
              {hoveredInfo.booking.bookingCode}
            </div>
            <div className="text-[#8A847C]">Phòng</div>
            <div className="font-mono-num font-medium text-[#1C1B18] text-right">
              P.{hoveredInfo.booking.roomNumber} ({hoveredInfo.booking.roomTypeName})
            </div>
            <div className="text-[#8A847C]">Lưu trú</div>
            <div className="font-mono-num text-[#1C1B18] text-right">
              {hoveredInfo.booking.bookingMode === 'hourly'
                ? `${formatDateVN(hoveredInfo.booking.checkIn)} (${
                    hoveredInfo.booking.hourlyHours || 1
                  }h)`
                : `${formatShortDate(hoveredInfo.booking.checkIn)} → ${formatShortDate(
                    hoveredInfo.booking.checkOut
                  )} (${hoveredInfo.booking.nights}đ)`}
            </div>
            <div className="text-[#8A847C]">Nguồn / PPTT</div>
            <div className="text-[#1C1B18] text-right truncate">
              {getSourceLabel(
                hoveredInfo.booking.source,
                hoveredInfo.booking.otaChannel,
                hoveredInfo.booking.sourceLabel
              )}{' '}
              · {getPaymentMethodLabel(hoveredInfo.booking.paymentMethod)}
            </div>
            <div className="text-[#8A847C]">Tổng tiền / Còn lại</div>
            <div className="font-mono-num text-right">
              <strong>
                {formatCurrency(
                  (hoveredInfo.booking.grossRoomTotal || 0) +
                    (hoveredInfo.booking.serviceTotal || 0) +
                    (hoveredInfo.booking.hourlySurcharge || 0)
                )}
              </strong>{' '}
              /{' '}
              <span
                className={
                  getBookingGuestBalance(hoveredInfo.booking) > 0
                    ? 'text-[#B45309] font-semibold'
                    : 'text-[#0F5132] font-semibold'
                }
              >
                {getBookingGuestBalance(hoveredInfo.booking) <= 0
                  ? 'Đã TT'
                  : formatCurrency(getBookingGuestBalance(hoveredInfo.booking))}
              </span>
            </div>
          </div>

          {(getBookingStayPermitExpiry(hoveredInfo.booking) || hoveredInfo.booking.note) && (
            <div className="border-t border-[#F1EFEA] pt-2 space-y-1 text-[11px]">
              {getBookingStayPermitExpiry(hoveredInfo.booking) && (
                <div className="font-mono-num text-[#B45309] font-medium">
                  Hạn lưu trú: {formatDateVN(getBookingStayPermitExpiry(hoveredInfo.booking)!)}
                </div>
              )}
              {hoveredInfo.booking.note && (
                <div className="text-[#57534E] line-clamp-2">{hoveredInfo.booking.note}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
