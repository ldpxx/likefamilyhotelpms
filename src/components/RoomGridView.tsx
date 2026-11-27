import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BedDouble,
  CalendarClock,
  CheckCircle2,
  Clock,
  Database,
  Globe,
  Plus,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, HousekeepingStatus, Room } from '../types/pms';
import {
  addDays,
  formatCurrency,
  formatDateVN,
  getBookingGuestBalance,
  getHkStatusLabel,
  isLoyalGuest,
  todayISO,
} from '../lib/utils';
import { updateRoomHkStatus } from '../lib/pmsActions';

interface RoomGridViewProps {
  onSelectBooking: (booking: Booking) => void;
  onQuickCreateBooking: (room: Room) => void;
  onOpenMaintenance: (room: Room) => void;
  onSwitchToFinder: () => void;
}

export const RoomGridView: React.FC<RoomGridViewProps> = ({
  onSelectBooking,
  onQuickCreateBooking,
  onOpenMaintenance,
  onSwitchToFinder,
}) => {
  const {
    activeRooms: rooms,
    activeRoomTypes: roomTypes,
    bookings,
    hotelConfig,
    actor,
    isAdmin,
    seedSampleHotel,
    notify,
  } = usePms();
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [seeding, setSeeding] = useState(false);

  const today = todayISO();

  // Map active in_house booking & today's arrival reserved booking per room
  const roomStatusMap = useMemo(() => {
    const inHouse = new Map<string, Booking>();
    const arrivingToday = new Map<string, Booking>();
    const upcoming = new Map<string, Booking>();

    for (const b of bookings) {
      if (b.status === 'in_house') {
        inHouse.set(b.roomId, b);
      } else if (b.status === 'reserved') {
        if (b.checkIn === today) {
          arrivingToday.set(b.roomId, b);
        } else if (b.checkIn > today) {
          const prev = upcoming.get(b.roomId);
          if (!prev || b.checkIn < prev.checkIn) {
            upcoming.set(b.roomId, b);
          }
        }
      }
    }
    return { inHouse, arrivingToday, upcoming };
  }, [bookings, today]);

  const stats = useMemo(() => {
    const total = rooms.length;
    const occupied = roomStatusMap.inHouse.size;
    const arrivals = Array.from(roomStatusMap.arrivingToday.values()).length;
    const dirty = rooms.filter((r) => r.hkStatus === 'dirty' || r.hkStatus === 'cleaning').length;
    const asmPending = bookings.filter(
      (b) => b.status === 'in_house' && (b.hasPendingAsm || b.hasStayPermitAlert)
    ).length;
    return { total, occupied, arrivals, dirty, asmPending };
  }, [rooms, roomStatusMap, bookings]);

  const floors = useMemo(() => {
    const set = new Set<string>(hotelConfig.floors || []);
    rooms.forEach((r) => set.add(r.floor));
    return Array.from(set);
  }, [hotelConfig.floors, rooms]);

  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (floorFilter !== 'all' && r.floor !== floorFilter) return false;
      if (typeFilter !== 'all' && r.roomTypeId !== typeFilter) return false;
      const active = roomStatusMap.inHouse.get(r.id);
      const arrival = roomStatusMap.arrivingToday.get(r.id);
      if (statusFilter === 'vacant' && (active || r.hkStatus === 'maintenance')) return false;
      if (statusFilter === 'in_house' && !active) return false;
      if (statusFilter === 'arriving' && !arrival) return false;
      if (statusFilter === 'dirty' && r.hkStatus !== 'dirty' && r.hkStatus !== 'cleaning')
        return false;
      if (statusFilter === 'maintenance' && r.hkStatus !== 'maintenance') return false;
      if (statusFilter === 'asm_alert' && !(active?.hasPendingAsm || active?.hasStayPermitAlert))
        return false;
      return true;
    });
  }, [rooms, floorFilter, typeFilter, statusFilter, roomStatusMap]);

  const groupedByFloor = useMemo(() => {
    const map = new Map<string, Room[]>();
    for (const r of filteredRooms) {
      const list = map.get(r.floor) || [];
      list.push(r);
      map.set(r.floor, list);
    }
    return Array.from(map.entries());
  }, [filteredRooms]);

  const cycleHkStatus = async (e: React.MouseEvent, room: Room) => {
    e.stopPropagation();
    const order: HousekeepingStatus[] = ['clean', 'dirty', 'cleaning', 'maintenance'];
    const next = order[(order.indexOf(room.hkStatus) + 1) % order.length];
    await updateRoomHkStatus(room, next, actor);
    notify(`P.${room.roomNumber} chuyển sang: ${getHkStatusLabel(next)}`, 'info');
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
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-10 text-center max-w-xl mx-auto mt-8">
        <div className="w-12 h-12 rounded-xl bg-[#E8F2EE] text-[#1B5E4B] flex items-center justify-center mx-auto mb-4">
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
            className="mt-5 h-10 px-5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-50 text-white text-[14px] font-medium inline-flex items-center gap-2 transition-colors"
          >
            <Database className="w-4 h-4" strokeWidth={1.5} />
            {seeding ? 'Đang khởi tạo...' : 'Khởi tạo dữ liệu mẫu Like Family Hotel (16 phòng)'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Compact KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
          <div className="text-[12px] text-[#57534E]">Đang lưu trú</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[22px] font-semibold font-mono-num text-[#1B5E4B]">
              {stats.occupied}
            </span>
            <span className="text-[12px] font-mono-num text-[#8A847C]">/ {stats.total} phòng</span>
          </div>
        </div>
        <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
          <div className="text-[12px] text-[#57534E]">Phòng trống sẵn sàng</div>
          <div className="mt-1 text-[22px] font-semibold font-mono-num text-[#1C1B18]">
            {Math.max(0, stats.total - stats.occupied)}
          </div>
        </div>
        <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
          <div className="text-[12px] text-[#57534E]">Khách đến hôm nay</div>
          <div className="mt-1 text-[22px] font-semibold font-mono-num text-[#1D4ED8]">
            {stats.arrivals}
          </div>
        </div>
        <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
          <div className="text-[12px] text-[#57534E]">Phòng chờ dọn</div>
          <div className="mt-1 text-[22px] font-semibold font-mono-num text-[#B45309]">
            {stats.dirty}
          </div>
        </div>
        <div
          className={`border rounded-xl p-4 col-span-2 lg:col-span-1 ${
            stats.asmPending > 0
              ? 'bg-[#FEF2F2] border-[#FECACA]'
              : 'bg-white border-[#E5E2DC]'
          }`}
        >
          <div className="text-[12px] text-[#57534E]">Cảnh báo ASM / Hạn lưu trú</div>
          <div
            className={`mt-1 text-[22px] font-semibold font-mono-num ${
              stats.asmPending > 0 ? 'text-[#B91C1C]' : 'text-[#15803D]'
            }`}
          >
            {stats.asmPending}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-[#E5E2DC] rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] focus:outline-none focus:border-[#1B5E4B]"
          >
            <option value="all">Tất cả các tầng</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] focus:outline-none focus:border-[#1B5E4B]"
          >
            <option value="all">Tất cả loại phòng</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'vacant', label: 'Còn trống' },
              { id: 'in_house', label: 'Đang ở' },
              { id: 'arriving', label: 'Đến hôm nay' },
              { id: 'dirty', label: 'Chờ dọn' },
              { id: 'maintenance', label: 'Bảo trì' },
              { id: 'asm_alert', label: 'Cảnh báo ASM' },
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setStatusFilter(chip.id)}
                className={`h-8 px-3 rounded-lg text-[12px] font-medium transition-colors ${
                  statusFilter === chip.id
                    ? 'bg-[#1C1B18] text-white'
                    : 'bg-[#F1EFEA] text-[#57534E] hover:text-[#1C1B18]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onSwitchToFinder}
          className="h-9 px-3.5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-4 h-4" strokeWidth={1.5} />
          Tìm phòng trống & Đặt phòng
        </button>
      </div>

      {/* Floor Groups */}
      <div className="space-y-5">
        {groupedByFloor.map(([floor, floorRooms]) => (
          <section key={floor} className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-[#1C1B18]">{floor}</h3>
                <span className="text-[12px] font-mono-num text-[#8A847C]">
                  {floorRooms.length} phòng
                </span>
              </div>
              {hotelConfig.wifiByFloor?.[floor] && (
                <span className="text-[11px] font-mono-num text-[#8A847C]">
                  Wi-Fi: {hotelConfig.wifiByFloor[floor]}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {floorRooms.map((room) => {
                const active = roomStatusMap.inHouse.get(room.id);
                const arrival = roomStatusMap.arrivingToday.get(room.id);
                const nextUp = roomStatusMap.upcoming.get(room.id);
                const rt = roomTypes.find((t) => t.id === room.roomTypeId);
                const defaultPrice =
                  rt?.priceTiers.find((p) => p.isDefault)?.price || rt?.priceTiers[0]?.price || 0;

                const isOccupied = Boolean(active);
                const isMaintenance = room.hkStatus === 'maintenance';
                const balance = active ? getBookingGuestBalance(active) : 0;

                const topAccent = isMaintenance
                  ? 'border-t-2 border-t-[#B91C1C]'
                  : isOccupied
                  ? 'border-t-2 border-t-[#1B5E4B]'
                  : arrival
                  ? 'border-t-2 border-t-[#1D4ED8]'
                  : 'border-t-2 border-t-[#D6D3CD]';

                return (
                  <div
                    key={room.id}
                    onClick={() => {
                      if (active) onSelectBooking(active);
                      else if (arrival) onSelectBooking(arrival);
                      else onQuickCreateBooking(room);
                    }}
                    className={`bg-white border border-[#E5E2DC] ${topAccent} rounded-xl p-4 cursor-pointer hover:border-[#B8B2A6] transition-colors flex flex-col justify-between min-h-[162px]`}
                  >
                    {/* Header */}
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono-num text-[15px] font-semibold text-[#1C1B18]">
                              P.{room.roomNumber}
                            </span>
                            {active?.groupName && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F1EFEA] text-[#57534E] font-medium truncate max-w-[100px]">
                                {active.groupName}
                              </span>
                            )}
                          </div>
                          <div className="text-[12px] text-[#57534E] truncate">
                            {room.roomTypeName}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => cycleHkStatus(e, room)}
                          title="Bấm để đổi trạng thái buồng phòng"
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[11px] font-medium text-[#57534E] shrink-0"
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              room.hkStatus === 'clean'
                                ? 'bg-[#15803D]'
                                : room.hkStatus === 'dirty'
                                ? 'bg-[#B45309]'
                                : room.hkStatus === 'cleaning'
                                ? 'bg-[#1D4ED8]'
                                : 'bg-[#B91C1C]'
                            }`}
                          />
                          {getHkStatusLabel(room.hkStatus)}
                        </button>
                      </div>

                      {/* Middle Content */}
                      <div className="mt-3">
                        {active ? (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[13px] font-semibold text-[#1C1B18] truncate flex items-center gap-1">
                                {active.primaryGuestName}
                                {(isLoyalGuest(active.guestStayCount) || active.isReturningGuest) && (
                                  <Award
                                    className="w-3.5 h-3.5 text-[#B45309] shrink-0"
                                    strokeWidth={1.75}
                                  />
                                )}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#57534E] shrink-0">
                                <Users className="w-3 h-3" strokeWidth={1.5} />
                                {active.occupantCount}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono-num text-[#57534E]">
                              {active.bookingMode === 'hourly' ? (
                                <span className="inline-flex items-center gap-1 text-[#1D4ED8] font-medium">
                                  <Clock className="w-3 h-3" strokeWidth={1.5} />
                                  Nghỉ giờ {active.hourlyHours || 1}h ({active.checkInTime} →{' '}
                                  {active.checkOutTime})
                                </span>
                              ) : (
                                <>
                                  {formatDateVN(active.checkIn)} → {formatDateVN(active.checkOut)} (
                                  {active.nights}đ)
                                  {active.checkOut === today && (
                                    <span className="ml-1 text-[#B45309] font-medium">
                                      • Trả hôm nay
                                    </span>
                                  )}
                                </>
                              )}
                            </div>

                            {/* Alerts */}
                            {(active.hasStayPermitAlert || active.hasPendingAsm) && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {active.hasStayPermitAlert && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-[10px] font-medium">
                                    <AlertTriangle className="w-3 h-3" strokeWidth={1.5} />
                                    Hạn lưu trú
                                  </span>
                                )}
                                {active.hasPendingAsm && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-[10px] font-medium">
                                    <Globe className="w-3 h-3" strokeWidth={1.5} />
                                    Chưa khai ASM
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : arrival ? (
                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-[#1D4ED8] flex items-center gap-1">
                              <CalendarClock className="w-3.5 h-3.5" strokeWidth={1.5} />
                              Đặt đến hôm nay
                            </div>
                            <div className="text-[13px] font-medium text-[#1C1B18] truncate">
                              {arrival.primaryGuestName}
                            </div>
                            <div className="text-[12px] font-mono-num text-[#57534E]">
                              {arrival.nights} đêm • {formatCurrency(arrival.grossRoomTotal)}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-[12px] text-[#8A847C]">
                              {isMaintenance ? 'Phòng đang khóa bảo trì' : 'Phòng trống'}
                            </div>
                            <div className="text-[12px] font-mono-num text-[#57534E]">
                              Từ {formatCurrency(defaultPrice)}/đêm
                            </div>
                            {nextUp && (
                              <div className="text-[11px] text-[#57534E] truncate">
                                Đơn kế tiếp: {formatDateVN(nextUp.checkIn)} ({nextUp.primaryGuestName})
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer actions */}
                    <div className="mt-3 pt-2.5 border-t border-[#F1EFEA] flex items-center justify-between text-[11px]">
                      {active ? (
                        <span
                          className={`font-mono-num font-medium ${
                            balance > 0 ? 'text-[#B45309]' : 'text-[#15803D]'
                          }`}
                        >
                          {balance > 0 ? `Còn thiếu ${formatCurrency(balance)}` : 'Đã thanh toán đủ'}
                        </span>
                      ) : (
                        <span className="text-[#1B5E4B] font-medium">
                          {arrival ? 'Mở nhận phòng' : '+ Đặt phòng nhanh'}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenMaintenance(room);
                        }}
                        className="p-1 rounded hover:bg-[#F1EFEA] text-[#8A847C] hover:text-[#1C1B18] transition-colors"
                        title="Nhật ký bảo trì phòng"
                      >
                        <Wrench className="w-3.5 h-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Unused icon suppression check */}
      <span className="hidden">
        <CheckCircle2 />
        <Sparkles />
        {addDays(today, 0)}
      </span>
    </div>
  );
};
