import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Room } from '../types/pms';
import {
  addDays,
  diffDays,
  formatCurrency,
  getHkStatusLabel,
  isBookingBlockingCalendar,
  todayISO,
} from '../lib/utils';
import { doBookingIntervalsOverlap, isRoomBlockedByMaintenance } from '../lib/revenueMetrics';
import { DateInputVN } from './DateInputVN';

interface SearchRow {
  id: string;
  roomTypeId: string;
  quantity: number;
}

interface AvailabilityFinderProps {
  onCreateSingleBooking: (params: { room: Room; checkIn: string; checkOut: string }) => void;
  onCreateGroupBooking: (params: { rooms: Room[]; checkIn: string; checkOut: string }) => void;
}

export const AvailabilityFinder: React.FC<AvailabilityFinderProps> = ({
  onCreateSingleBooking,
  onCreateGroupBooking,
}) => {
  const { activeRooms: rooms, roomTypes: allRoomTypes, bookings, maintenances, hotelConfig } = usePms();
  // v2.2.1 #10: Keep active room types plus any inactive room type still referenced by active rooms
  const roomTypes = useMemo(() => {
    const usedIds = new Set(rooms.map((r) => r.roomTypeId));
    return allRoomTypes.filter((rt) => rt.isActive !== false || usedIds.has(rt.id));
  }, [allRoomTypes, rooms]);
  const [checkIn, setCheckIn] = useState(todayISO());
  const [checkOut, setCheckOut] = useState(addDays(todayISO(), 2));
  const [rows, setRows] = useState<SearchRow[]>(() => [
    { id: 'row_1', roomTypeId: roomTypes[0]?.id || '', quantity: 1 },
  ]);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);

  const nights = Math.max(1, diffDays(checkIn, checkOut));

  // Ensure first row has valid roomTypeId when roomTypes load
  const effectiveRows = useMemo(() => {
    if (rows.length === 1 && !rows[0].roomTypeId && roomTypes[0]) {
      return [{ ...rows[0], roomTypeId: roomTypes[0].id }];
    }
    return rows;
  }, [rows, roomTypes]);

  // Determine all available rooms for [checkIn, checkOut) using Zero-Overbooking + Shared Maintenance Check
  const availableRooms = useMemo(() => {
    if (checkOut <= checkIn) return [];
    const blockedRoomIds = new Set<string>();
    const today = todayISO();
    const bufferMinutes = hotelConfig.hourlyCleaningBufferMinutes ?? 5;

    for (const r of rooms) {
      if (
        isRoomBlockedByMaintenance(r.id, maintenances, checkIn, checkOut) ||
        (r.hkStatus === 'maintenance' && checkIn <= today)
      ) {
        blockedRoomIds.add(r.id);
      }
    }

    const candidate = { bookingMode: 'daily' as const, checkIn, checkOut };
    for (const b of bookings) {
      if (!isBookingBlockingCalendar(b.status)) continue;
      if (
        doBookingIntervalsOverlap(
          b,
          candidate,
          hotelConfig.checkInTime || '14:00',
          hotelConfig.checkOutTime || '12:00',
          bufferMinutes
        )
      ) {
        blockedRoomIds.add(b.roomId);
      }
    }

    return rooms.filter((r) => !blockedRoomIds.has(r.id));
  }, [rooms, bookings, maintenances, hotelConfig, checkIn, checkOut]);

  const availableByType = useMemo(() => {
    const map = new Map<string, Room[]>();
    for (const r of availableRooms) {
      const arr = map.get(r.roomTypeId) || [];
      arr.push(r);
      map.set(r.roomTypeId, arr);
    }
    return map;
  }, [availableRooms]);

  const toggleRoom = (roomId: string) => {
    setSelectedRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  };

  const addSearchRow = () => {
    const unusedType = roomTypes.find((rt) => !effectiveRows.some((r) => r.roomTypeId === rt.id));
    setRows([
      ...effectiveRows,
      {
        id: `row_${Date.now()}`,
        roomTypeId: unusedType?.id || roomTypes[0]?.id || '',
        quantity: 1,
      },
    ]);
  };

  const updateRow = (id: string, patch: Partial<SearchRow>) => {
    setRows(effectiveRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => {
    if (effectiveRows.length <= 1) return;
    setRows(effectiveRows.filter((r) => r.id !== id));
  };

  const selectedRooms = useMemo(
    () => availableRooms.filter((r) => selectedRoomIds.includes(r.id)),
    [availableRooms, selectedRoomIds]
  );

  const handleProceedCreate = () => {
    if (selectedRooms.length === 0) return;
    if (selectedRooms.length === 1) {
      onCreateSingleBooking({ room: selectedRooms[0], checkIn, checkOut });
    } else {
      onCreateGroupBooking({ rooms: selectedRooms, checkIn, checkOut });
    }
  };

  const getDefaultPrice = (roomTypeId: string) => {
    const rt = roomTypes.find((t) => t.id === roomTypeId);
    const tier = rt?.priceTiers.find((p) => p.isDefault) || rt?.priceTiers[0];
    return tier?.price || 0;
  };

  return (
    <div className="space-y-5">
      {/* Search Criteria Card */}
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-[#1C1B18]">
              Tìm phòng trống theo loại phòng & số lượng
            </h2>
            <p className="text-[13px] text-[#57534E]">
              Kiểm tra chống trùng lịch tự động, đánh giá đủ/thiếu phòng và tạo đơn 1 chạm cho các phòng đã chọn
            </p>
          </div>
          <div className="text-[13px] font-mono-num text-[#1B5E4B] bg-[#E8F2EE] px-3 py-1.5 rounded-lg font-medium">
            Tổng trống toàn khách sạn: {availableRooms.length} / {rooms.length} phòng
          </div>
        </div>

        {/* Date range (dd/mm/YYYY) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div>
            <label className="block text-[12px] font-medium text-[#57534E] mb-1">
              Từ ngày (Nhận phòng)
            </label>
            <DateInputVN
              value={checkIn}
              onChange={(val) => {
                setCheckIn(val);
                if (val >= checkOut) setCheckOut(addDays(val, 1));
                setSelectedRoomIds([]);
              }}
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#57534E] mb-1">
              Đến ngày (Trả phòng)
            </label>
            <DateInputVN
              value={checkOut}
              min={addDays(checkIn, 1)}
              onChange={(val) => {
                setCheckOut(val);
                setSelectedRoomIds([]);
              }}
            />
          </div>

          <div className="flex items-end">
            <div className="w-full h-9 px-3 rounded-lg bg-[#E8F2EE] border border-[#1B5E4B]/25 flex items-center justify-between text-[13px]">
              <span className="text-[#1B5E4B]">Thời gian ở</span>
              <span className="font-mono-num font-semibold text-[#1B5E4B]">
                {nights} đêm / {nights} ngày
              </span>
            </div>
          </div>
        </div>

        {/* Requested room types & quantities */}
        <div className="space-y-2 pt-2 border-t border-[#E5E2DC]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#57534E]">
              Nhu cầu loại phòng & số lượng
            </span>
            <button
              type="button"
              onClick={addSearchRow}
              className="text-[12px] font-medium text-[#1B5E4B] hover:text-[#144839] inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
              Thêm loại phòng
            </button>
          </div>

          {effectiveRows.map((row) => (
            <div key={row.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
              <select
                value={row.roomTypeId}
                onChange={(e) => updateRow(row.id, { roomTypeId: e.target.value })}
                className="flex-1 min-w-[200px] h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] focus:outline-none focus:border-[#1B5E4B]"
              >
                {roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.isActive === false ? `${rt.name} (Ngừng SD)` : rt.name} ({formatCurrency(getDefaultPrice(rt.id))}/đêm)
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[#57534E]">Cần:</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={row.quantity}
                  onChange={(e) =>
                    updateRow(row.id, { quantity: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="w-20 h-9 px-2.5 text-center font-mono-num rounded-lg border border-[#E5E2DC] text-[13px] focus:outline-none focus:border-[#1B5E4B]"
                />
                <span className="text-[12px] text-[#57534E]">phòng</span>
              </div>

              {effectiveRows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="h-9 w-9 rounded-lg border border-[#E5E2DC] text-[#8A847C] hover:text-[#B91C1C] hover:border-[#FECACA] flex items-center justify-center transition-colors"
                  title="Xóa dòng"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Results per requested room type */}
      <div className="space-y-4 pb-20">
        {effectiveRows.map((row) => {
          const rt = roomTypes.find((t) => t.id === row.roomTypeId);
          if (!rt) return null;
          const matching = availableByType.get(rt.id) || [];
          const isEnough = matching.length >= row.quantity;
          const shortage = Math.max(0, row.quantity - matching.length);
          const defaultPrice = getDefaultPrice(rt.id);
          const alternativeRooms = !isEnough
            ? availableRooms.filter((r) => r.roomTypeId !== rt.id)
            : [];

          return (
            <div key={row.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-[15px] font-semibold text-[#1C1B18]">{rt.name}</h3>
                  <p className="text-[12px] text-[#57534E] font-mono-num">
                    Giá mặc định: {formatCurrency(defaultPrice)}/đêm • Dự kiến {nights} đêm:{' '}
                    {formatCurrency(defaultPrice * nights)}/phòng
                  </p>
                </div>

                {isEnough ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] text-[12px] font-medium">
                    <CheckCircle2 className="w-4 h-4" strokeWidth={1.5} />
                    Còn trống {matching.length} phòng / Cần {row.quantity} phòng (Đủ phòng)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-[12px] font-medium">
                    <AlertTriangle className="w-4 h-4" strokeWidth={1.5} />
                    Chỉ còn {matching.length} phòng / Cần {row.quantity} phòng (Thiếu {shortage}{' '}
                    phòng)
                  </span>
                )}
              </div>

              {matching.length === 0 ? (
                <p className="text-[13px] text-[#8A847C] py-2">
                  Không còn phòng trống thuộc loại này trong khoảng ngày đã chọn.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {matching.map((room) => {
                    const checked = selectedRoomIds.includes(room.id);
                    return (
                      <button
                        key={room.id}
                        type="button"
                        onClick={() => toggleRoom(room.id)}
                        className={`text-left p-3 rounded-xl border transition-colors flex items-start justify-between gap-2 ${
                          checked
                            ? 'border-[#1B5E4B] bg-[#E8F2EE]/60'
                            : 'border-[#E5E2DC] bg-white hover:bg-[#FAF9F6]'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono-num font-semibold text-[14px] text-[#1C1B18]">
                              P.{room.roomNumber}
                            </span>
                            <span className="text-[11px] text-[#57534E]">{room.floor}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                room.hkStatus === 'clean' ? 'bg-[#15803D]' : 'bg-[#B45309]'
                              }`}
                            />
                            <span className="text-[#57534E]">{getHkStatusLabel(room.hkStatus)}</span>
                          </div>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
                            checked
                              ? 'bg-[#1B5E4B] border-[#1B5E4B] text-white'
                              : 'border-[#D0CBC2] bg-white'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" strokeWidth={2} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Suggestions when shortage */}
              {!isEnough && alternativeRooms.length > 0 && (
                <div className="pt-3 border-t border-[#E5E2DC]">
                  <p className="text-[12px] font-medium text-[#92400E] mb-2">
                    Gợi ý phòng trống thuộc loại khác trong cùng khoảng ngày để tư vấn bổ sung:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {alternativeRooms.slice(0, 8).map((room) => {
                      const checked = selectedRoomIds.includes(room.id);
                      return (
                        <button
                          key={room.id}
                          type="button"
                          onClick={() => toggleRoom(room.id)}
                          className={`px-3 py-1.5 rounded-lg border text-[12px] transition-colors inline-flex items-center gap-2 ${
                            checked
                              ? 'border-[#1B5E4B] bg-[#E8F2EE] text-[#1B5E4B] font-medium'
                              : 'border-[#E5E2DC] bg-[#FAF9F6] text-[#1C1B18] hover:bg-white'
                          }`}
                        >
                          <span className="font-mono-num font-semibold">P.{room.roomNumber}</span>
                          <span className="text-[#57534E]">{room.roomTypeName}</span>
                          <span className="font-mono-num text-[#1B5E4B]">
                            {formatCurrency(getDefaultPrice(room.roomTypeId))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Bottom Action Bar */}
      {selectedRooms.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-2xl bg-[#1C1B18] text-white rounded-2xl px-5 py-3.5 shadow-lg flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium">
              Đã chọn {selectedRooms.length} phòng ({nights} đêm):{' '}
              <span className="font-mono-num text-[#A7F3D0]">
                {selectedRooms.map((r) => `P.${r.roomNumber}`).join(', ')}
              </span>
            </div>
            <div className="text-[12px] text-[#A8A29E]">
              {selectedRooms.length === 1
                ? 'Sẽ mở biểu mẫu đặt phòng lẻ điền sẵn thông tin'
                : 'Sẽ mở biểu mẫu đặt phòng khách đoàn / nhóm gán sẵn danh sách phòng'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedRoomIds([])}
              className="h-9 px-3 rounded-lg border border-white/20 hover:bg-white/10 text-[13px] transition-colors"
            >
              Bỏ chọn
            </button>
            <button
              type="button"
              onClick={handleProceedCreate}
              className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium inline-flex items-center gap-2 transition-colors"
            >
              <Search className="w-4 h-4" strokeWidth={1.5} />
              Tạo đặt phòng cho {selectedRooms.length} phòng đã chọn
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
