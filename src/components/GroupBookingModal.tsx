import React, { useState } from 'react';
import { Plus, Trash2, Users, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, DailyRate, PaymentMethod, Room } from '../types/pms';
import {
  addDays,
  buildDailyRates,
  diffDays,
  formatCurrency,
  isBookingBlockingCalendar,
  sumDailyRates,
  todayISO,
} from '../lib/utils';
import { doBookingIntervalsOverlap, isRoomBlockedByMaintenance } from '../lib/revenueMetrics';
import { createGroupBooking } from '../lib/pmsActions';
import { DateInputVN } from './DateInputVN';

interface GroupRoomDraft {
  roomId: string;
  checkIn: string;
  checkOut: string;
  dailyRates: DailyRate[];
}

interface GroupBookingModalProps {
  initialRooms?: Room[];
  initialCheckIn?: string;
  initialCheckOut?: string;
  onClose: () => void;
}

export const GroupBookingModal: React.FC<GroupBookingModalProps> = ({
  initialRooms = [],
  initialCheckIn,
  initialCheckOut,
  onClose,
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
    notify,
  } = usePms();

  const startIn = initialCheckIn || todayISO();
  const startOut = initialCheckOut || addDays(startIn, 2);

  const getDefaultRateForRoom = (roomId: string) => {
    const r = activeRooms.find((rm) => rm.id === roomId);
    const rt = roomTypes.find((t) => t.id === r?.roomTypeId);
    return rt?.priceTiers.find((p) => p.isDefault)?.price || rt?.priceTiers[0]?.price || 350000;
  };

  const [groupName, setGroupName] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [leaderPhone, setLeaderPhone] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    activeBookingSources.find((s) => s.id === 'src_corporate')?.id ||
      activeBookingSources[0]?.id ||
      'src_walk_in'
  );
  const [guestCategory, setGuestCategory] = useState<'vietnamese' | 'foreigner'>('vietnamese');
  const [billingMode, setBillingMode] = useState<'master' | 'split'>('master');
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>('bank_transfer');
  const [note, setNote] = useState('');

  const selectedSourceCfg = activeBookingSources.find((s) => s.id === selectedSourceId);
  const isOtaSource = selectedSourceCfg?.kind === 'ota';

  const [drafts, setDrafts] = useState<GroupRoomDraft[]>(() => {
    const seed = initialRooms.length > 0 ? initialRooms : activeRooms.slice(0, 2);
    return seed.map((r) => ({
      roomId: r.id,
      checkIn: startIn,
      checkOut: startOut,
      dailyRates: buildDailyRates(startIn, startOut, getDefaultRateForRoom(r.id)),
    }));
  });

  const [submitting, setSubmitting] = useState(false);

  const addDraftRoom = () => {
    const usedIds = new Set(drafts.map((d) => d.roomId));
    const nextRoom = activeRooms.find((r) => !usedIds.has(r.id)) || activeRooms[0];
    if (!nextRoom) return;
    setDrafts([
      ...drafts,
      {
        roomId: nextRoom.id,
        checkIn: startIn,
        checkOut: startOut,
        dailyRates: buildDailyRates(startIn, startOut, getDefaultRateForRoom(nextRoom.id)),
      },
    ]);
  };

  const updateDraft = (idx: number, patch: Partial<GroupRoomDraft>) => {
    setDrafts((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const merged = { ...item, ...patch };
        if (patch.roomId || patch.checkIn || patch.checkOut) {
          const rate = patch.roomId
            ? getDefaultRateForRoom(patch.roomId)
            : item.dailyRates[0]?.rate || getDefaultRateForRoom(merged.roomId);
          merged.dailyRates = buildDailyRates(merged.checkIn, merged.checkOut, rate);
        }
        return merged;
      })
    );
  };

  const updateDraftRatePerNight = (idx: number, ratePerNight: number) => {
    setDrafts((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              dailyRates: item.dailyRates.map((d) => ({ ...d, rate: Math.max(0, ratePerNight) })),
            }
          : item
      )
    );
  };

  const removeDraft = (idx: number) => {
    if (drafts.length <= 1) return;
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const grandTotal = drafts.reduce((sum, d) => sum + sumDailyRates(d.dailyRates), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaderName.trim()) return;

    const seen = new Set<string>();
    const resolvedItems: Array<{
      room: Room;
      checkIn: string;
      checkOut: string;
      dailyRates: DailyRate[];
    }> = [];

    for (const d of drafts) {
      if (d.checkOut <= d.checkIn) {
        notify('Mỗi phòng trong đoàn phải có ngày trả sau ngày nhận ít nhất 1 đêm', 'error');
        return;
      }
      if (seen.has(d.roomId)) {
        notify('Danh sách phòng trong đoàn bị chọn trùng số phòng', 'error');
        return;
      }
      seen.add(d.roomId);
      const room = activeRooms.find((r) => r.id === d.roomId);
      if (!room) continue;
      if (
        isRoomBlockedByMaintenance(room.id, maintenances, d.checkIn, d.checkOut) ||
        (room.hkStatus === 'maintenance' && d.checkIn <= todayISO())
      ) {
        notify(`P.${room.roomNumber} đang trong lịch bảo trì vào khoảng ngày đã chọn`, 'error');
        return;
      }
      const conflict = bookings.find(
        (b) =>
          b.roomId === room.id &&
          isBookingBlockingCalendar(b.status) &&
          doBookingIntervalsOverlap(
            b,
            { bookingMode: 'daily', checkIn: d.checkIn, checkOut: d.checkOut },
            hotelConfig.checkInTime || '14:00',
            hotelConfig.checkOutTime || '12:00',
            hotelConfig.hourlyCleaningBufferMinutes ?? 5
          )
      );
      if (conflict) {
        notify(`P.${room.roomNumber} bị trùng lịch với đơn ${conflict.bookingCode}`, 'error');
        return;
      }
      resolvedItems.push({ room, checkIn: d.checkIn, checkOut: d.checkOut, dailyRates: d.dailyRates });
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
      : 'group';

    setSubmitting(true);
    try {
      const res = await createGroupBooking(
        {
          groupName: groupName.trim() || `Đoàn ${leaderName.trim()}`,
          leaderName,
          leaderPhone,
          guestCategory,
          source: mappedSource,
          sourceLabel: selectedSourceCfg?.name || 'Khách đoàn',
          otaChannel: isOtaSource ? selectedSourceCfg?.name || 'OTA' : null,
          billingMode,
          depositAmount,
          depositMethod,
          accountingLockDate: hotelConfig.accountingLockDate,
          note,
          roomItems: resolvedItems,
        },
        guests,
        actor
      );
      notify(`Đã tạo đoàn ${res.group.groupCode} gồm ${res.bookings.length} phòng`);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi tạo khách đoàn', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 z-10 bg-white border-b border-[#E5E2DC] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#0F5132]" strokeWidth={1.5} />
            <div>
              <h2 className="text-[16px] font-semibold text-[#1C1B18]">
                Đặt phòng Khách đoàn / Nhóm nhiều phòng
              </h2>
              <p className="text-[12px] text-[#57534E]">
                Chỉ cần thông tin Trưởng đoàn • Hỗ trợ mỗi phòng nhận/trả khác ngày (dd/mm/YYYY)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#F1EFEA] flex items-center justify-center text-[#57534E]"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Tên đoàn / Nhóm
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Đoàn Gia đình Anh Minh"
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Họ tên Trưởng đoàn *
              </label>
              <input
                type="text"
                required
                value={leaderName}
                onChange={(e) => setLeaderName(e.target.value)}
                placeholder="Trần Quang Minh"
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                SĐT Trưởng đoàn
              </label>
              <input
                type="tel"
                value={leaderPhone}
                onChange={(e) => setLeaderPhone(e.target.value)}
                placeholder="0912 345 678"
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px] font-mono-num"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Nguồn đặt phòng
              </label>
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-[#E7E3DA] bg-white text-[13px] focus:outline-none focus:border-[#0F5132]"
              >
                {activeBookingSources.map((src) => (
                  <option key={src.id} value={src.id}>
                    {src.name}
                    {src.kind === 'ota' ? ' (OTA)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Phân loại khách
              </label>
              <select
                value={guestCategory}
                onChange={(e) => setGuestCategory(e.target.value as 'vietnamese' | 'foreigner')}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="vietnamese">Khách Việt Nam</option>
                <option value="foreigner">Khách nước ngoài</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Chế độ hóa đơn
              </label>
              <select
                value={billingMode}
                onChange={(e) => setBillingMode(e.target.value as 'master' | 'split')}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="master">Thanh toán gộp (Trưởng đoàn)</option>
                <option value="split">Tách riêng từng phòng</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Tiền cọc đoàn
              </label>
              <input
                type="number"
                min={0}
                step={100000}
                value={depositAmount}
                onChange={(e) => setDepositAmount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px] font-mono-num"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#57534E] mb-1">
                Hình thức thanh toán
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
          </div>

          <div className="space-y-2.5 pt-2 border-t border-[#E5E2DC]">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[#1C1B18]">
                Danh sách phòng trong đoàn ({drafts.length} phòng)
              </h3>
              <button
                type="button"
                onClick={addDraftRoom}
                className="h-8 px-3 rounded-lg border border-[#E7E3DA] hover:bg-[#FAF9F6] text-[12px] font-medium text-[#0F5132] inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                Thêm phòng
              </button>
            </div>

            <div className="space-y-2">
              {drafts.map((d, idx) => {
                const subtotal = sumDailyRates(d.dailyRates);
                const avgNight = d.dailyRates[0]?.rate || 0;
                const nights = Math.max(1, diffDays(d.checkIn, d.checkOut));
                return (
                  <div
                    key={`${d.roomId}_${idx}`}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center p-3 rounded-xl border border-[#E5E2DC] bg-[#FAF9F6]"
                  >
                    <div className="md:col-span-3">
                      <select
                        value={d.roomId}
                        onChange={(e) => updateDraft(idx, { roomId: e.target.value })}
                        className="w-full h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                      >
                        {activeRooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            P.{r.roomNumber} — {r.roomTypeName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <DateInputVN
                        value={d.checkIn}
                        onChange={(v) =>
                          updateDraft(idx, {
                            checkIn: v,
                            checkOut: v >= d.checkOut ? addDays(v, 1) : d.checkOut,
                          })
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <DateInputVN
                        value={d.checkOut}
                        min={addDays(d.checkIn, 1)}
                        onChange={(v) => updateDraft(idx, { checkOut: v })}
                      />
                    </div>
                    <div className="md:col-span-1 text-center text-[11px] font-mono-num font-semibold text-[#0F5132]">
                      {nights}đ
                    </div>
                    <div className="md:col-span-2">
                      <input
                        type="number"
                        min={0}
                        step={10000}
                        value={avgNight}
                        onChange={(e) => updateDraftRatePerNight(idx, Number(e.target.value) || 0)}
                        className="w-full h-9 px-2 text-right rounded-lg border border-[#E7E3DA] bg-white text-[12px] font-mono-num"
                        title="Đơn giá mỗi đêm"
                      />
                    </div>
                    <div className="md:col-span-2 flex items-center justify-between gap-2">
                      <span className="text-[12px] font-mono-num font-semibold text-[#0F5132]">
                        {formatCurrency(subtotal)}
                      </span>
                      {drafts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeDraft(idx)}
                          className="p-1.5 rounded-md text-[#8A847C] hover:text-[#B91C1C]"
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#57534E] mb-1">
              Ghi chú khách đoàn
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Yêu cầu sắp phòng gần nhau, hóa đơn công ty..."
              className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#E5E2DC]">
            <div className="text-[13px]">
              Tổng tiền phòng dự kiến:{' '}
              <span className="text-[16px] font-semibold font-mono-num text-[#0F5132]">
                {formatCurrency(grandTotal)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg border border-[#E7E3DA] text-[13px] font-medium text-[#57534E]"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="h-9 px-5 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-50 text-white text-[13px] font-medium"
              >
                {submitting ? 'Đang tạo đoàn...' : `Tạo đoàn (${drafts.length} phòng)`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
