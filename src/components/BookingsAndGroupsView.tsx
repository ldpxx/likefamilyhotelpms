import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  Download,
  Globe,
  LogIn,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking } from '../types/pms';
import {
  formatCurrency,
  formatDateVN,
  getBookingGuestBalance,
  getCancellationTypeLabel,
  getSourceLabel,
  getStatusLabel,
  isLoyalGuest,
  normalizePhone,
  normalizeVietnamese,
} from '../lib/utils';
import { bulkCheckInGroup, markOccupantAsmDeclared } from '../lib/pmsActions';
import { exportAsmForeignerCsv } from '../lib/backupExport';
import { CancelBookingModal } from './CancelBookingModal';
import { DepositResolutionModal } from './DepositResolutionModal';

interface BookingsAndGroupsViewProps {
  onSelectBooking: (booking: Booking) => void;
  onOpenNewSingle: () => void;
  onOpenNewGroup: () => void;
}

export const BookingsAndGroupsView: React.FC<BookingsAndGroupsViewProps> = ({
  onSelectBooking,
  onOpenNewSingle,
  onOpenNewGroup,
}) => {
  const { bookings, groups, guests, actor, notify } = usePms();
  const [subTab, setSubTab] = useState<'bookings' | 'groups' | 'asm_guests'>('bookings');

  // Single-box diacritic-insensitive search + multi filters
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [onlyAsmAlert, setOnlyAsmAlert] = useState(false);

  // Guest / ASM filters
  const [guestSearch, setGuestSearch] = useState('');
  const [asmOnlyPending, setAsmOnlyPending] = useState(false);

  // Partial Group Cancel & Pending Deposit modals
  const [partialCancelScope, setPartialCancelScope] = useState<Booking[] | null>(null);
  const [resolveDepositBooking, setResolveDepositBooking] = useState<Booking | null>(null);

  const filteredBookings = useMemo(() => {
    const qNorm = normalizeVietnamese(searchText);
    const qDigits = normalizePhone(searchText);

    return bookings.filter((b) => {
      if (statusFilter === 'pending_deposit') {
        if (b.depositResolutionStatus !== 'pending_deposit_resolution') return false;
      } else if (statusFilter !== 'all' && b.status !== statusFilter) {
        return false;
      }
      if (sourceFilter !== 'all') {
        if (sourceFilter === 'ota' && b.source !== 'ota') return false;
        if (sourceFilter !== 'ota' && b.source !== sourceFilter) return false;
      }
      if (onlyAsmAlert && !b.hasPendingAsm && !b.hasStayPermitAlert) return false;

      if (qNorm) {
        const haystacks = [
          b.bookingCode,
          b.roomNumber,
          b.primaryGuestName,
          b.primaryGuestNormalizedName,
          b.primaryGuestPhone,
          b.primaryGuestIdNumber,
          b.otaBookingRef || '',
          b.groupName || '',
          ...(b.occupants || []).flatMap((o) => [
            o.fullName,
            o.phone,
            o.idNumber,
            o.visaNumber || '',
          ]),
        ];
        const matched = haystacks.some((h) => {
          const hn = normalizeVietnamese(h);
          if (hn.includes(qNorm)) return true;
          if (qDigits.length >= 4 && normalizePhone(h).includes(qDigits)) return true;
          return false;
        });
        if (!matched) return false;
      }
      return true;
    });
  }, [bookings, searchText, statusFilter, sourceFilter, onlyAsmAlert]);

  // Foreign occupants across active stays for ASM declaration workflow
  const foreignerStays = useMemo(() => {
    const list: Array<{ booking: Booking; occ: Booking['occupants'][number] }> = [];
    for (const b of bookings) {
      if (b.status !== 'in_house' && b.status !== 'reserved') continue;
      for (const occ of b.occupants || []) {
        if (occ.guestCategory !== 'foreigner') continue;
        if (asmOnlyPending && occ.asmStatus === 'declared_asm') continue;
        list.push({ booking: b, occ });
      }
    }
    return list;
  }, [bookings, asmOnlyPending]);

  const filteredGuests = useMemo(() => {
    const qNorm = normalizeVietnamese(guestSearch);
    const qDigits = normalizePhone(guestSearch);
    if (!qNorm) return guests.slice(0, 80);
    return guests.filter((g) => {
      return (
        g.normalizedName.includes(qNorm) ||
        (qDigits.length >= 4 && g.normalizedPhone.includes(qDigits)) ||
        (g.idNumber || '').toLowerCase().includes(qNorm)
      );
    });
  }, [guests, guestSearch]);

  const handleBulkCheckIn = async (groupId: string, groupName: string) => {
    const groupBookings = bookings.filter((b) => b.groupId === groupId && b.status === 'reserved');
    if (groupBookings.length === 0) {
      notify('Tất cả phòng trong đoàn đã nhận phòng hoặc không ở trạng thái Đặt trước', 'info');
      return;
    }
    const count = await bulkCheckInGroup(groupBookings, actor);
    notify(`Đã Check-in hàng loạt ${count} phòng cho ${groupName}`);
  };

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-[#EAE7E0]">
          {[
            { id: 'bookings', label: `Đơn đặt phòng (${bookings.length})` },
            { id: 'groups', label: `Khách đoàn (${groups.length})` },
            {
              id: 'asm_guests',
              label: `Hồ sơ Khách & ASM (${foreignerStays.filter((x) => x.occ.asmStatus === 'pending_asm').length} chờ ASM)`,
            },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id as typeof subTab)}
              className={`h-8 px-3.5 rounded-lg text-[13px] font-medium transition-colors ${
                subTab === t.id ? 'bg-white text-[#1C1B18] shadow-xs' : 'text-[#57534E]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenNewGroup}
            className="h-9 px-3.5 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#FAF9F6] text-[13px] font-medium text-[#1C1B18] inline-flex items-center gap-1.5"
          >
            <Users className="w-4 h-4" strokeWidth={1.5} />
            Đặt khách đoàn
          </button>
          <button
            type="button"
            onClick={onOpenNewSingle}
            className="h-9 px-3.5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" strokeWidth={1.5} />
            Đặt phòng lẻ
          </button>
        </div>
      </div>

      {/* TAB 1: ALL BOOKINGS */}
      {subTab === 'bookings' && (
        <div className="space-y-3">
          <div className="bg-white border border-[#E5E2DC] rounded-xl p-3 flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-[#8A847C] absolute left-3 top-2.5" strokeWidth={1.5} />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Tìm 1 ô không dấu/có dấu: Tên khách, SĐT, CCCD/Passport, Mã đơn, Số phòng..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#E5E2DC] text-[13px] focus:outline-none focus:border-[#1B5E4B]"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
            >
              <option value="all">Mọi trạng thái</option>
              <option value="reserved">Đặt trước</option>
              <option value="in_house">Đang lưu trú</option>
              <option value="checked_out">Đã trả phòng</option>
              <option value="transferred">Đã chuyển phòng</option>
              <option value="cancelled">Khách báo hủy / Đã hủy</option>
              <option value="no_show">Không đến (No-show)</option>
              <option value="pending_deposit">Cọc treo chờ xử lý</option>
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
            >
              <option value="all">Mọi nguồn</option>
              <option value="walk_in">Khách lẻ tại quầy</option>
              <option value="zalo">Zalo</option>
              <option value="phone">Điện thoại</option>
              <option value="ota">Kênh OTA</option>
              <option value="group">Khách đoàn</option>
            </select>

            <label className="inline-flex items-center gap-1.5 text-[12px] text-[#57534E] px-2 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyAsmAlert}
                onChange={(e) => setOnlyAsmAlert(e.target.checked)}
                className="accent-[#1B5E4B]"
              />
              Chỉ đơn cảnh báo ASM / Hạn lưu trú
            </label>
          </div>

          <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-x-auto">
            <table className="w-full text-[13px] min-w-[820px]">
              <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E] text-[12px]">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Mã đơn / Phòng</th>
                  <th className="text-left px-4 py-2.5 font-medium">Khách hàng</th>
                  <th className="text-left px-4 py-2.5 font-medium">Lưu trú</th>
                  <th className="text-left px-4 py-2.5 font-medium">Nguồn</th>
                  <th className="text-right px-4 py-2.5 font-medium">Tổng tiền</th>
                  <th className="text-right px-4 py-2.5 font-medium">Còn thiếu</th>
                  <th className="text-left px-4 py-2.5 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EFEA]">
                {filteredBookings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[#8A847C]">
                      Không tìm thấy đơn đặt phòng nào khớp điều kiện lọc.
                    </td>
                  </tr>
                ) : (
                  filteredBookings.map((b) => {
                    const balance = getBookingGuestBalance(b);
                    return (
                      <tr
                        key={b.id}
                        onClick={() => onSelectBooking(b)}
                        className="hover:bg-[#FAF9F6] cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono-num font-semibold text-[#1B5E4B]">
                            P.{b.roomNumber}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#8A847C]">
                            {b.bookingCode}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#1C1B18] flex flex-wrap items-center gap-1.5">
                            {b.primaryGuestName}
                            {(isLoyalGuest(b.guestStayCount) || b.isReturningGuest) && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] font-semibold">
                                <Award className="w-3 h-3" strokeWidth={1.5} />
                                Khách hàng thân quen
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#57534E]">
                            {b.primaryGuestPhone || '—'} • {b.occupantCount} khách
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-num text-[12px]">
                          {b.bookingMode === 'hourly' ? (
                            <div>
                              <span className="inline-flex items-center gap-1 text-[#1D4ED8] font-medium">
                                <Clock className="w-3 h-3" strokeWidth={1.5} />
                                {formatDateVN(b.checkIn)} ({b.hourlyHours || 1} giờ)
                              </span>
                              <div className="text-[11px] text-[#8A847C]">
                                {b.checkInTime || ''} → {b.checkOutTime || ''}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div>
                                {formatDateVN(b.checkIn)} → {formatDateVN(b.checkOut)}
                              </div>
                              <div className="text-[11px] text-[#8A847C]">
                                {b.nights} đêm / {b.nights} ngày
                              </div>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[12px]">
                          <div>{getSourceLabel(b.source, b.otaChannel, b.sourceLabel)}</div>
                          {b.groupName && (
                            <div className="text-[11px] text-[#1D4ED8]">{b.groupName}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num font-medium">
                          {formatCurrency(
                            b.grossRoomTotal + (b.serviceTotal || 0) + (b.hourlySurcharge || 0)
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num">
                          <span className={balance > 0 ? 'text-[#B45309] font-medium' : 'text-[#15803D]'}>
                            {formatCurrency(Math.max(0, balance))}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                                b.status === 'no_show'
                                  ? 'bg-[#FFFBEB] text-[#92400E]'
                                  : b.status === 'cancelled'
                                  ? 'bg-[#FEF2F2] text-[#991B1B]'
                                  : 'bg-[#F1EFEA] text-[#1C1B18]'
                              }`}
                            >
                              {b.status === 'cancelled' && b.cancellationType
                                ? getCancellationTypeLabel(b.cancellationType)
                                : getStatusLabel(b.status)}
                            </span>
                            {b.depositResolutionStatus === 'pending_deposit_resolution' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setResolveDepositBooking(b);
                                }}
                                className="px-1.5 py-0.5 rounded bg-[#FEF3C7] border border-[#F59E0B] text-[#92400E] text-[10px] font-semibold"
                              >
                                Cọc treo: {formatCurrency(b.pendingDepositAmount)}
                              </button>
                            )}
                            {b.hasStayPermitAlert && (
                              <span className="px-1.5 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] text-[10px] font-medium inline-flex items-center gap-0.5">
                                <AlertTriangle className="w-3 h-3" strokeWidth={1.5} /> Hạn VN
                              </span>
                            )}
                            {b.hasPendingAsm && (
                              <span className="px-1.5 py-0.5 rounded bg-[#FFFBEB] text-[#92400E] text-[10px] font-medium">
                                Chờ ASM
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: GROUPS */}
      {subTab === 'groups' && (
        <div className="space-y-3">
          {groups.length === 0 ? (
            <div className="bg-white border border-[#E5E2DC] rounded-2xl p-10 text-center text-[13px] text-[#8A847C]">
              Chưa có hồ sơ khách đoàn nào. Bấm "Đặt khách đoàn" hoặc chọn nhiều phòng từ Tìm phòng trống.
            </div>
          ) : (
            groups.map((g) => {
              const gBookings = bookings.filter((b) => b.groupId === g.id);
              const activeGroupBookings = gBookings.filter(
                (b) => b.status === 'reserved' || b.status === 'in_house'
              );
              const totalGross = gBookings
                .filter((b) => b.status !== 'cancelled' && b.status !== 'no_show')
                .reduce(
                  (s, b) => s + b.grossRoomTotal + (b.serviceTotal || 0) + (b.hourlySurcharge || 0),
                  0
                );
              const totalPaid = gBookings.reduce(
                (s, b) => s + (b.depositPaid || 0) + (b.guestPaid || 0),
                0
              );
              const reservedCount = gBookings.filter((b) => b.status === 'reserved').length;

              return (
                <div key={g.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono-num text-[12px] px-2 py-0.5 rounded bg-[#E8F2EE] text-[#1B5E4B] font-semibold">
                          {g.groupCode}
                        </span>
                        <h3 className="text-[15px] font-semibold text-[#1C1B18]">{g.groupName}</h3>
                      </div>
                      <p className="text-[12px] text-[#57534E] mt-0.5">
                        Trưởng đoàn: {g.leaderName} ({g.leaderPhone || '—'}) • {gBookings.length}{' '}
                        phòng • Thanh toán:{' '}
                        {g.billingMode === 'master' ? 'Gộp hóa đơn đoàn' : 'Tách từng phòng'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right font-mono-num text-[12px]">
                        <div>
                          Tổng đoàn: <strong>{formatCurrency(totalGross)}</strong>
                        </div>
                        <div className="text-[#15803D]">Đã thu/cọc: {formatCurrency(totalPaid)}</div>
                      </div>
                      {activeGroupBookings.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPartialCancelScope(activeGroupBookings)}
                          className="h-9 px-3 rounded-lg border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] text-[12px] font-medium"
                        >
                          Hủy một phần / phòng
                        </button>
                      )}
                      {reservedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => handleBulkCheckIn(g.id, g.groupName)}
                          className="h-9 px-3.5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[12px] font-medium inline-flex items-center gap-1.5"
                        >
                          <LogIn className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Check-in cả đoàn ({reservedCount})
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {gBookings.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onSelectBooking(b)}
                        className="text-left p-3 rounded-xl border border-[#E5E2DC] hover:border-[#1B5E4B] bg-[#FAF9F6] transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono-num font-semibold text-[13px] text-[#1C1B18]">
                            P.{b.roomNumber}
                          </span>
                          <span className="text-[11px] text-[#57534E]">{getStatusLabel(b.status)}</span>
                        </div>
                        <div className="text-[11px] font-mono-num text-[#57534E] mt-1">
                          {formatDateVN(b.checkIn)} → {formatDateVN(b.checkOut)} ({b.nights}đ)
                        </div>
                        <div className="text-[12px] font-mono-num font-medium text-[#1B5E4B] mt-0.5">
                          {formatCurrency(b.grossRoomTotal)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: ASM FOREIGNER TRACKING & REPEAT GUESTS */}
      {subTab === 'asm_guests' && (
        <div className="space-y-5">
          {/* Foreigners & ASM Immigration Table */}
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                  Theo dõi Khai báo Tạm trú ASM (Khách nước ngoài)
                </h3>
                <p className="text-[12px] text-[#57534E]">
                  Kiểm soát hạn tạm trú theo Dấu nhập cảnh và đánh dấu trạng thái đã khai báo trên
                  cổng xuất nhập cảnh ASM
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-[12px] text-[#57534E] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={asmOnlyPending}
                    onChange={(e) => setAsmOnlyPending(e.target.checked)}
                    className="accent-[#1B5E4B]"
                  />
                  Chỉ hiện chưa khai ASM
                </label>
                <button
                  type="button"
                  onClick={() => exportAsmForeignerCsv(bookings)}
                  className="h-8 px-3 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] font-medium inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Xuất Excel khai báo ASM
                </button>
              </div>
            </div>

            {foreignerStays.length === 0 ? (
              <p className="text-[13px] text-[#8A847C] py-4">
                Hiện không có khách nước ngoài nào trong danh sách lọc.
              </p>
            ) : (
              <div className="overflow-x-auto border border-[#E5E2DC] rounded-xl">
                <table className="w-full text-[12px]">
                  <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Phòng</th>
                      <th className="text-left px-3 py-2 font-medium">Họ tên / Quốc tịch</th>
                      <th className="text-left px-3 py-2 font-medium">Hộ chiếu / Visa</th>
                      <th className="text-left px-3 py-2 font-medium">Nhập cảnh / Hạn lưu trú</th>
                      <th className="text-left px-3 py-2 font-medium">Trạng thái ASM</th>
                      <th className="text-right px-3 py-2 font-medium">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1EFEA]">
                    {foreignerStays.map(({ booking, occ }) => {
                      const overstay =
                        occ.stayPermitExpiryDate && occ.stayPermitExpiryDate < booking.checkOut;
                      return (
                        <tr key={`${booking.id}_${occ.occupantId}`}>
                          <td className="px-3 py-2.5 font-mono-num font-semibold text-[#1B5E4B]">
                            P.{booking.roomNumber}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-[#1C1B18]">{occ.fullName}</div>
                            <div className="text-[11px] text-[#57534E]">
                              {occ.nationality || 'Chưa rõ'} • {occ.dob || '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono-num">
                            <div>PP: {occ.idNumber || '—'}</div>
                            {occ.visaNumber && <div className="text-[11px]">Visa: {occ.visaNumber}</div>}
                          </td>
                          <td className="px-3 py-2.5 font-mono-num">
                            <div>Vào: {formatDateVN(occ.entryDate)}</div>
                            <div className={overstay ? 'text-[#B91C1C] font-semibold' : ''}>
                              Hạn: {formatDateVN(occ.stayPermitExpiryDate)}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {occ.asmStatus === 'declared_asm' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#ECFDF5] text-[#065F46] font-medium">
                                <CheckCircle2 className="w-3 h-3" strokeWidth={1.5} /> Đã khai báo
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FFFBEB] text-[#92400E] font-medium">
                                <Globe className="w-3 h-3" strokeWidth={1.5} /> Yêu cầu khai báo ASM
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                await markOccupantAsmDeclared(
                                  booking,
                                  occ.occupantId,
                                  occ.asmStatus !== 'declared_asm',
                                  actor
                                );
                                notify(`Đã cập nhật trạng thái ASM cho ${occ.fullName}`);
                              }}
                              className="h-7 px-2.5 rounded-lg border border-[#E5E2DC] hover:border-[#1B5E4B] text-[11px] font-medium"
                            >
                              {occ.asmStatus === 'declared_asm' ? 'Chuyển chờ' : 'Đánh dấu đã khai'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Repeat Guest Directory */}
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                Kho Hồ sơ Khách hàng & Khách quay lại ({guests.length})
              </h3>
              <input
                type="text"
                value={guestSearch}
                onChange={(e) => setGuestSearch(e.target.value)}
                placeholder="Tìm tên, SĐT, CCCD..."
                className="h-8 px-3 rounded-lg border border-[#E5E2DC] text-[12px] w-64"
              />
            </div>

            <div className="overflow-x-auto border border-[#E5E2DC] rounded-xl">
              <table className="w-full text-[12px]">
                <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Họ tên</th>
                    <th className="text-left px-3 py-2 font-medium">SĐT</th>
                    <th className="text-left px-3 py-2 font-medium">CCCD / Hộ chiếu</th>
                    <th className="text-left px-3 py-2 font-medium">Quốc tịch</th>
                    <th className="text-right px-3 py-2 font-medium">Số lần lưu trú</th>
                    <th className="text-right px-3 py-2 font-medium">Lần cuối</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1EFEA]">
                  {filteredGuests.map((g) => (
                    <tr key={g.id}>
                      <td className="px-3 py-2 font-medium text-[#1C1B18]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{g.fullName}</span>
                          {isLoyalGuest(g.totalStays) && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] text-[10px] font-semibold">
                              <Award className="w-3 h-3" strokeWidth={1.5} />
                              Khách hàng thân quen
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono-num">{g.phone || '—'}</td>
                      <td className="px-3 py-2 font-mono-num">{g.idNumber || '—'}</td>
                      <td className="px-3 py-2">{g.nationality || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono-num font-semibold text-[#1B5E4B]">
                        {g.totalStays}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num text-[#57534E]">
                        {formatDateVN(g.lastVisitDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {partialCancelScope && (
        <CancelBookingModal
          bookingsScope={partialCancelScope}
          isGroupMode={true}
          onClose={() => setPartialCancelScope(null)}
        />
      )}

      {resolveDepositBooking && (
        <DepositResolutionModal
          booking={resolveDepositBooking}
          onClose={() => setResolveDepositBooking(null)}
        />
      )}
    </div>
  );
};
