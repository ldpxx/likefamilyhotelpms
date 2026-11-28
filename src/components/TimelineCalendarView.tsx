import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brush,
  Calendar,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Menu,
  MoveHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, Room } from '../types/pms';
import {
  addDays,
  diffDays,
  formatCurrency,
  formatDateVN,
  formatShortDate,
  getBookingGuestBalance,
  getPaymentMethodLabel,
  getSourceLabel,
  getStatusLabel,
  getWeekdayLabelVN,
  isWeekendISO,
  normalizeVietnamese,
  todayISO,
} from '../lib/utils';
import { isRoomBlockedByMaintenance } from '../lib/revenueMetrics';
import { DateInputVN } from './DateInputVN';

interface TimelineCalendarViewProps {
  onSelectBooking: (booking: Booking) => void;
  onOpenMobileMenu?: () => void;
  onOpenNewBooking?: () => void;
  onCreateFromRange?: (params: { room: Room; checkIn: string; checkOut: string }) => void;
  onRequestTransferRoom?: (booking: Booking, targetRoom: Room) => void;
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
  onOpenMobileMenu,
  onOpenNewBooking,
}) => {
  const { activeRooms: rooms, roomTypes, bookings, maintenances } = usePms();
  const today = todayISO();

  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const [zoomDays, setZoomDays] = useState<ZoomLevel>(30);
  const [windowStart, setWindowStart] = useState(() => addDays(today, -14));
  const [windowLength, setWindowLength] = useState<number>(75);
  const [jumpDate, setJumpDate] = useState(today);
  const [showMobileMonthPicker, setShowMobileMonthPicker] = useState(false);
  const [floorFilter, setFloorFilter] = useState('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Display Options Popover / Mobile Bottom Sheet
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [density, setDensity] = useState<'full' | 'compact'>('full');
  const [groupBy, setGroupBy] = useState<TimelineGroupBy>('floor');
  const [colorBy, setColorBy] = useState<TimelineColorBy>('status');
  const [showSummaryRow, setShowSummaryRow] = useState(true);
  const [showMobileRoomType, setShowMobileRoomType] = useState(false);

  // Live minute ticker for real-time Current Time Indicator line
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const displayMenuRef = useRef<HTMLDivElement>(null);

  // Rich Hover Tooltip (desktop hover only — never stuck on mobile touch)
  const [hoveredInfo, setHoveredInfo] = useState<{
    booking: Booking;
    x: number;
    y: number;
  } | null>(null);

  // Guard against accidental booking tap when user is swiping/scrolling on touch screens
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const initialScrolledRef = useRef(false);

  // GoHost-style ultra-dense mobile dimensions (< 768px): 56px room col, 46px day col (6-7 days visible), 34px row height (12-15 rooms visible)
  const colWidth =
    zoomDays === 'day'
      ? isMobile
        ? 56
        : 88
      : isMobile
        ? 46
        : zoomDays === 14
          ? 80
          : zoomDays === 30
            ? 50
            : 32;
  const stickyWidth = isMobile ? 56 : 148;
  const rowHeightClass = isMobile
    ? 'h-[34px]'
    : density === 'compact'
      ? 'h-9'
      : 'h-11';
  const barHeightClass = isMobile
    ? 'top-[4px] h-[26px]'
    : density === 'compact'
      ? 'top-1 h-7'
      : 'top-1.5 h-8';

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartPosRef.current = { x: t.clientX, y: t.clientY };
    touchMovedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const start = touchStartPosRef.current;
    if (!t || !start) return;
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) {
      touchMovedRef.current = true;
    }
  };

  const handleBookingBarClick = (e: React.MouseEvent, b: Booking) => {
    e.stopPropagation();
    if (touchMovedRef.current) {
      touchMovedRef.current = false;
      return;
    }
    setHoveredInfo(null);
    onSelectBooking(b);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showDisplayMenu) {
        setShowDisplayMenu(false);
        return;
      }
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
  }, [showDisplayMenu]);

  useEffect(() => {
    if (!showDisplayMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (displayMenuRef.current && !displayMenuRef.current.contains(e.target as Node)) {
        setShowDisplayMenu(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showDisplayMenu]);

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

  const roomTypeOptions = useMemo(() => {
    if (roomTypes.length > 0) {
      return roomTypes.map((rt) => ({ id: rt.id, name: rt.name }));
    }
    const map = new Map<string, string>();
    rooms.forEach((r) => map.set(r.roomTypeId, r.roomTypeName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [roomTypes, rooms]);

  const visibleRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (floorFilter !== 'all' && r.floor !== floorFilter) return false;
      if (roomTypeFilter !== 'all' && r.roomTypeId !== roomTypeFilter) return false;
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
  }, [rooms, floorFilter, roomTypeFilter, normalizedQuery, bookings]);

  const hasActiveFilters =
    floorFilter !== 'all' || roomTypeFilter !== 'all' || normalizedQuery.length > 0;
  const activeFilterBadgeCount =
    (floorFilter !== 'all' ? 1 : 0) +
    (roomTypeFilter !== 'all' ? 1 : 0) +
    (normalizedQuery.length > 0 ? 1 : 0) +
    (groupBy !== 'floor' ? 1 : 0);

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

  // Per-group daily availability summary (used on room_type group header rows so receptionists can quote room availability by type immediately)
  const groupDailySummaryMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ date: string; vacant: number; occupied: number; total: number }>
    >();
    if (groupBy !== 'room_type') return map;

    const activeBookings = bookings.filter(
      (b) => b.status !== 'cancelled' && b.status !== 'no_show'
    );

    for (const group of groupedRooms) {
      if (!group.label) continue;
      const total = group.rooms.length;
      const groupRoomIds = new Set(group.rooms.map((r) => r.id));
      const groupBookings = activeBookings.filter((b) => groupRoomIds.has(b.roomId));

      const perDay = dates.map((d) => {
        const occupiedIds = new Set<string>();
        for (const r of group.rooms) {
          if (
            isRoomBlockedByMaintenance(r.id, maintenances, d, addDays(d, 1)) ||
            (r.hkStatus === 'maintenance' && d === today)
          ) {
            occupiedIds.add(r.id);
          }
        }
        for (const b of groupBookings) {
          const covers =
            b.bookingMode === 'hourly' ? b.checkIn === d : b.checkIn <= d && b.checkOut > d;
          if (covers) occupiedIds.add(b.roomId);
        }
        const occupied = occupiedIds.size;
        const vacant = Math.max(0, total - occupied);
        return { date: d, vacant, occupied, total };
      });

      map.set(group.label, perDay);
    }
    return map;
  }, [groupBy, groupedRooms, dates, bookings, maintenances, today]);

  // Per-group summary for the selected jumpDate (Hourly Day View)
  const groupJumpDaySummaryMap = useMemo(() => {
    const map = new Map<string, { vacant: number; occupied: number; total: number }>();
    if (groupBy !== 'room_type') return map;

    const activeBookings = bookings.filter(
      (b) => b.status !== 'cancelled' && b.status !== 'no_show'
    );

    for (const group of groupedRooms) {
      if (!group.label) continue;
      const total = group.rooms.length;
      const groupRoomIds = new Set(group.rooms.map((r) => r.id));
      const occupiedIds = new Set<string>();

      for (const r of group.rooms) {
        if (
          isRoomBlockedByMaintenance(r.id, maintenances, jumpDate, addDays(jumpDate, 1)) ||
          (r.hkStatus === 'maintenance' && jumpDate === today)
        ) {
          occupiedIds.add(r.id);
        }
      }
      for (const b of activeBookings) {
        if (!groupRoomIds.has(b.roomId)) continue;
        const covers =
          b.bookingMode === 'hourly'
            ? b.checkIn === jumpDate
            : b.checkIn <= jumpDate && b.checkOut > jumpDate;
        if (covers) occupiedIds.add(b.roomId);
      }

      map.set(group.label, {
        vacant: Math.max(0, total - occupiedIds.size),
        occupied: occupiedIds.size,
        total,
      });
    }
    return map;
  }, [groupBy, groupedRooms, bookings, maintenances, jumpDate, today]);

  const windowEnd = dates[dates.length - 1];
  const nowHours = nowTick.getHours() + nowTick.getMinutes() / 60;
  const nowDayLinePx = (nowHours / 24) * (DAY_SLOTS.length * colWidth);
  const todayColIdx = dateIndexMap.get(today);
  const multiDayNowLineLeftPx =
    todayColIdx !== undefined ? stickyWidth + todayColIdx * colWidth + (nowHours / 24) * colWidth : null;
  const currentMonthLabel = `T${Number(jumpDate.slice(5, 7))}/${jumpDate.slice(0, 4)}`;

  const handleBarHover = (e: React.MouseEvent, b: Booking) => {
    if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(window.innerWidth - 340, Math.max(16, rect.left));
    const y = rect.bottom + 8 + 220 > window.innerHeight ? Math.max(16, rect.top - 220) : rect.bottom + 8;
    setHoveredInfo({ booking: b, x, y });
  };

  return (
    <div
      className={
        isMobile
          ? 'flex flex-col h-[100dvh] w-full max-w-full overflow-x-clip bg-white'
          : 'space-y-3 w-full max-w-full overflow-x-clip'
      }
    >
      {/* MOBILE COMPACT TOP BAR (< 768px, max height 48px) */}
      <div
        data-testid="mobile-calendar-topbar"
        className="md:hidden h-12 shrink-0 bg-white border-b border-[#E7E3DA] px-2 flex items-center justify-between gap-1.5 sticky top-0 z-30"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {onOpenMobileMenu && (
            <button
              type="button"
              onClick={onOpenMobileMenu}
              aria-label="Mở menu điều hướng"
              data-testid="mobile-calendar-menu-btn"
              className="w-9 h-9 rounded-lg border border-[#E7E3DA] flex items-center justify-center text-[#1C1B18] shrink-0"
            >
              <Menu className="w-4 h-4" strokeWidth={1.75} />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMobileMonthPicker((v) => !v)}
              data-testid="mobile-calendar-month-btn"
              className="h-9 px-2 rounded-lg border border-[#E7E3DA] bg-[#FAF9F6] text-[12px] font-semibold font-mono-num text-[#1C1B18] inline-flex items-center gap-1 shrink-0"
            >
              <Calendar className="w-3.5 h-3.5 text-[#0F5132]" strokeWidth={1.75} />
              <span>{currentMonthLabel}</span>
              <ChevronDown className="w-3 h-3 text-[#8A847C]" strokeWidth={1.75} />
            </button>

            {showMobileMonthPicker && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMobileMonthPicker(false)}
                />
                <div className="absolute left-0 top-full mt-1.5 z-50 w-64 bg-white border border-[#E7E3DA] rounded-xl shadow-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        scrollToDate(today);
                        setShowMobileMonthPicker(false);
                      }}
                      className="flex-1 h-9 rounded-lg bg-[#E8F3EC] text-[#0F5132] text-[12px] font-semibold"
                    >
                      Về Hôm nay
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftDays(zoomDays === 'day' ? -1 : -7)}
                      className="w-9 h-9 rounded-lg border border-[#E7E3DA] flex items-center justify-center"
                      aria-label="Lùi"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftDays(zoomDays === 'day' ? 1 : 7)}
                      className="w-9 h-9 rounded-lg border border-[#E7E3DA] flex items-center justify-center"
                      aria-label="Tiến"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#8A847C] mb-1">Nhảy nhanh đến ngày</div>
                    <DateInputVN
                      value={jumpDate}
                      onChange={(v) => {
                        if (v) {
                          scrollToDate(v);
                          setShowMobileMonthPicker(false);
                        }
                      }}
                      className="w-full h-9 text-[12px]"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowDisplayMenu(true)}
            aria-label="Bộ lọc và hiển thị"
            data-testid="mobile-calendar-filter-btn"
            className={`relative w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${
              showDisplayMenu || activeFilterBadgeCount > 0
                ? 'border-[#0F5132] bg-[#E8F3EC] text-[#0F5132]'
                : 'border-[#E7E3DA] bg-white text-[#1C1B18]'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" strokeWidth={1.75} />
            {activeFilterBadgeCount > 0 && (
              <span
                data-testid="mobile-calendar-filter-badge"
                className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#0F5132] text-white text-[10px] font-mono-num font-bold flex items-center justify-center"
              >
                {activeFilterBadgeCount}
              </span>
            )}
          </button>

          {onOpenNewBooking && (
            <button
              type="button"
              onClick={onOpenNewBooking}
              data-testid="mobile-calendar-new-booking-btn"
              className="h-9 px-2.5 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[12px] font-semibold inline-flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
              <span>Đặt phòng</span>
            </button>
          )}
        </div>
      </div>

      {/* DESKTOP / TABLET TOOLBAR (>= 768px) */}
      <div className="hidden md:flex bg-white border border-[#E7E3DA] rounded-xl p-3 flex-wrap items-center justify-between gap-2.5 max-w-full">
        <div className="flex flex-wrap items-center gap-2 max-w-full">
          {/* Segmented Zoom: Ngày (Trục giờ) | 14 ngày | 30 ngày | 60 ngày */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#F3F0E9] max-w-full">
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
                className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors ${zoomDays === z.id
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
          <div className="relative w-52 min-w-0">
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
            aria-label="Lọc theo loại phòng"
            value={roomTypeFilter}
            onChange={(e) => setRoomTypeFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px] text-[#1C1B18] focus:outline-none focus:border-[#0F5132]"
          >
            <option value="all">Tất cả loại phòng</option>
            {roomTypeOptions.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo tầng"
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px] text-[#1C1B18] focus:outline-none focus:border-[#0F5132]"
          >
            <option value="all">Tất cả tầng</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <select
            aria-label="Chế độ gom nhóm lịch"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as TimelineGroupBy)}
            className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px] text-[#1C1B18] focus:outline-none focus:border-[#0F5132]"
          >
            <option value="floor">Nhóm: Theo Tầng</option>
            <option value="room_type">Nhóm: Loại phòng</option>
            <option value="none">Xem tất cả ({rooms.length} phòng)</option>
          </select>

          {/* Desktop Display Popover Trigger */}
          <div ref={displayMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowDisplayMenu((v) => !v)}
              aria-expanded={showDisplayMenu}
              aria-haspopup="dialog"
              className={`h-8 px-3 rounded-lg border text-[12px] font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${
                showDisplayMenu
                  ? 'border-[#0F5132] bg-[#E8F3EC] text-[#0F5132]'
                  : 'border-[#E7E3DA] bg-white text-[#1C1B18] hover:bg-[#FAF9F6]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
              <span>Hiển thị</span>
            </button>

            {showDisplayMenu && !isMobile && (
              <div
                role="dialog"
                aria-label="Tuỳ chọn hiển thị lịch"
                data-testid="calendar-display-popover"
                className="absolute right-0 top-full mt-1.5 z-50 w-72 bg-white border border-[#E7E3DA] rounded-xl shadow-lg p-3.5 space-y-3 text-[12px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-[#1C1B18]">Tuỳ chọn hiển thị lịch</div>
                  <button
                    type="button"
                    onClick={() => setShowDisplayMenu(false)}
                    aria-label="Đóng tuỳ chọn hiển thị"
                    className="w-6 h-6 rounded-lg hover:bg-[#F3F0E9] inline-flex items-center justify-center text-[#57534E]"
                  >
                    <X className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-[#8A847C] uppercase">Mật độ</div>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#F3F0E9]">
                    <button
                      type="button"
                      onClick={() => setDensity('full')}
                      className={`h-7 rounded-md font-medium transition-colors ${
                        density === 'full' ? 'bg-white text-[#0F5132] shadow-xs' : 'text-[#57534E]'
                      }`}
                    >
                      Đầy đủ
                    </button>
                    <button
                      type="button"
                      onClick={() => setDensity('compact')}
                      className={`h-7 rounded-md font-medium transition-colors ${
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
                      { id: 'floor', label: 'Theo Tầng' },
                      { id: 'room_type', label: 'Theo Loại phòng' },
                      { id: 'none', label: 'Xem tất cả (Không gom nhóm)' },
                    ] as Array<{ id: TimelineGroupBy; label: string }>
                  ).map((opt) => (
                    <label
                      key={opt.id}
                      className="flex items-center gap-2.5 cursor-pointer py-0.5 text-[#1C1B18]"
                    >
                      <input
                        type="radio"
                        name="timeline-group-by-desktop"
                        checked={groupBy === opt.id}
                        onChange={() => setGroupBy(opt.id)}
                        className="accent-[#0F5132] w-3.5 h-3.5 shrink-0"
                      />
                      <span className="leading-snug">{opt.label}</span>
                    </label>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-[#8A847C] uppercase">Màu thanh theo</div>
                  <label className="flex items-center gap-2.5 cursor-pointer py-0.5 text-[#1C1B18]">
                    <input
                      type="radio"
                      name="timeline-color-by-desktop"
                      checked={colorBy === 'status'}
                      onChange={() => setColorBy('status')}
                      className="accent-[#0F5132] w-3.5 h-3.5 shrink-0"
                    />
                    <span className="leading-snug">Trạng thái nhận phòng</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer py-0.5 text-[#1C1B18]">
                    <input
                      type="radio"
                      name="timeline-color-by-desktop"
                      checked={colorBy === 'source'}
                      onChange={() => setColorBy('source')}
                      className="accent-[#0F5132] w-3.5 h-3.5 shrink-0"
                    />
                    <span className="leading-snug">Nguồn đặt phòng</span>
                  </label>
                </div>

                <label className="flex items-center justify-between gap-3 pt-2.5 border-t border-[#F1EFEA] cursor-pointer text-[#1C1B18]">
                  <span className="leading-snug">Hiện hàng Trống / Lấp đầy</span>
                  <input
                    type="checkbox"
                    checked={showSummaryRow}
                    onChange={(e) => setShowSummaryRow(e.target.checked)}
                    className="accent-[#0F5132] w-4 h-4 shrink-0"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MOBILE BOTTOM SHEET: ALL 4 FILTERS + DISPLAY OPTIONS + COLOR LEGEND */}
      {showDisplayMenu && isMobile && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-end justify-center p-2"
          onClick={() => setShowDisplayMenu(false)}
        >
          <div
            role="dialog"
            aria-label="Bộ lọc & Hiển thị lịch"
            data-testid="calendar-display-popover"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[85dvh] overflow-y-auto bg-white border border-[#E7E3DA] rounded-2xl shadow-2xl p-4 space-y-3.5 text-[13px]"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1EFEA]">
              <div className="font-semibold text-[#1C1B18] text-[14px]">
                Bộ lọc & Tuỳ chọn hiển thị
              </div>
              <button
                type="button"
                onClick={() => setShowDisplayMenu(false)}
                aria-label="Đóng bộ lọc"
                className="w-9 h-9 rounded-lg hover:bg-[#F3F0E9] inline-flex items-center justify-center text-[#57534E]"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search
                className="w-4 h-4 text-[#8A847C] absolute left-3 top-1/2 -translate-y-1/2"
                strokeWidth={1.5}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm mã ĐP, tên khách, số phòng..."
                className="w-full min-h-[40px] pl-9 pr-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px] focus:outline-none focus:border-[#0F5132]"
              />
            </div>

            {/* Zoom mode */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">Chế độ xem</div>
              <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#F3F0E9]">
                {(
                  [
                    { id: 'day', label: 'Giờ' },
                    { id: 14, label: '14 ngày' },
                    { id: 30, label: '30 ngày' },
                    { id: 60, label: '60 ngày' },
                  ] as Array<{ id: ZoomLevel; label: string }>
                ).map((z) => (
                  <button
                    key={String(z.id)}
                    type="button"
                    onClick={() => setZoomDays(z.id)}
                    className={`min-h-[36px] rounded-md text-[12px] font-medium ${
                      zoomDays === z.id ? 'bg-[#0F5132] text-white' : 'text-[#57534E]'
                    }`}
                  >
                    {z.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter 1 & 2: Room Type + Floor */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[#8A847C] mb-1">Loại phòng</label>
                <select
                  aria-label="Lọc theo loại phòng"
                  value={roomTypeFilter}
                  onChange={(e) => setRoomTypeFilter(e.target.value)}
                  className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
                >
                  <option value="all">Tất cả loại phòng</option>
                  {roomTypeOptions.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#8A847C] mb-1">Tầng</label>
                <select
                  aria-label="Lọc theo tầng"
                  value={floorFilter}
                  onChange={(e) => setFloorFilter(e.target.value)}
                  className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
                >
                  <option value="all">Tất cả tầng</option>
                  {floors.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Filter 3: Group By */}
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">Nhóm danh sách phòng</div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#F3F0E9]">
                {(
                  [
                    { id: 'floor', label: 'Theo Tầng' },
                    { id: 'room_type', label: 'Loại phòng' },
                    { id: 'none', label: 'Tất cả' },
                  ] as Array<{ id: TimelineGroupBy; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setGroupBy(opt.id)}
                    className={`min-h-[36px] rounded-md text-[12px] font-medium ${
                      groupBy === opt.id ? 'bg-white text-[#0F5132] shadow-xs' : 'text-[#57534E]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter 4: Display Options */}
            <div className="space-y-2 pt-1 border-t border-[#F1EFEA]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[#1C1B18]">Màu thanh đơn</span>
                <div className="inline-flex p-0.5 rounded-lg bg-[#F3F0E9] text-[12px]">
                  <button
                    type="button"
                    onClick={() => setColorBy('status')}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      colorBy === 'status' ? 'bg-white text-[#0F5132]' : 'text-[#57534E]'
                    }`}
                  >
                    Trạng thái
                  </button>
                  <button
                    type="button"
                    onClick={() => setColorBy('source')}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      colorBy === 'source' ? 'bg-white text-[#0F5132]' : 'text-[#57534E]'
                    }`}
                  >
                    Nguồn đặt
                  </button>
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 cursor-pointer text-[12px] text-[#1C1B18]">
                <span>Hiện tên loại phòng dưới số phòng</span>
                <input
                  type="checkbox"
                  checked={showMobileRoomType}
                  onChange={(e) => setShowMobileRoomType(e.target.checked)}
                  className="accent-[#0F5132] w-4 h-4 shrink-0"
                />
              </label>
            </div>

            {/* Color Legend inside Bottom Sheet */}
            <div className="p-2.5 rounded-xl bg-[#FAF9F6] border border-[#E7E3DA] space-y-1.5">
              <div className="text-[11px] font-semibold text-[#57534E]">Chú thích màu & ký hiệu</div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] text-[#3F3D37]">
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
                  <Check className="w-3 h-3" strokeWidth={2.2} /> Đã thanh toán đủ
                </span>
                <span className="inline-flex items-center gap-1 text-[#D97706]">
                  <Brush className="w-3 h-3" strokeWidth={1.75} /> Phòng bẩn cần dọn
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setFloorFilter('all');
                    setRoomTypeFilter('all');
                    setSearchQuery('');
                    setGroupBy('floor');
                  }}
                  className="min-h-[42px] px-3.5 rounded-xl border border-[#E7E3DA] bg-white text-[#57534E] font-medium text-[13px]"
                >
                  Xóa lọc
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowDisplayMenu(false)}
                className="flex-1 min-h-[42px] rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] text-white font-semibold text-[13px]"
              >
                Áp dụng & Xem lịch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DESKTOP Legend & Interaction Hint (Completely hidden on Mobile < 768px) */}
      <div className="hidden md:flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[#57534E]">
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
          <MoveHorizontal className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
          Vuốt/cuộn để xem lịch • Chạm vào thanh đơn để xem chi tiết • Tạo đơn mới qua nút + Đặt phòng mới
        </div>
      </div>

      {/* HOURLY DAY VIEW (Trục 2 giờ 00:00–22:00 cho Nghỉ giờ & Bàn giao trong ngày) */}
      {zoomDays === 'day' ? (
        <div className="bg-white border border-[#E7E3DA] rounded-2xl overflow-hidden max-w-full">
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-250px)] select-none isolate"
          >
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

              {groupedRooms.map((group) => {
                const dayGroupSummary = groupJumpDaySummaryMap.get(group.label);
                return (
                  <React.Fragment key={group.label || 'all'}>
                    {group.label && (
                      <div className="flex bg-[#F3F0E9]/90 border-b border-[#E7E3DA]">
                        <div
                          style={{ width: stickyWidth }}
                          className="sticky left-0 z-20 bg-[#F3F0E9] border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-3 py-1.5 text-[11px] font-semibold text-[#57534E] shrink-0"
                        >
                          <div className="truncate">{group.label}</div>
                          <div className="text-[10px] font-normal text-[#8A847C]">
                            {group.rooms.length} phòng
                          </div>
                        </div>
                        <div className="flex-1 flex items-center px-3">
                          {dayGroupSummary && (
                            <span
                              data-testid="room-type-hourly-summary"
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono-num font-medium ${dayGroupSummary.vacant === 0
                                ? 'bg-[#FEF2F2] text-[#B91C1C]'
                                : 'bg-[#E8F3EC] text-[#0F5132]'
                                }`}
                            >
                              {dayGroupSummary.vacant} trống · {dayGroupSummary.occupied} đang dùng
                            </span>
                          )}
                        </div>
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
                                className="h-full shrink-0 border-r border-[#F3F0E9]"
                              />
                            ))}

                          {/* Live Current Time Vertical Line (Blue 1.5px) */}
                          {jumpDate === today && (
                            <div
                              style={{ left: nowDayLinePx }}
                              className="absolute top-0 bottom-0 w-[1.5px] bg-[#2563EB] z-[8] pointer-events-none"
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
                                  onClick={(e) => handleBookingBarClick(e, b)}
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
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* MULTI-DAY CONTINUOUS TIMELINE MATRIX */
        <div
          className={
            isMobile
              ? 'flex-1 min-h-0 bg-white overflow-hidden max-w-full flex flex-col'
              : 'bg-white border border-[#E7E3DA] rounded-2xl overflow-hidden max-w-full'
          }
        >
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            className={`overflow-x-auto overflow-y-auto select-none isolate ${
              isMobile ? 'flex-1 min-h-0' : 'max-h-[calc(100vh-250px)]'
            }`}
          >
            <div
              className="relative"
              style={{ width: stickyWidth + dates.length * colWidth }}
            >
              {/* Sticky Date Header + Availability Summary Row */}
              <div className="sticky top-0 z-30 bg-[#FAF9F6] border-b border-[#E7E3DA]">
                {isMobile ? (
                  /* MOBILE DUAL-LINE COMBINED HEADER (height: 44px — Date on top, Weekday · Vacant on bottom) */
                  <div className="flex h-[44px]" data-testid="mobile-calendar-dual-header">
                    <div
                      style={{ width: stickyWidth }}
                      data-testid="calendar-sticky-corner"
                      className="sticky left-0 z-40 bg-[#FAF9F6] border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] px-1 flex flex-col items-center justify-center shrink-0"
                    >
                      <span className="text-[10px] font-semibold text-[#1C1B18] leading-tight">
                        Phòng
                      </span>
                      <span className="text-[10px] font-mono-num text-[#8A847C] leading-tight">
                        ({visibleRooms.length})
                      </span>
                    </div>
                    {dates.map((d, idx) => {
                      const isToday = d === today;
                      const weekend = isWeekendISO(d);
                      const isFirstOfMonth = d.endsWith('-01');
                      const summary = dailySummary[idx];
                      return (
                        <div
                          key={d}
                          data-testid={`calendar-day-col-${d}`}
                          style={{ width: colWidth }}
                          className={`shrink-0 border-r border-[#E7E3DA] flex flex-col items-center justify-center leading-tight ${
                            isToday
                              ? 'bg-[#0F5132] text-white'
                              : weekend
                                ? 'bg-[#F3EFE6] text-[#1C1B18]'
                                : 'bg-[#FAF9F6] text-[#1C1B18]'
                          } ${isFirstOfMonth ? 'border-l-2 border-l-[#0F5132]/50' : ''}`}
                        >
                          <div className="text-[11px] font-mono-num font-bold leading-tight">
                            {formatShortDate(d)}
                          </div>
                          <div
                            className={`text-[9px] font-mono-num leading-tight whitespace-nowrap mt-0.5 ${
                              isToday
                                ? 'text-white/90'
                                : summary?.vacant === 0
                                  ? 'text-[#B91C1C] font-semibold'
                                  : 'text-[#57534E]'
                            }`}
                          >
                            {getWeekdayLabelVN(d)}·{summary?.vacant ?? 0}tr
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <div className="flex">
                      <div
                        style={{ width: stickyWidth }}
                        data-testid="calendar-sticky-corner"
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
                            data-testid={`calendar-day-col-${d}`}
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
                  </>
                )}
              </div>

              {/* Continuous Real-Time Current Time Indicator (Blue 1.5px line + top dot across all rooms) */}
              {multiDayNowLineLeftPx !== null && (
                <div
                  data-testid="calendar-current-time-line"
                  style={{ left: multiDayNowLineLeftPx, top: isMobile ? 44 : showSummaryRow ? 74 : 44 }}
                  className="absolute bottom-0 w-[1.5px] bg-[#2563EB] z-[15] pointer-events-none"
                >
                  <span className="absolute -top-[3.5px] -left-[2.75px] w-[7px] h-[7px] rounded-full bg-[#2563EB] ring-2 ring-white" />
                </div>
              )}

              {/* Room Rows */}
              {visibleRooms.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-[13px] text-[#57534E] mb-3">
                    Không có phòng phù hợp với bộ lọc hiện tại.
                  </p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setFloorFilter('all');
                        setRoomTypeFilter('all');
                        setSearchQuery('');
                      }}
                      className="min-h-[38px] px-4 rounded-lg bg-[#0F5132] text-white text-[12px] font-medium hover:bg-[#0B3D26]"
                    >
                      Xóa bộ lọc
                    </button>
                  )}
                </div>
              ) : (
                groupedRooms.map((group) => {
                  const perDaySummary = groupDailySummaryMap.get(group.label);
                  return (
                    <React.Fragment key={group.label || 'all'}>
                      {group.label && (
                        <div
                          data-testid={`calendar-group-header-${groupBy}`}
                          className={`flex bg-[#F3F0E9]/90 border-b border-[#E7E3DA] ${
                            isMobile ? 'h-[20px]' : ''
                          }`}
                        >
                          <div
                            style={{ width: stickyWidth }}
                            className={`sticky left-0 z-20 bg-[#F3F0E9] border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] font-semibold text-[#1C1B18] shrink-0 flex flex-col justify-center ${
                              isMobile ? 'px-1.5 text-[11px] leading-none' : 'px-3 py-1.5 text-[11px]'
                            }`}
                          >
                            <span className="truncate" title={group.label}>
                              {group.label}
                            </span>
                            {!isMobile && (
                              <span className="text-[10px] font-normal text-[#57534E]">
                                {group.rooms.length} phòng
                              </span>
                            )}
                          </div>
                          {perDaySummary ? (
                            <div
                              className="flex flex-1"
                              data-testid="room-type-daily-summary-row"
                            >
                              {perDaySummary.map((s) => (
                                <div
                                  key={s.date}
                                  style={{ width: colWidth }}
                                  title={`${group.label} · ${formatDateVN(s.date)}: ${s.vacant} trống / ${s.occupied} đang dùng (tổng ${s.total} phòng)`}
                                  className={`shrink-0 border-r border-[#E7E3DA] text-center font-mono-num leading-tight flex flex-col justify-center ${
                                    isMobile ? 'py-0' : 'py-1'
                                  } ${
                                    s.date === today
                                      ? 'bg-[#E8F3EC]/85'
                                      : s.vacant === 0
                                      ? 'bg-[#FEF2F2]/70'
                                      : ''
                                    }`}
                                >
                                  <div
                                    className={`text-[10px] font-semibold ${s.vacant === 0 ? 'text-[#B91C1C]' : 'text-[#0F5132]'
                                      }`}
                                  >
                                    {zoomDays === 60 || isMobile ? `${s.vacant}tr` : `${s.vacant} tr`}
                                  </div>
                                  {!isMobile && zoomDays !== 60 && (
                                    <div className="text-[9px] text-[#57534E]">{s.occupied} ở</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex-1" />
                          )}
                        </div>
                      )}

                      {group.rooms.map((room) => {
                        const roomBookings = (bookingsByRoom.get(room.id) || []).filter((b) =>
                          b.bookingMode === 'hourly'
                            ? b.checkIn >= windowStart && b.checkIn <= windowEnd
                            : b.checkOut > windowStart && b.checkIn <= windowEnd
                        );

                    return (
                      <div
                        key={room.id}
                        data-testid={`calendar-room-row-${room.roomNumber}`}
                        className={`flex border-b border-[#E7E3DA] relative ${rowHeightClass} bg-white`}
                      >
                        {/* Sticky Left Room Cell (56px compact on mobile, 148px on desktop) */}
                        <div
                          style={{ width: stickyWidth }}
                          data-testid={`calendar-room-cell-${room.roomNumber}`}
                          className={`sticky left-0 z-20 bg-white border-r border-[#E7E3DA] shadow-[2px_0_6px_-2px_rgba(28,27,24,0.08)] flex items-center justify-between shrink-0 ${
                            isMobile ? 'px-1 gap-0.5' : 'px-3 gap-2'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className={`flex items-center ${isMobile ? 'gap-[3px]' : 'gap-1.5'}`}>
                              <span
                                className={`rounded-full shrink-0 ${
                                  isMobile ? 'w-1.5 h-1.5' : 'w-2 h-2'
                                } ${
                                  room.hkStatus === 'clean'
                                    ? 'bg-[#0F5132]'
                                    : room.hkStatus === 'dirty'
                                    ? 'bg-[#D97706]'
                                    : room.hkStatus === 'cleaning'
                                    ? 'bg-[#335C67]'
                                    : 'bg-[#B91C1C]'
                                }`}
                              />
                              <span
                                className={`font-mono-num text-[#1C1B18] whitespace-nowrap ${
                                  isMobile
                                    ? 'text-[11px] font-bold tracking-tight'
                                    : 'text-[13px] font-semibold truncate'
                                }`}
                              >
                                {isMobile ? room.roomNumber : `P.${room.roomNumber}`}
                              </span>
                              {isMobile &&
                                (room.hkStatus === 'dirty' || room.hkStatus === 'cleaning') && (
                                  <Brush
                                    className="w-2.5 h-2.5 text-[#D97706] shrink-0"
                                    strokeWidth={2}
                                  />
                                )}
                            </div>
                            {((!isMobile && density === 'full') ||
                              (isMobile && showMobileRoomType)) && (
                              <div className="text-[9px] md:text-[10px] text-[#8A847C] truncate leading-tight">
                                {room.roomTypeName}
                              </div>
                            )}
                          </div>
                          {!isMobile &&
                            (room.hkStatus === 'dirty' || room.hkStatus === 'cleaning') && (
                              <span title="Phòng bẩn — cần dọn" className="text-[#D97706] shrink-0">
                                <Brush className="w-3.5 h-3.5" strokeWidth={1.75} />
                              </span>
                            )}
                        </div>

                        {/* Grid Cells + Overlay Bars (Pure View/Scroll — ZERO tap/click-to-create on empty cells!) */}
                        <div className="relative flex flex-1 overflow-hidden">
                          {dates.map((d) => {
                            const isMaintDay =
                              isRoomBlockedByMaintenance(room.id, maintenances, d, addDays(d, 1)) ||
                              (room.hkStatus === 'maintenance' && d === today);

                                return (
                                  <div
                                    key={d}
                                    style={{ width: colWidth }}
                                    title={isMaintDay ? `P.${room.roomNumber} đang bảo trì` : undefined}
                                    className={`h-full shrink-0 border-r border-[#F3F0E9] ${isMaintDay
                                      ? 'bg-[#FEF2F2] border-r-[#FECACA]'
                                      : d === today
                                        ? 'bg-[#0F5132]/[0.06] border-r-[#0F5132]/40'
                                        : isWeekendISO(d)
                                          ? 'bg-[#FAF8F3]'
                                          : ''
                                      }`}
                                  />
                                );
                              })}

                          {/* Booking Bars (26px height, 6px radius, 11px font on mobile) */}
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
                                data-testid={`calendar-booking-bar-${b.bookingCode}`}
                                onMouseEnter={(e) => handleBarHover(e, b)}
                                onMouseLeave={() => setHoveredInfo(null)}
                                onClick={(e) => handleBookingBarClick(e, b)}
                                style={{ left: leftPx, width: widthPx }}
                                className={`absolute ${barHeightClass} rounded-[6px] ${
                                  isMobile ? 'px-1.5' : 'px-2'
                                } flex items-center justify-between gap-1 text-[11px] font-medium cursor-pointer overflow-hidden shadow-xs z-[5] ${getBarClasses(
                                  b
                                )}`}
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  {!isMobile && b.source === 'ota' && (
                                    <span className="text-[9px] px-1 rounded bg-black/20 shrink-0">
                                      {(b.otaChannel || 'OTA').slice(0, 3)}
                                    </span>
                                  )}
                                  {b.bookingMode === 'hourly' && (
                                    <Clock className="w-3 h-3 shrink-0" strokeWidth={2} />
                                  )}
                                  {(b.groupName || b.groupId) && isMobile && (
                                    <Users className="w-2.5 h-2.5 shrink-0 opacity-90" strokeWidth={2.2} />
                                  )}
                                  <span className="truncate">{b.primaryGuestName}</span>
                                  {!isMobile && widthPx > 105 && (
                                    <span className="text-[10px] opacity-80 font-mono-num shrink-0">
                                      {b.bookingMode === 'hourly'
                                        ? `(${b.hourlyHours || 1}h)`
                                        : `(${b.nights}đ)`}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-0.5 shrink-0">
                                  {!isMobile && b.groupName && widthPx > 70 && (
                                    <span className="px-1 rounded bg-black/20 text-[9px] font-bold">
                                      G
                                    </span>
                                  )}
                                  {b.hasStayPermitAlert && (
                                    <AlertTriangle
                                      className="w-2.5 h-2.5 md:w-3 md:h-3 text-[#FEF08A]"
                                      strokeWidth={2}
                                    />
                                  )}
                                  {!isMobile && b.hasPendingAsm && (
                                    <Globe className="w-3 h-3 text-[#FDE68A]" strokeWidth={2} />
                                  )}
                                  {isPaidFull && (isMobile ? widthPx > 42 : widthPx > 60) && (
                                    isMobile ? (
                                      <Check className="w-3 h-3 opacity-95" strokeWidth={2.4} />
                                    ) : (
                                      <CheckCheck className="w-3 h-3 opacity-90" strokeWidth={2.2} />
                                    )
                                  )}
                                  {!isMobile && widthPx > 60 && isPartiallyPaid && (
                                    <Check className="w-3 h-3 opacity-90" strokeWidth={2.2} />
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
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* MOBILE STICKY BOTTOM LEGEND BAR (height: 26px, single horizontal scrollable row) */}
      <div
        data-testid="mobile-calendar-bottom-legend"
        className="md:hidden h-[26px] shrink-0 sticky bottom-0 z-30 bg-[#FAF9F6] border-t border-[#E7E3DA] px-2 flex items-center gap-3 overflow-x-auto whitespace-nowrap text-[10px] text-[#57534E]"
      >
        <span className="inline-flex items-center gap-1 shrink-0">
          <span className="w-2 h-2 rounded-xs bg-[#0F5132]" /> Đang ở
        </span>
        <span className="inline-flex items-center gap-1 shrink-0">
          <span className="w-2 h-2 rounded-xs bg-[#D97706]" /> Đặt trước
        </span>
        <span className="inline-flex items-center gap-1 shrink-0">
          <span className="w-2 h-2 rounded-xs bg-[#C2410C]" /> OTA
        </span>
        <span className="inline-flex items-center gap-1 shrink-0">
          <span className="w-2 h-2 rounded-xs bg-[#E6EFF1] border border-[#BFD5DA]" /> Đã trả
        </span>
        <span className="inline-flex items-center gap-0.5 text-[#0F5132] shrink-0">
          <Check className="w-2.5 h-2.5" strokeWidth={2.4} /> Đủ TT
        </span>
        <span className="inline-flex items-center gap-0.5 text-[#D97706] shrink-0">
          <Brush className="w-2.5 h-2.5" strokeWidth={2} /> Bẩn
        </span>
      </div>

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
                ? `${formatDateVN(hoveredInfo.booking.checkIn)} (${hoveredInfo.booking.hourlyHours || 1
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
