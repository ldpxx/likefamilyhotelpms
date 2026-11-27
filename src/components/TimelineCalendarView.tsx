import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Globe,
  MoveHorizontal,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, Room } from '../types/pms';
import {
  addDays,
  buildDailyRates,
  diffDays,
  formatDateVN,
  formatShortDate,
  getBookingGuestBalance,
  getWeekdayLabelVN,
  isBookingBlockingCalendar,
  isDateRangeOverlap,
  isWeekendISO,
  todayISO,
} from '../lib/utils';
import { updateBookingPricing } from '../lib/pmsActions';
import { DateInputVN } from './DateInputVN';

interface TimelineCalendarViewProps {
  onSelectBooking: (booking: Booking) => void;
  onCreateFromRange: (params: { room: Room; checkIn: string; checkOut: string }) => void;
  onRequestTransferRoom: (booking: Booking, targetRoom: Room) => void;
}

type ZoomLevel = 14 | 30 | 60;

export const TimelineCalendarView: React.FC<TimelineCalendarViewProps> = ({
  onSelectBooking,
  onCreateFromRange,
  onRequestTransferRoom,
}) => {
  const { activeRooms: rooms, bookings, roomTypes, actor, notify } = usePms();
  const today = todayISO();

  const [zoomDays, setZoomDays] = useState<ZoomLevel>(30);
  // Dynamic sliding window: starts 14 days before today, extends infinitely on scroll!
  const [windowStart, setWindowStart] = useState(() => addDays(today, -14));
  const [windowLength, setWindowLength] = useState<number>(75);
  const [jumpDate, setJumpDate] = useState(today);
  const [floorFilter, setFloorFilter] = useState('all');

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
  const initialScrolledRef = useRef(false);

  const colWidth = zoomDays === 14 ? 76 : zoomDays === 30 ? 48 : 30;
  const stickyWidth = 176;

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

  const visibleRooms = useMemo(() => {
    if (floorFilter === 'all') return rooms;
    return rooms.filter((r) => r.floor === floorFilter);
  }, [rooms, floorFilter]);

  const floors = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach((r) => set.add(r.floor));
    return Array.from(set);
  }, [rooms]);

  // Center on Today on initial mount
  useEffect(() => {
    if (initialScrolledRef.current || !scrollRef.current) return;
    const todayIdx = dateIndexMap.get(today);
    if (todayIdx !== undefined) {
      scrollRef.current.scrollLeft = Math.max(0, (todayIdx - 2) * colWidth);
      initialScrolledRef.current = true;
    }
  }, [dateIndexMap, today, colWidth]);

  const scrollToDate = (iso: string) => {
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

  // Infinite horizontal scroll handler: extends left or right seamlessly
  const handleScroll = () => {
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
        if (r.hkStatus === 'maintenance' && d === today) occupiedRoomIds.add(r.id);
      }
      for (const b of activeBookings) {
        if (b.status === 'cancelled' || b.status === 'no_show') continue;
        if (b.checkIn <= d && b.checkOut > d) {
          occupiedRoomIds.add(b.roomId);
        }
      }
      const vacant = Math.max(0, totalRooms - occupiedRoomIds.size);
      const occPct = totalRooms > 0 ? Math.round((occupiedRoomIds.size / totalRooms) * 100) : 0;
      return { date: d, vacant, occPct };
    });
  }, [dates, visibleRooms, bookings, today]);

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

        // Verify no conflict on selected range
        const conflict = bookings.some(
          (b) =>
            b.roomId === room.id &&
            isBookingBlockingCalendar(b.status) &&
            isDateRangeOverlap(b.checkIn, b.checkOut, start, checkOut)
        );
        if (conflict) {
          notify(`P.${room.roomNumber} đã có đơn trùng trong khoảng ngày đã chọn`, 'warning');
        } else {
          onCreateFromRange({ room, checkIn: start, checkOut });
        }
      }
      setDragSelect(null);
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [dragSelect, rooms, bookings, notify, onCreateFromRange]);

  const handleDropOnRoom = (targetRoom: Room) => {
    setDropTargetRoomId(null);
    if (!draggingBookingId) return;
    const booking = bookings.find((b) => b.id === draggingBookingId);
    setDraggingBookingId(null);
    if (!booking || booking.roomId === targetRoom.id) return;

    const conflict = bookings.some(
      (b) =>
        b.id !== booking.id &&
        b.roomId === targetRoom.id &&
        isBookingBlockingCalendar(b.status) &&
        isDateRangeOverlap(b.checkIn, b.checkOut, booking.checkIn, booking.checkOut)
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
    const conflict = bookings.some(
      (b) =>
        b.id !== booking.id &&
        b.roomId === booking.roomId &&
        isBookingBlockingCalendar(b.status) &&
        isDateRangeOverlap(b.checkIn, b.checkOut, booking.checkIn, nextCheckOut)
    );
    if (conflict) {
      notify(`P.${booking.roomNumber} đã có khách đặt vào ngày ${formatShortDate(booking.checkOut)}`, 'warning');
      return;
    }
    const lastRate =
      booking.dailyRates[booking.dailyRates.length - 1]?.rate ||
      roomTypes.find((rt) => rt.id === booking.roomTypeId)?.priceTiers[0]?.price ||
      350000;
    const nextRates = buildDailyRates(booking.checkIn, nextCheckOut, lastRate, booking.dailyRates);
    await updateBookingPricing(
      booking,
      { dailyRates: nextRates, checkOut: nextCheckOut, reason: 'Gia hạn thêm 1 đêm trực tiếp trên lịch' },
      actor
    );
    notify(`Đã gia hạn ${booking.bookingCode} (P.${booking.roomNumber}) thêm 1 đêm tới ${formatShortDate(nextCheckOut)}`);
  };

  const getBarClasses = (b: Booking) => {
    if (b.status === 'checked_out' || b.status === 'transferred') {
      return 'bg-[#E7E5E0] text-[#57534E] border border-[#D0CBC2]';
    }
    if (b.source === 'ota') {
      return b.status === 'in_house'
        ? 'bg-[#C2410C] text-white border border-[#9A3412]'
        : 'bg-[#EA580C] text-white border border-[#C2410C]';
    }
    if (b.status === 'in_house') {
      return 'bg-[#1B5E4B] text-white border border-[#144839]';
    }
    return 'bg-[#2563EB] text-white border border-[#1D4ED8]';
  };

  // Group rooms by floor preserving order
  const groupedRooms = useMemo(() => {
    const out: Array<{ floor: string; rooms: Room[] }> = [];
    for (const r of visibleRooms) {
      const last = out[out.length - 1];
      if (!last || last.floor !== r.floor) {
        out.push({ floor: r.floor, rooms: [r] });
      } else {
        last.rooms.push(r);
      }
    }
    return out;
  }, [visibleRooms]);

  const windowEnd = dates[dates.length - 1];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="bg-white border border-[#E5E2DC] rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => scrollToDate(today)}
            className="h-8 px-3 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[12px] font-medium transition-colors"
          >
            Hôm nay
          </button>
          <button
            type="button"
            onClick={() => shiftDays(-7)}
            className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] text-[#1C1B18] inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.5} />1 tuần
          </button>
          <button
            type="button"
            onClick={() => shiftDays(-1)}
            className="h-8 px-2 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] text-[#1C1B18]"
          >
            &lt; 1 ngày
          </button>
          <button
            type="button"
            onClick={() => shiftDays(1)}
            className="h-8 px-2 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] text-[#1C1B18]"
          >
            1 ngày &gt;
          </button>
          <button
            type="button"
            onClick={() => shiftDays(7)}
            className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] text-[#1C1B18] inline-flex items-center gap-1"
          >
            1 tuần
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>

          <div className="ml-1 w-36">
            <DateInputVN
              value={jumpDate}
              onChange={(v) => {
                setJumpDate(v);
                if (v) scrollToDate(v);
              }}
              className="h-8 text-[12px]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
          >
            <option value="all">Tất cả tầng</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <div className="flex items-center p-0.5 rounded-lg bg-[#F1EFEA]">
            {([14, 30, 60] as ZoomLevel[]).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoomDays(z)}
                className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors ${
                  zoomDays === z ? 'bg-white text-[#1C1B18] shadow-xs' : 'text-[#57534E]'
                }`}
              >
                {z} ngày
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend & Interaction Hint */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[#57534E]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#2563EB]" /> Đặt trước
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#1B5E4B]" /> Đang lưu trú
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#EA580C]" /> Kênh OTA
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#E7E5E0] border border-[#D0CBC2]" /> Đã trả phòng
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[#8A847C]">
          <MoveHorizontal className="w-3.5 h-3.5" strokeWidth={1.5} />
          Kéo chọn ô trống để đặt phòng • Kéo thanh đặt phòng sang phòng khác để đổi phòng • Bấm +1đ ở mép phải để gia hạn
        </div>
      </div>

      {/* Continuous Scrollable Matrix */}
      <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-250px)] select-none"
        >
          <div style={{ width: stickyWidth + dates.length * colWidth }}>
            {/* Sticky Date Header + Availability Summary Row */}
            <div className="sticky top-0 z-20 bg-[#FAF9F6] border-b border-[#E5E2DC]">
              {/* Row 1: Dates */}
              <div className="flex">
                <div
                  style={{ width: stickyWidth }}
                  className="sticky left-0 z-30 bg-[#FAF9F6] border-r border-[#E5E2DC] px-3 py-2 flex flex-col justify-center shrink-0"
                >
                  <span className="text-[12px] font-semibold text-[#1C1B18]">Phòng / Tầng</span>
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
                      className={`shrink-0 border-r border-[#E5E2DC] py-1.5 text-center ${
                        isToday
                          ? 'bg-[#1B5E4B] text-white'
                          : weekend
                          ? 'bg-[#F3EFE8] text-[#1C1B18]'
                          : 'bg-[#FAF9F6] text-[#1C1B18]'
                      } ${isFirstOfMonth ? 'border-l-2 border-l-[#1B5E4B]/50' : ''}`}
                    >
                      <div className={`text-[10px] ${isToday ? 'text-white/80' : 'text-[#8A847C]'}`}>
                        {getWeekdayLabelVN(d)}
                      </div>
                      <div className="text-[11px] font-mono-num font-semibold">
                        {zoomDays === 60 ? d.slice(8, 10) : formatShortDate(d)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Row 2: Availability & Occupancy Summary */}
              <div className="flex border-t border-[#E5E2DC] bg-white">
                <div
                  style={{ width: stickyWidth }}
                  className="sticky left-0 z-30 bg-[#F7F6F3] border-r border-[#E5E2DC] px-3 py-1 text-[11px] font-medium text-[#57534E] shrink-0"
                >
                  Trống / Lấp đầy
                </div>
                {dailySummary.map((s) => (
                  <div
                    key={s.date}
                    style={{ width: colWidth }}
                    className={`shrink-0 border-r border-[#E5E2DC] py-1 text-center font-mono-num ${
                      s.date === today ? 'bg-[#E8F2EE]' : ''
                    }`}
                  >
                    <div
                      className={`text-[11px] font-semibold ${
                        s.vacant === 0 ? 'text-[#B91C1C]' : 'text-[#15803D]'
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
            </div>

            {/* Room Rows Grouped by Floor */}
            {groupedRooms.map((group) => (
              <React.Fragment key={group.floor}>
                <div className="flex bg-[#F1EFEA]/80 border-b border-[#E5E2DC]">
                  <div
                    style={{ width: stickyWidth }}
                    className="sticky left-0 z-10 bg-[#F1EFEA] border-r border-[#E5E2DC] px-3 py-1 text-[11px] font-semibold text-[#57534E]"
                  >
                    {group.floor} ({group.rooms.length} phòng)
                  </div>
                  <div className="flex-1" />
                </div>

                {group.rooms.map((room) => {
                  const roomBookings = (bookingsByRoom.get(room.id) || []).filter(
                    (b) => b.checkOut > windowStart && b.checkIn <= windowEnd
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
                      className={`flex border-b border-[#E5E2DC] relative h-11 ${
                        isDropTarget ? 'bg-[#E8F2EE]/70' : 'bg-white'
                      }`}
                    >
                      {/* Sticky Left Room Cell */}
                      <div
                        style={{ width: stickyWidth }}
                        className="sticky left-0 z-10 bg-white border-r border-[#E5E2DC] px-3 flex items-center justify-between gap-2 shrink-0"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                room.hkStatus === 'clean'
                                  ? 'bg-[#15803D]'
                                  : room.hkStatus === 'dirty'
                                  ? 'bg-[#B45309]'
                                  : room.hkStatus === 'cleaning'
                                  ? 'bg-[#1D4ED8]'
                                  : 'bg-[#B91C1C]'
                              }`}
                            />
                            <span className="font-mono-num text-[13px] font-semibold text-[#1C1B18]">
                              P.{room.roomNumber}
                            </span>
                          </div>
                          <div className="text-[10px] text-[#8A847C] truncate">
                            {room.roomTypeName}
                          </div>
                        </div>
                      </div>

                      {/* Grid Cells + Overlay Bars */}
                      <div className="relative flex flex-1">
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

                          return (
                            <div
                              key={d}
                              style={{ width: colWidth }}
                              onMouseDown={() =>
                                setDragSelect({ roomId: room.id, startDate: d, endDate: d })
                              }
                              onMouseEnter={() => {
                                if (dragSelect && dragSelect.roomId === room.id) {
                                  setDragSelect({ ...dragSelect, endDate: d });
                                }
                              }}
                              className={`h-full shrink-0 border-r border-[#F1EFEA] cursor-crosshair transition-colors ${
                                isSelected
                                  ? 'bg-[#1B5E4B]/20'
                                  : d === today
                                  ? 'bg-[#1B5E4B]/[0.05] border-r-[#1B5E4B]/30'
                                  : isWeekendISO(d)
                                  ? 'bg-[#FAF8F4]'
                                  : 'hover:bg-[#F7F6F3]'
                              }`}
                            />
                          );
                        })}

                        {/* Booking Bars (Half-cell check-in to half-cell check-out) */}
                        {roomBookings.map((b) => {
                          const startOffset = diffDays(windowStart, b.checkIn);
                          const isBeforeWindow = b.checkIn < windowStart;
                          const effectiveStartDays = isBeforeWindow ? 0 : startOffset;
                          const endOffset = diffDays(windowStart, b.checkOut);
                          const clampedEnd = Math.min(dates.length, endOffset);

                          const leftPx = isBeforeWindow
                            ? 0
                            : effectiveStartDays * colWidth + colWidth * 0.45;
                          const rightPx =
                            endOffset > dates.length
                              ? dates.length * colWidth
                              : clampedEnd * colWidth + colWidth * 0.45;
                          const widthPx = Math.max(colWidth * 0.6, rightPx - leftPx);

                          const unpaid = getBookingGuestBalance(b) > 0 && b.status !== 'checked_out';

                          return (
                            <div
                              key={b.id}
                              draggable={b.status === 'reserved' || b.status === 'in_house'}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                setDraggingBookingId(b.id);
                              }}
                              onDragEnd={() => {
                                setDraggingBookingId(null);
                                setDropTargetRoomId(null);
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectBooking(b);
                              }}
                              style={{ left: leftPx, width: widthPx }}
                              title={`${b.bookingCode} | ${b.primaryGuestName} | ${
                                b.bookingMode === 'hourly'
                                  ? `${formatDateVN(b.checkIn)} (${b.hourlyHours || 1} giờ)`
                                  : `${formatDateVN(b.checkIn)} → ${formatDateVN(b.checkOut)} (${
                                      b.nights
                                    } đêm)`
                              }`}
                              className={`group absolute top-1.5 h-8 rounded-md px-2 flex items-center justify-between gap-1 text-[11px] font-medium cursor-pointer overflow-hidden shadow-xs z-10 ${getBarClasses(
                                b
                              )}`}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                {b.source === 'ota' && (
                                  <span className="text-[9px] px-1 rounded bg-black/20 shrink-0">
                                    {(b.otaChannel || 'OTA').slice(0, 3)}
                                  </span>
                                )}
                                <span className="truncate">{b.primaryGuestName}</span>
                                {widthPx > 90 && (
                                  <span className="text-[10px] opacity-80 font-mono-num shrink-0">
                                    {b.bookingMode === 'hourly'
                                      ? `(${b.hourlyHours || 1}h)`
                                      : `(${b.nights}đ)`}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {b.hasStayPermitAlert && (
                                  <AlertTriangle className="w-3 h-3 text-[#FEF08A]" strokeWidth={2} />
                                )}
                                {b.hasPendingAsm && (
                                  <Globe className="w-3 h-3 text-[#FDE68A]" strokeWidth={2} />
                                )}
                                {unpaid && widthPx > 75 && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#FDE047]" title="Chưa thu đủ" />
                                )}
                                {(b.status === 'reserved' || b.status === 'in_house') && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleExtendOneNight(e, b)}
                                    title="Gia hạn thêm 1 đêm"
                                    className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded bg-black/25 hover:bg-black/40 text-[9px] font-mono-num transition-opacity"
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
    </div>
  );
};
