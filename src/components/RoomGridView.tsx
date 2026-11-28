import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BedDouble,
  Brush,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Globe,
  LogIn,
  Plus,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, HousekeepingStatus, Room } from '../types/pms';
import {
  addDays,
  diffDays,
  formatCurrency,
  formatDateVN,
  formatShortDate,
  getBookingGuestBalance,
  getHkStatusLabel,
  getSourceLabel,
  getStatusLabel,
  normalizeVietnamese,
  todayISO,
} from '../lib/utils';
import { checkInBooking, updateRoomHkStatus } from '../lib/pmsActions';

interface RoomGridViewProps {
  onSelectBooking: (booking: Booking) => void;
  onQuickCreateBooking: (room: Room) => void;
  onOpenMaintenance: (room: Room) => void;
  onSwitchToFinder: () => void;
}

type GroupMode = 'status' | 'floor' | 'room_type' | 'all';

function getNearestStayPermitExpiry(booking: Booking | undefined): string | null {
  if (!booking?.occupants?.length) return null;
  let nearest: string | null = null;
  for (const occ of booking.occupants) {
    const exp = occ.stayPermitExpiryDate;
    if (exp && (!nearest || exp < nearest)) nearest = exp;
  }
  return nearest;
}

export const RoomGridView: React.FC<RoomGridViewProps> = ({
  onSelectBooking,
  onQuickCreateBooking,
  onOpenMaintenance,
  onSwitchToFinder,
}) => {
  const {
    activeRooms: rooms,
    roomTypes,
    bookings,
    guests,
    customerGroups,
    hotelConfig,
    actor,
    isAdmin,
    seedSampleHotel,
    notify,
  } = usePms();

  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('status');
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [seeding, setSeeding] = useState(false);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const today = todayISO();

  // Keyboard shortcut `/` to focus room search (GoHost-inspired front-desk ergonomics)
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

  // Map room occupancy / arrivals / departures for selectedDate
  const roomStatusMap = useMemo(() => {
    const inHouse = new Map<string, Booking>();
    const arriving = new Map<string, Booking>();
    const departing = new Map<string, Booking>();
    const checkedOutOnDate = new Map<string, Booking>();
    const upcoming = new Map<string, Booking>();

    for (const b of bookings) {
      if (b.status === 'cancelled' || b.status === 'no_show') continue;
      if (b.status === 'in_house') {
        const coversDate =
          b.bookingMode === 'hourly'
            ? b.checkIn === selectedDate
            : b.checkIn <= selectedDate && b.checkOut > selectedDate;
        if (selectedDate === today || coversDate) {
          inHouse.set(b.roomId, b);
        }
        if (b.bookingMode !== 'hourly' && b.checkOut === selectedDate) {
          departing.set(b.roomId, b);
        }
      } else if (b.status === 'reserved') {
        if (b.checkIn === selectedDate) {
          arriving.set(b.roomId, b);
        } else if (b.checkIn > selectedDate) {
          const prev = upcoming.get(b.roomId);
          if (!prev || b.checkIn < prev.checkIn) upcoming.set(b.roomId, b);
        }
      } else if (b.status === 'checked_out' && b.checkOut === selectedDate) {
        checkedOutOnDate.set(b.roomId, b);
      }
    }
    return { inHouse, arriving, departing, checkedOutOnDate, upcoming };
  }, [bookings, selectedDate, today]);

  // 7-Card Operational Counter Strip stats
  const stats = useMemo(() => {
    const total = rooms.length;
    const inHouseList = Array.from(roomStatusMap.inHouse.values());
    const occupied = inHouseList.length;

    const arrivalsPending = roomStatusMap.arriving.size;
    const arrivalsCheckedIn = bookings.filter(
      (b) => b.status === 'in_house' && b.checkIn === selectedDate
    ).length;
    const arrivalsTotal = arrivalsPending + arrivalsCheckedIn;

    const departuresPending = roomStatusMap.departing.size;
    const departuresDone = roomStatusMap.checkedOutOnDate.size;
    const departuresTotal = departuresPending + departuresDone;

    const vacantRooms = rooms.filter(
      (r) => !roomStatusMap.inHouse.has(r.id) && r.hkStatus !== 'maintenance'
    );
    const vacantClean = vacantRooms.filter((r) => r.hkStatus === 'clean').length;
    const vacantDirty = vacantRooms.filter(
      (r) => r.hkStatus === 'dirty' || r.hkStatus === 'cleaning'
    ).length;

    const maintenanceCount = rooms.filter((r) => r.hkStatus === 'maintenance').length;
    const asmPending = bookings.filter(
      (b) => b.status === 'in_house' && (b.hasPendingAsm || b.hasStayPermitAlert)
    ).length;

    const receivableToday = [...inHouseList, ...Array.from(roomStatusMap.arriving.values())].reduce(
      (sum, b) => sum + Math.max(0, getBookingGuestBalance(b)),
      0
    );

    const occupancyPct = total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0;

    return {
      total,
      occupied,
      arrivalsPending,
      arrivalsCheckedIn,
      arrivalsTotal,
      departuresPending,
      departuresDone,
      departuresTotal,
      vacantTotal: vacantRooms.length,
      vacantClean,
      vacantDirty,
      maintenanceCount,
      asmPending,
      receivableToday,
      occupancyPct,
    };
  }, [rooms, roomStatusMap, bookings, selectedDate]);

  const floors = useMemo(() => {
    const set = new Set<string>(hotelConfig.floors || []);
    rooms.forEach((r) => set.add(r.floor));
    return Array.from(set);
  }, [hotelConfig.floors, rooms]);

  const getRoomOperationalBucket = (room: Room) => {
    const active = roomStatusMap.inHouse.get(room.id);
    const arrival = roomStatusMap.arriving.get(room.id);
    const departing = roomStatusMap.departing.get(room.id);
    if (room.hkStatus === 'maintenance') return 'maintenance';
    if (arrival && !active) return 'arriving';
    if (departing) return 'departing';
    if (active) return 'in_house';
    return 'vacant';
  };

  const filteredRooms = useMemo(() => {
    const q = normalizeVietnamese(searchQuery.trim());
    return rooms.filter((r) => {
      if (floorFilter !== 'all' && r.floor !== floorFilter) return false;
      if (typeFilter !== 'all' && r.roomTypeId !== typeFilter) return false;

      const active = roomStatusMap.inHouse.get(r.id);
      const arrival = roomStatusMap.arriving.get(r.id);
      const departing = roomStatusMap.departing.get(r.id);
      const primary = active || arrival;

      if (statusFilter === 'vacant' && (active || r.hkStatus === 'maintenance')) return false;
      if (statusFilter === 'in_house' && !active) return false;
      if (statusFilter === 'arriving' && !arrival) return false;
      if (statusFilter === 'departing' && !departing) return false;
      if (statusFilter === 'dirty' && r.hkStatus !== 'dirty' && r.hkStatus !== 'cleaning')
        return false;
      if (statusFilter === 'maintenance' && r.hkStatus !== 'maintenance') return false;
      if (statusFilter === 'asm_alert' && !(active?.hasPendingAsm || active?.hasStayPermitAlert))
        return false;

      if (q) {
        const hay = normalizeVietnamese(
          `${r.roomNumber} ${r.roomTypeName} ${primary?.primaryGuestName || ''} ${
            primary?.primaryGuestPhone || ''
          } ${primary?.bookingCode || ''} ${primary?.note || ''}`
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rooms, floorFilter, typeFilter, statusFilter, searchQuery, roomStatusMap]);

  const groupedSections = useMemo(() => {
    if (groupMode === 'all') {
      return [
        {
          key: 'all',
          title: 'Tất cả phòng hoạt động',
          accentClass: 'bg-[#0F5132] text-white',
          rooms: filteredRooms,
        },
      ];
    }

    if (groupMode === 'status') {
      const defs: Array<{ key: string; title: string; accentClass: string }> = [
        {
          key: 'arriving',
          title: `Sắp nhận phòng · ${stats.arrivalsCheckedIn}/${stats.arrivalsTotal} đã nhận`,
          accentClass: 'bg-[#D97706] text-white',
        },
        {
          key: 'departing',
          title: `Sắp trả phòng hôm nay · ${stats.departuresDone}/${stats.departuresTotal} đã trả`,
          accentClass: 'bg-[#C2410C] text-white',
        },
        {
          key: 'in_house',
          title: 'Đang lưu trú',
          accentClass: 'bg-[#0F5132] text-white',
        },
        {
          key: 'vacant',
          title: 'Phòng còn trống',
          accentClass: 'bg-[#57534E] text-white',
        },
        {
          key: 'maintenance',
          title: 'Đang bảo trì / Khóa phòng',
          accentClass: 'bg-[#991B1B] text-white',
        },
      ];
      return defs
        .map((d) => ({
          ...d,
          rooms: filteredRooms.filter((r) => getRoomOperationalBucket(r) === d.key),
        }))
        .filter((s) => s.rooms.length > 0);
    }

    if (groupMode === 'room_type') {
      const map = new Map<string, Room[]>();
      for (const r of filteredRooms) {
        const list = map.get(r.roomTypeName) || [];
        list.push(r);
        map.set(r.roomTypeName, list);
      }
      return Array.from(map.entries()).map(([name, list]) => ({
        key: name,
        title: name,
        accentClass: 'bg-[#292524] text-white',
        rooms: list,
      }));
    }

    // groupMode === 'floor'
    const map = new Map<string, Room[]>();
    for (const r of filteredRooms) {
      const list = map.get(r.floor) || [];
      list.push(r);
      map.set(r.floor, list);
    }
    return Array.from(map.entries()).map(([floor, list]) => ({
      key: floor,
      title: floor,
      accentClass: 'bg-[#292524] text-white',
      rooms: list,
    }));
  }, [filteredRooms, groupMode, stats]);

  const cycleHkStatus = async (e: React.MouseEvent, room: Room) => {
    e.stopPropagation();
    const order: HousekeepingStatus[] = ['clean', 'dirty', 'cleaning', 'maintenance'];
    const next = order[(order.indexOf(room.hkStatus) + 1) % order.length];
    await updateRoomHkStatus(room, next, actor);
    notify(`P.${room.roomNumber} chuyển sang: ${getHkStatusLabel(next)}`, 'info');
  };

  const handleOneClickMarkClean = async (e: React.MouseEvent, room: Room) => {
    e.stopPropagation();
    setBusyRoomId(room.id);
    try {
      await updateRoomHkStatus(room, 'clean', actor);
      notify(`P.${room.roomNumber} đã được đánh dấu Sạch sẵn sàng`);
    } finally {
      setBusyRoomId(null);
    }
  };

  const handleOneClickCheckIn = async (e: React.MouseEvent, booking: Booking) => {
    e.stopPropagation();
    setBusyRoomId(booking.roomId);
    try {
      await checkInBooking(booking, actor);
      notify(`Đã Check-in nhanh P.${booking.roomNumber} (${booking.primaryGuestName})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi nhận phòng nhanh', 'error');
    } finally {
      setBusyRoomId(null);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await seedSampleHotel();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Không thể khởi tạo dữ liệu mẫu', 'error');
    } finally {
      setSeeding(false);
    }
  };

  if (rooms.length === 0) {
    return (
      <div className="bg-white border border-[#E7E3DA] rounded-2xl p-10 text-center max-w-xl mx-auto mt-8">
        <div className="w-12 h-12 rounded-xl bg-[#E8F3EC] text-[#0F5132] flex items-center justify-center mx-auto mb-4">
          <BedDouble className="w-6 h-6" strokeWidth={1.5} />
        </div>
        <h2 className="text-[18px] font-semibold text-[#1C1B18]">
          Chưa có sơ đồ phòng cho Like Family Hotel
        </h2>
        <p className="text-[13px] text-[#57534E] mt-2 leading-relaxed">
          Cơ sở dữ liệu hiện đang trống. Bạn có thể khởi tạo nhanh bộ phòng mẫu chuẩn gồm 16 phòng
          (Tầng 2 đến Tầng 5), 4 loại phòng kèm bảng đa gói giá, hoặc tự cấu hình trong mục Cài đặt.
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={handleSeed}
            disabled={seeding}
            className="mt-5 h-10 px-5 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-50 text-white text-[14px] font-medium inline-flex items-center gap-2 transition-colors"
          >
            <Database className="w-4 h-4" strokeWidth={1.5} />
            {seeding ? 'Đang khởi tạo...' : 'Khởi tạo dữ liệu mẫu Like Family Hotel (16 phòng)'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Date Navigation & Instant Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center bg-white border border-[#E7E3DA] rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setSelectedDate((d) => addDays(d, -1))}
              className="w-8 h-8 rounded-lg hover:bg-[#FAF9F6] flex items-center justify-center text-[#57534E]"
              title="Ngày trước"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              className="h-8 px-3 text-[13px] font-medium text-[#1C1B18] hover:text-[#0F5132] font-mono-num"
            >
              {selectedDate === today ? `Hôm nay • ${formatDateVN(today)}` : formatDateVN(selectedDate)}
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
              className="w-8 h-8 rounded-lg hover:bg-[#FAF9F6] flex items-center justify-center text-[#57534E]"
              title="Ngày sau"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="relative w-64 sm:w-72">
            <Search
              className="w-3.5 h-3.5 text-[#8A847C] absolute left-3 top-1/2 -translate-y-1/2"
              strokeWidth={1.5}
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm khách, SĐT, mã đơn, số phòng..."
              className="w-full h-9 pl-8 pr-7 rounded-xl border border-[#E7E3DA] bg-white text-[13px] focus:outline-none focus:border-[#0F5132]"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-[#F3F0E9] text-[10px] font-mono-num text-[#8A847C]">
              /
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onSwitchToFinder}
          className="h-9 px-3.5 rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-4 h-4" strokeWidth={1.5} />
          Tìm phòng trống &amp; Đặt phòng
        </button>
      </div>

      {/* 7-Card Operational Counter Strip (GoHost-inspired, Like Family Emerald/Amber palette) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'arriving' ? 'all' : 'arriving')}
          className={`text-left bg-white border rounded-xl p-3 transition-colors ${
            statusFilter === 'arriving'
              ? 'border-[#D97706] bg-[#FFFBEB]/70'
              : 'border-[#E7E3DA] hover:border-[#D97706]/50'
          }`}
        >
          <div className="text-[11px] font-medium text-[#57534E] uppercase tracking-wide">
            Sắp nhận phòng
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono-num">
            <span className="text-[20px] font-semibold text-[#D97706]">
              {stats.arrivalsCheckedIn}/{stats.arrivalsTotal}
            </span>
            <span className="text-[11px] text-[#8A847C]">đã nhận</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'departing' ? 'all' : 'departing')}
          className={`text-left bg-white border rounded-xl p-3 transition-colors ${
            statusFilter === 'departing'
              ? 'border-[#C2410C] bg-[#FFF7ED]'
              : 'border-[#E7E3DA] hover:border-[#C2410C]/50'
          }`}
        >
          <div className="text-[11px] font-medium text-[#57534E] uppercase tracking-wide">
            Sắp trả phòng
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono-num">
            <span className="text-[20px] font-semibold text-[#C2410C]">
              {stats.departuresDone}/{stats.departuresTotal}
            </span>
            <span className="text-[11px] text-[#8A847C]">đã trả</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'in_house' ? 'all' : 'in_house')}
          className={`text-left bg-white border rounded-xl p-3 transition-colors ${
            statusFilter === 'in_house'
              ? 'border-[#0F5132] bg-[#E8F3EC]/60'
              : 'border-[#E7E3DA] hover:border-[#0F5132]/50'
          }`}
        >
          <div className="text-[11px] font-medium text-[#57534E] uppercase tracking-wide">
            Đang lưu trú
          </div>
          <div className="mt-1 text-[20px] font-semibold font-mono-num text-[#0F5132]">
            {stats.occupied}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'vacant' ? 'all' : 'vacant')}
          className={`text-left bg-white border rounded-xl p-3 transition-colors ${
            statusFilter === 'vacant'
              ? 'border-[#1C1B18] bg-[#FAF9F6]'
              : 'border-[#E7E3DA] hover:border-[#A9A295]'
          }`}
        >
          <div className="text-[11px] font-medium text-[#57534E] uppercase tracking-wide">
            Còn trống
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 font-mono-num">
            <span className="text-[20px] font-semibold text-[#1C1B18]">{stats.vacantTotal}</span>
            <span className="text-[10px] text-[#57534E]">
              {stats.vacantClean} sạch · {stats.vacantDirty} bẩn
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'maintenance' ? 'all' : 'maintenance')}
          className={`text-left bg-white border rounded-xl p-3 transition-colors ${
            statusFilter === 'maintenance'
              ? 'border-[#B91C1C] bg-[#FEF2F2]'
              : 'border-[#E7E3DA] hover:border-[#B91C1C]/40'
          }`}
        >
          <div className="text-[11px] font-medium text-[#57534E] uppercase tracking-wide">
            Bảo trì / Khóa
          </div>
          <div className="mt-1 text-[20px] font-semibold font-mono-num text-[#57534E]">
            {stats.maintenanceCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'asm_alert' ? 'all' : 'asm_alert')}
          className={`text-left border rounded-xl p-3 transition-colors ${
            stats.asmPending > 0
              ? 'bg-[#FEF2F2] border-[#FECACA]'
              : 'bg-white border-[#E7E3DA]'
          }`}
        >
          <div className="text-[11px] font-medium text-[#57534E] uppercase tracking-wide">
            Cảnh báo ASM
          </div>
          <div
            className={`mt-1 text-[20px] font-semibold font-mono-num ${
              stats.asmPending > 0 ? 'text-[#B91C1C]' : 'text-[#0F5132]'
            }`}
          >
            {stats.asmPending}
          </div>
        </button>

        <div className="bg-white border border-[#E7E3DA] rounded-xl p-3 col-span-2 sm:col-span-2 lg:col-span-1 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-medium text-[#57534E]">
            <span className="uppercase tracking-wide">Lấp đầy</span>
            <span className="font-mono-num font-semibold text-[#0F5132]">
              {stats.occupancyPct}%
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-[#F3F0E9] overflow-hidden">
            <div
              className="h-full bg-[#0F5132] rounded-full transition-all"
              style={{ width: `${Math.min(100, stats.occupancyPct)}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] font-mono-num text-[#8A847C]">
            {stats.occupied}/{stats.total} phòng
          </div>
        </div>
      </div>

      {/* Filter, Today's Receivable & 4-Way Grouping Bar */}
      <div className="bg-white border border-[#E7E3DA] rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px] focus:outline-none focus:border-[#0F5132]"
          >
            <option value="all">Tất cả loại phòng</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.isActive === false ? `${rt.name} (Ngừng SD)` : rt.name}
              </option>
            ))}
          </select>

          <select
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px] focus:outline-none focus:border-[#0F5132]"
          >
            <option value="all">Tất cả các tầng</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px] focus:outline-none focus:border-[#0F5132]"
          >
            <option value="all">Mọi trạng thái</option>
            <option value="arriving">Sắp nhận phòng</option>
            <option value="departing">Sắp trả phòng</option>
            <option value="in_house">Đang lưu trú</option>
            <option value="vacant">Còn trống</option>
            <option value="dirty">Phòng bẩn / Chờ dọn</option>
            <option value="maintenance">Đang bảo trì</option>
            <option value="asm_alert">Cảnh báo ASM / Hạn lưu trú</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[12px] text-[#57534E]">
            Còn phải thu hôm nay:{' '}
            <strong
              className={`font-mono-num ${
                stats.receivableToday > 0 ? 'text-[#B45309]' : 'text-[#0F5132]'
              }`}
            >
              {formatCurrency(stats.receivableToday)}
            </strong>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#8A847C]">Nhóm theo</span>
            <div className="inline-flex p-0.5 rounded-lg bg-[#F3F0E9]">
              {(
                [
                  { id: 'status', label: 'Trạng thái' },
                  { id: 'room_type', label: 'Loại phòng' },
                  { id: 'floor', label: 'Tầng' },
                  { id: 'all', label: 'Tất cả' },
                ] as Array<{ id: GroupMode; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setGroupMode(m.id)}
                  className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors ${
                    groupMode === m.id
                      ? 'bg-[#0F5132] text-white'
                      : 'text-[#57534E] hover:text-[#1C1B18]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Subtle Color Top-Strip Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-[#57534E]">
        <span className="text-[#8A847C]">Màu đầu thẻ:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-1 rounded-full bg-[#D97706]" /> Sắp nhận phòng
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-1 rounded-full bg-[#C2410C]" /> Sắp trả phòng
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-1 rounded-full bg-[#0F5132]" /> Đang lưu trú
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-1 rounded-full bg-[#A9A295]" /> Còn trống
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-1 rounded-full bg-[#B91C1C]" /> Bảo trì
        </span>
        <span className="inline-flex items-center gap-1 text-[#B45309]">
          <Brush className="w-3 h-3" strokeWidth={1.75} /> Phòng bẩn — cần dọn
        </span>
      </div>

      {/* Grouped Room Sections */}
      <div className="space-y-5">
        {groupedSections.length === 0 ? (
          <div className="bg-white border border-[#E7E3DA] rounded-2xl p-8 text-center text-[13px] text-[#8A847C]">
            Không có phòng nào khớp bộ lọc hiện tại.
          </div>
        ) : (
          groupedSections.map((section) => (
            <section key={section.key} className="space-y-2.5">
              <div
                className={`px-3.5 py-2 rounded-xl flex items-center justify-between text-[13px] font-semibold ${section.accentClass}`}
              >
                <span>
                  {section.title} ({section.rooms.length})
                </span>
                {groupMode === 'floor' && hotelConfig.wifiByFloor?.[section.key] && (
                  <span className="text-[11px] font-mono-num font-normal opacity-90">
                    Wi-Fi: {hotelConfig.wifiByFloor[section.key]}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {section.rooms.map((room) => {
                  const active = roomStatusMap.inHouse.get(room.id);
                  const arrival = roomStatusMap.arriving.get(room.id);
                  const departing = roomStatusMap.departing.get(room.id);
                  const nextUp = roomStatusMap.upcoming.get(room.id);
                  const primaryBooking = active || arrival;
                  const rt = roomTypes.find((t) => t.id === room.roomTypeId);
                  const defaultPrice =
                    rt?.priceTiers.find((p) => p.isDefault)?.price ||
                    rt?.priceTiers[0]?.price ||
                    0;

                  const isOccupied = Boolean(active);
                  const isMaintenance = room.hkStatus === 'maintenance';
                  const isDirty = room.hkStatus === 'dirty' || room.hkStatus === 'cleaning';
                  const balance = primaryBooking ? getBookingGuestBalance(primaryBooking) : 0;
                  const stayPermitExpiry = getNearestStayPermitExpiry(primaryBooking);
                  const permitDaysLeft = stayPermitExpiry ? diffDays(today, stayPermitExpiry) : null;

                  const topAccent = isMaintenance
                    ? 'border-t-[3px] border-t-[#B91C1C]'
                    : departing
                    ? 'border-t-[3px] border-t-[#C2410C]'
                    : isOccupied
                    ? 'border-t-[3px] border-t-[#0F5132]'
                    : arrival
                    ? 'border-t-[3px] border-t-[#D97706]'
                    : 'border-t-[3px] border-t-[#CBC5B9]';

                  const statusPill = isMaintenance
                    ? { label: 'Bảo trì', cls: 'bg-[#FEF2F2] text-[#B91C1C]' }
                    : departing
                    ? { label: 'Sắp trả', cls: 'bg-[#FFF7ED] text-[#C2410C]' }
                    : isOccupied
                    ? { label: 'Đã nhận phòng', cls: 'bg-[#E8F3EC] text-[#0F5132]' }
                    : arrival
                    ? { label: 'Đã đặt', cls: 'bg-[#FFFBEB] text-[#B45309]' }
                    : { label: 'Trống', cls: 'bg-[#F3F0E9] text-[#57534E]' };

                  return (
                    <div
                      key={room.id}
                      onClick={() => {
                        if (active) onSelectBooking(active);
                        else if (arrival) onSelectBooking(arrival);
                        else onQuickCreateBooking(room);
                      }}
                      className={`bg-white border border-[#E7E3DA] ${topAccent} rounded-xl p-3.5 cursor-pointer hover:border-[#0F5132]/50 hover:shadow-xs transition-all flex flex-col justify-between min-h-[172px]`}
                    >
                      {/* Top Header: Room Number + Dirty Icon + Status Pill */}
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono-num text-[15px] font-bold text-[#1C1B18]">
                                {room.roomNumber}
                              </span>
                              {isDirty && (
                                <button
                                  type="button"
                                  onClick={(e) => cycleHkStatus(e, room)}
                                  title={`${getHkStatusLabel(room.hkStatus)} — Bấm để đổi`}
                                  className="text-[#D97706] hover:text-[#B45309]"
                                >
                                  <Brush className="w-3.5 h-3.5" strokeWidth={1.75} />
                                </button>
                              )}
                              {primaryBooking?.groupName && (
                                <span
                                  title={`Đoàn: ${primaryBooking.groupName}`}
                                  className="px-1.5 py-0.2 rounded border border-[#E7E3DA] bg-[#FAF9F6] text-[10px] font-semibold text-[#57534E]"
                                >
                                  G
                                </span>
                              )}
                              {primaryBooking?.bookingMode === 'hourly' && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-[#FFFBEB] text-[#B45309] text-[10px] font-medium">
                                  <Clock className="w-2.5 h-2.5" strokeWidth={1.75} />
                                  {primaryBooking.hourlyHours || 1}h
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#8A847C] truncate">
                              {room.roomTypeName}
                            </div>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${statusPill.cls}`}
                          >
                            {statusPill.label}
                          </span>
                        </div>

                        {/* Body: Guest Info or Vacant Info */}
                        {primaryBooking ? (
                          <div className="mt-2.5 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-semibold text-[#1C1B18] truncate">
                                {primaryBooking.primaryGuestName}
                              </span>
                              {(() => {
                                const gRec = guests.find((g) => g.id === primaryBooking.primaryGuestId);
                                const grp = gRec?.customerGroupId
                                  ? customerGroups.find((cg) => cg.id === gRec.customerGroupId)
                                  : undefined;
                                if (!grp) return null;
                                return (
                                  <span
                                    title={grp.name}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
                                    style={{
                                      backgroundColor: `${grp.color}18`,
                                      color: grp.color,
                                    }}
                                  >
                                    {grp.name}
                                  </span>
                                );
                              })()}
                            </div>

                            <div className="flex items-center justify-between gap-2 text-[11px] text-[#57534E]">
                              <span className="font-mono-num">
                                {primaryBooking.bookingMode === 'hourly'
                                  ? `${primaryBooking.checkInTime || ''} → ${
                                      primaryBooking.checkOutTime || ''
                                    }`
                                  : `${formatShortDate(primaryBooking.checkIn)} → ${formatShortDate(
                                      primaryBooking.checkOut
                                    )}`}
                              </span>
                              <span className="truncate max-w-[90px] text-[#8A847C]">
                                {getSourceLabel(
                                  primaryBooking.source,
                                  primaryBooking.otaChannel,
                                  primaryBooking.sourceLabel
                                )}
                              </span>
                            </div>

                            {/* ASM / Stay Permit Alert Badges */}
                            {(primaryBooking.hasPendingAsm ||
                              primaryBooking.hasStayPermitAlert) && (
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {primaryBooking.hasPendingAsm && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FFFBEB] text-[#B45309] text-[10px] font-medium">
                                    <Globe className="w-2.5 h-2.5" strokeWidth={1.75} />
                                    Chưa ASM
                                  </span>
                                )}
                                {primaryBooking.hasStayPermitAlert && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] text-[10px] font-medium">
                                    <AlertTriangle className="w-2.5 h-2.5" strokeWidth={1.75} />
                                    Hạn lưu trú
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-3 space-y-1">
                            <div className="text-[12px] text-[#57534E]">
                              {isMaintenance ? 'Phòng tạm khóa bảo trì' : 'Sẵn sàng đón khách'}
                            </div>
                            <div className="text-[11px] font-mono-num text-[#8A847C]">
                              Giá mặc định: {formatCurrency(defaultPrice)}/đêm
                            </div>
                            {nextUp && (
                              <div className="text-[11px] text-[#B45309] font-mono-num flex items-center gap-1 pt-0.5">
                                <CalendarClock className="w-3 h-3 shrink-0" strokeWidth={1.5} />
                                Đặt tới: {formatShortDate(nextUp.checkIn)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Footer: Financial Clarity + Stay Permit Expiry / Note + 1-Click Actions */}
                      <div className="mt-3 pt-2 border-t border-[#F1EFEA] space-y-1.5">
                        {primaryBooking ? (
                          <>
                            <div className="flex items-center justify-between text-[12px]">
                              {balance <= 0 ? (
                                <span className="inline-flex items-center gap-1 text-[#0F5132] font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                                  Đã thanh toán
                                </span>
                              ) : (
                                <>
                                  <span className="text-[#57534E]">Còn lại</span>
                                  <span className="font-mono-num font-bold text-[#1C1B18]">
                                    {formatCurrency(balance)}
                                  </span>
                                </>
                              )}
                            </div>

                            {stayPermitExpiry ? (
                              <div
                                className={`text-[11px] font-mono-num truncate ${
                                  permitDaysLeft !== null && permitDaysLeft <= 3
                                    ? 'text-[#B91C1C] font-semibold'
                                    : 'text-[#8A847C]'
                                }`}
                              >
                                Lưu trú đến: {formatDateVN(stayPermitExpiry)}
                              </div>
                            ) : primaryBooking.note ? (
                              <div className="text-[11px] text-[#8A847C] truncate">
                                {primaryBooking.note}
                              </div>
                            ) : null}

                            {/* Direct 1-Click Check-in CTA on arriving card */}
                            {arrival && !active && (
                              <button
                                type="button"
                                disabled={busyRoomId === room.id}
                                onClick={(e) => handleOneClickCheckIn(e, arrival)}
                                className="w-full h-7 rounded-lg border border-[#0F5132]/30 bg-[#E8F3EC] hover:bg-[#0F5132] text-[#0F5132] hover:text-white text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-colors"
                              >
                                <LogIn className="w-3 h-3" strokeWidth={1.75} />
                                {busyRoomId === room.id ? 'Đang xử lý...' : 'Nhận phòng'}
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            {isDirty ? (
                              <button
                                type="button"
                                disabled={busyRoomId === room.id}
                                onClick={(e) => handleOneClickMarkClean(e, room)}
                                className="h-7 px-2.5 rounded-lg border border-[#0F5132]/30 bg-[#E8F3EC] hover:bg-[#0F5132] text-[#0F5132] hover:text-white text-[11px] font-medium inline-flex items-center gap-1 transition-colors"
                              >
                                <Sparkles className="w-3 h-3" strokeWidth={1.75} />
                                Đánh dấu sạch
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => cycleHkStatus(e, room)}
                                className="text-[11px] text-[#57534E] hover:text-[#0F5132]"
                              >
                                {getHkStatusLabel(room.hkStatus)}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenMaintenance(room);
                              }}
                              title="Nhật ký bảo trì phòng"
                              className="w-7 h-7 rounded-lg hover:bg-[#FAF9F6] text-[#8A847C] hover:text-[#1C1B18] inline-flex items-center justify-center"
                            >
                              <Wrench className="w-3.5 h-3.5" strokeWidth={1.5} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
};
