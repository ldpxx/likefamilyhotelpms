import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Globe,
  LogIn,
  Merge,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import {
  WALK_IN_DEFAULT_GUEST_ID,
  type Booking,
  type CustomerGroup,
  type Guest,
} from '../types/pms';
import {
  formatCurrency,
  formatDateVN,
  getBookingGuestBalance,
  getCancellationTypeLabel,
  getSourceLabel,
  getStatusLabel,
  normalizePhone,
  normalizeVietnamese,
} from '../lib/utils';
import {
  assignGuestCustomerGroup,
  bulkCheckInGroup,
  deleteCustomerGroup,
  isAnonymousWalkInGuest,
  markOccupantAsmDeclared,
  mergeDuplicateWalkInGuests,
  saveCustomerGroup,
  upsertGuestProfile,
} from '../lib/pmsActions';
import { CUSTOMER_GROUP_COLOR_PALETTE } from '../lib/seedData';
import { exportAsmForeignerCsv } from '../lib/backupExport';
import {
  formatCountryBadge,
  formatCountryDisplay,
  normalizeCountryCode,
} from '../lib/countries';
import { CancelBookingModal } from './CancelBookingModal';
import { DepositResolutionModal } from './DepositResolutionModal';
import { PaginationBar, usePagination } from './PaginationBar';
import { CountrySelect } from './CountrySelect';
import { DateInputVN } from './DateInputVN';

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
  const { bookings, groups, guests, customerGroups, isAdmin, actor, notify } = usePms();
  const [subTab, setSubTab] = useState<'bookings' | 'groups' | 'asm_guests'>('bookings');

  // Single-box diacritic-insensitive search + multi filters
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [onlyAsmAlert, setOnlyAsmAlert] = useState(false);

  // Group tab filters & room-collapse state
  const [groupStatusFilter, setGroupStatusFilter] = useState<
    'active_upcoming' | 'reserved' | 'in_house' | 'checked_out' | 'all'
  >('active_upcoming');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupPaymentFilter, setGroupPaymentFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const [groupDateFrom, setGroupDateFrom] = useState('');
  const [groupDateTo, setGroupDateTo] = useState('');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});

  // Guest / ASM filters
  const [guestSearch, setGuestSearch] = useState('');
  const [guestCountryFilter, setGuestCountryFilter] = useState('');
  const [guestGroupFilter, setGuestGroupFilter] = useState('all');
  const [asmOnlyPending, setAsmOnlyPending] = useState(false);

  // Quick Guest CRM edit modal, inline group assign & Customer Groups manager modal
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [savingGuest, setSavingGuest] = useState(false);
  const [inlineAssignGuestId, setInlineAssignGuestId] = useState<string | null>(null);
  const [mergingWalkIn, setMergingWalkIn] = useState(false);

  const [showGroupManager, setShowGroupManager] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupFormName, setGroupFormName] = useState('');
  const [groupFormColor, setGroupFormColor] = useState('#0F5132');
  const [savingGroup, setSavingGroup] = useState(false);

  const customerGroupMap = useMemo(() => {
    const m = new Map<string, CustomerGroup>();
    for (const cg of customerGroups) m.set(cg.id, cg);
    return m;
  }, [customerGroups]);

  const guestByIdMap = useMemo(() => {
    const m = new Map<string, Guest>();
    for (const g of guests) m.set(g.id, g);
    return m;
  }, [guests]);

  const duplicateWalkInCount = useMemo(
    () =>
      guests.filter((g) => g.id !== WALK_IN_DEFAULT_GUEST_ID && isAnonymousWalkInGuest(g)).length,
    [guests]
  );

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
    const filterCode = normalizeCountryCode(guestCountryFilter).toLowerCase();
    const list = guests.filter((g) => {
      if (filterCode) {
        const gCode = normalizeCountryCode(g.nationality).toLowerCase();
        if (gCode !== filterCode) return false;
      }
      if (guestGroupFilter === '__UNGROUPED__') {
        if (g.customerGroupId && customerGroupMap.has(g.customerGroupId)) return false;
      } else if (guestGroupFilter !== 'all') {
        if (g.customerGroupId !== guestGroupFilter) return false;
      }
      if (!qNorm) return true;
      const countryHaystack = normalizeVietnamese(formatCountryDisplay(g.nationality));
      const grpName = g.customerGroupId ? customerGroupMap.get(g.customerGroupId)?.name || '' : '';
      return (
        g.normalizedName.includes(qNorm) ||
        (qDigits.length >= 4 && g.normalizedPhone.includes(qDigits)) ||
        (g.idNumber || '').toLowerCase().includes(qNorm) ||
        countryHaystack.includes(qNorm) ||
        normalizeVietnamese(grpName).includes(qNorm)
      );
    });
    // Always pin system WALK_IN_DEFAULT ("Khách lẻ") to the top of the table
    list.sort((a, b) => {
      const aSys = a.id === WALK_IN_DEFAULT_GUEST_ID || a.isSystemDefault ? 1 : 0;
      const bSys = b.id === WALK_IN_DEFAULT_GUEST_ID || b.isSystemDefault ? 1 : 0;
      if (aSys !== bSys) return bSys - aSys;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    return list;
  }, [guests, guestSearch, guestCountryFilter, guestGroupFilter, customerGroupMap]);

  const enrichedGroups = useMemo(() => {
    const bookingsByGroup = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (!b.groupId) continue;
      const arr = bookingsByGroup.get(b.groupId) || [];
      arr.push(b);
      bookingsByGroup.set(b.groupId, arr);
    }

    const list = groups.map((g) => {
      const gBookings = [...(bookingsByGroup.get(g.id) || [])].sort((a, b) =>
        a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
      );
      const activeGroupBookings = gBookings.filter(
        (b) => b.status === 'reserved' || b.status === 'in_house'
      );
      const hasInHouse = gBookings.some((b) => b.status === 'in_house');
      const hasReserved = gBookings.some((b) => b.status === 'reserved');
      const isActiveOrUpcoming = hasInHouse || hasReserved;
      const isCheckedOut =
        !isActiveOrUpcoming &&
        gBookings.some((b) => b.status === 'checked_out' || b.status === 'transferred');

      const nonCancelled = gBookings.filter(
        (b) => b.status !== 'cancelled' && b.status !== 'no_show'
      );
      const totalGross = nonCancelled.reduce(
        (s, b) => s + (b.grossRoomTotal || 0) + (b.serviceTotal || 0) + (b.hourlySurcharge || 0),
        0
      );
      const totalPaid = gBookings.reduce(
        (s, b) => s + (b.depositPaid || 0) + (b.guestPaid || 0),
        0
      );
      const balance = Math.max(0, totalGross - totalPaid);
      const reservedCount = gBookings.filter((b) => b.status === 'reserved').length;

      const checkIns = gBookings.map((b) => b.checkIn).filter(Boolean).sort();
      const checkOuts = gBookings.map((b) => b.checkOut).filter(Boolean).sort();
      const earliestCheckIn = checkIns[0] || (g.createdAt || '').slice(0, 10);
      const latestCheckOut = checkOuts[checkOuts.length - 1] || earliestCheckIn;

      return {
        group: g,
        gBookings,
        activeGroupBookings,
        hasInHouse,
        hasReserved,
        isActiveOrUpcoming,
        isCheckedOut,
        totalGross,
        totalPaid,
        balance,
        reservedCount,
        earliestCheckIn,
        latestCheckOut,
      };
    });

    // Smart default sort: in_house first -> upcoming reserved (soonest check-in first) -> checked_out/history (latest first)
    list.sort((a, b) => {
      const rank = (x: typeof a) => (x.hasInHouse ? 0 : x.hasReserved ? 1 : 2);
      const rA = rank(a);
      const rB = rank(b);
      if (rA !== rB) return rA - rB;
      if (rA <= 1) {
        return (a.earliestCheckIn || '').localeCompare(b.earliestCheckIn || '');
      }
      return (b.earliestCheckIn || '').localeCompare(a.earliestCheckIn || '');
    });

    return list;
  }, [groups, bookings]);

  const groupStatusCounts = useMemo(() => {
    return {
      active_upcoming: enrichedGroups.filter((x) => x.isActiveOrUpcoming).length,
      reserved: enrichedGroups.filter((x) => x.hasReserved).length,
      in_house: enrichedGroups.filter((x) => x.hasInHouse).length,
      checked_out: enrichedGroups.filter((x) => x.isCheckedOut).length,
      all: enrichedGroups.length,
    };
  }, [enrichedGroups]);

  const filteredGroups = useMemo(() => {
    const qNorm = normalizeVietnamese(groupSearch);
    const qDigits = normalizePhone(groupSearch);

    return enrichedGroups.filter((item) => {
      if (groupStatusFilter === 'active_upcoming' && !item.isActiveOrUpcoming) return false;
      if (groupStatusFilter === 'reserved' && !item.hasReserved) return false;
      if (groupStatusFilter === 'in_house' && !item.hasInHouse) return false;
      if (groupStatusFilter === 'checked_out' && !item.isCheckedOut) return false;

      if (groupPaymentFilter === 'unpaid' && !(item.totalPaid < item.totalGross)) return false;
      if (groupPaymentFilter === 'paid' && !(item.totalPaid >= item.totalGross)) return false;

      if (groupDateFrom || groupDateTo) {
        const ci = item.earliestCheckIn;
        const co = item.latestCheckOut;
        if (groupDateFrom && groupDateTo) {
          const ciIn = ci >= groupDateFrom && ci <= groupDateTo;
          const coIn = co >= groupDateFrom && co <= groupDateTo;
          if (!ciIn && !coIn) return false;
        } else if (groupDateFrom) {
          if (ci < groupDateFrom && co < groupDateFrom) return false;
        } else if (groupDateTo) {
          if (ci > groupDateTo && co > groupDateTo) return false;
        }
      }

      if (qNorm) {
        const g = item.group;
        const haystacks = [
          g.groupCode,
          g.groupName,
          g.leaderName,
          g.leaderPhone || '',
          ...item.gBookings.flatMap((b) => [
            b.bookingCode,
            b.roomNumber,
            `P.${b.roomNumber}`,
            b.primaryGuestName,
          ]),
        ];
        const matched = haystacks.some((h) => {
          const hn = normalizeVietnamese(h);
          if (hn.includes(qNorm)) return true;
          if (qDigits.length >= 3 && normalizePhone(h).includes(qDigits)) return true;
          return false;
        });
        if (!matched) return false;
      }

      return true;
    });
  }, [
    enrichedGroups,
    groupStatusFilter,
    groupSearch,
    groupPaymentFilter,
    groupDateFrom,
    groupDateTo,
  ]);

  const hasCustomGroupFilters =
    groupStatusFilter !== 'active_upcoming' ||
    Boolean(groupSearch.trim()) ||
    groupPaymentFilter !== 'all' ||
    Boolean(groupDateFrom) ||
    Boolean(groupDateTo);

  const resetGroupFilters = () => {
    setGroupStatusFilter('active_upcoming');
    setGroupSearch('');
    setGroupPaymentFilter('all');
    setGroupDateFrom('');
    setGroupDateTo('');
  };

  const bookingsPag = usePagination(
    filteredBookings,
    `${searchText}|${statusFilter}|${sourceFilter}|${onlyAsmAlert}`,
    20
  );
  const groupsPag = usePagination(
    filteredGroups,
    `${groupStatusFilter}|${groupSearch}|${groupPaymentFilter}|${groupDateFrom}|${groupDateTo}`,
    10
  );
  const asmPag = usePagination(foreignerStays, String(asmOnlyPending), 20);
  const guestsPag = usePagination(
    filteredGuests,
    `${guestSearch}|${guestCountryFilter}|${guestGroupFilter}`,
    20
  );

  const handleSaveGuestEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGuest || !editingGuest.fullName.trim()) {
      notify('Vui lòng nhập Họ và tên khách hàng', 'warning');
      return;
    }
    setSavingGuest(true);
    try {
      const isSysWalkIn =
        editingGuest.id === WALK_IN_DEFAULT_GUEST_ID || editingGuest.isSystemDefault;
      await upsertGuestProfile(
        {
          id: editingGuest.id,
          guestCategory: isSysWalkIn ? 'vietnamese' : editingGuest.guestCategory,
          fullName: isSysWalkIn ? 'Khách lẻ' : editingGuest.fullName.trim(),
          phone: isSysWalkIn ? '' : editingGuest.phone,
          gender: isSysWalkIn ? '' : editingGuest.gender,
          dob: isSysWalkIn ? '' : editingGuest.dob,
          nationality: isSysWalkIn ? 'VN' : normalizeCountryCode(editingGuest.nationality),
          idType: editingGuest.guestCategory === 'vietnamese' ? 'cccd' : 'visa_passport',
          idNumber: isSysWalkIn ? '' : editingGuest.idNumber,
          visaNumber: isSysWalkIn ? '' : editingGuest.visaNumber,
          address: isSysWalkIn ? '' : editingGuest.address,
          customerGroupId: editingGuest.customerGroupId || null,
        },
        guests,
        false
      );
      notify(`Đã cập nhật hồ sơ khách ${isSysWalkIn ? 'Khách lẻ' : editingGuest.fullName}`);
      setEditingGuest(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi cập nhật hồ sơ khách', 'error');
    } finally {
      setSavingGuest(false);
    }
  };

  const handleQuickAssignGroup = async (guestId: string, groupId: string | null) => {
    try {
      await assignGuestCustomerGroup(guestId, groupId);
      setInlineAssignGuestId(null);
      const grp = groupId ? customerGroupMap.get(groupId) : null;
      notify(grp ? `Đã gán nhóm "${grp.name}"` : 'Đã gỡ phân nhóm khách hàng');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi cập nhật nhóm khách', 'error');
    }
  };

  const handleMergeWalkInDuplicates = async () => {
    const ok = window.confirm(
      duplicateWalkInCount > 0
        ? `Gộp ${duplicateWalkInCount} hồ sơ "Khách lẻ" vô danh trùng lặp thành 1 hồ sơ hệ thống duy nhất (WALK_IN_DEFAULT) và đồng bộ lại toàn bộ đơn đặt phòng liên quan?`
        : 'Đồng bộ lại hồ sơ hệ thống "Khách lẻ" (WALK_IN_DEFAULT) và tính lại tổng số lần lưu trú?'
    );
    if (!ok) return;
    setMergingWalkIn(true);
    try {
      const res = await mergeDuplicateWalkInGuests(guests, bookings, actor);
      notify(
        `Đã gộp ${res.mergedGuestCount} hồ sơ Khách lẻ trùng, cập nhật ${res.updatedBookingCount} đơn (Tổng lượt: ${res.walkInTotalStays})`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi gộp hồ sơ Khách lẻ trùng', 'error');
    } finally {
      setMergingWalkIn(false);
    }
  };

  const handleSaveCustomerGroupForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupFormName.trim()) {
      notify('Vui lòng nhập tên nhóm khách hàng', 'warning');
      return;
    }
    setSavingGroup(true);
    try {
      await saveCustomerGroup(
        {
          id: editingGroupId || undefined,
          name: groupFormName.trim(),
          color: groupFormColor,
          sortOrder: editingGroupId
            ? customerGroupMap.get(editingGroupId)?.sortOrder ?? customerGroups.length + 1
            : customerGroups.length + 1,
        },
        actor
      );
      notify(editingGroupId ? 'Đã cập nhật nhóm khách hàng' : 'Đã thêm nhóm khách hàng mới');
      setEditingGroupId(null);
      setGroupFormName('');
      setGroupFormColor('#0F5132');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi lưu nhóm khách hàng', 'error');
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteCustomerGroupItem = async (grp: CustomerGroup) => {
    const usedCount = guests.filter((g) => g.customerGroupId === grp.id).length;
    const ok = window.confirm(
      usedCount > 0
        ? `Xóa nhóm "${grp.name}"? Hiện có ${usedCount} khách thuộc nhóm này sẽ tự động chuyển về "Chưa phân nhóm".`
        : `Xóa nhóm khách hàng "${grp.name}"?`
    );
    if (!ok) return;
    try {
      await deleteCustomerGroup(grp.id, guests, actor);
      if (guestGroupFilter === grp.id) setGuestGroupFilter('all');
      if (editingGroupId === grp.id) {
        setEditingGroupId(null);
        setGroupFormName('');
      }
      notify(`Đã xóa nhóm "${grp.name}"`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi xóa nhóm khách hàng', 'error');
    }
  };

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
                  bookingsPag.pageItems.map((b) => {
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
                            <span>{b.primaryGuestName}</span>
                            {(() => {
                              const gRec = guestByIdMap.get(b.primaryGuestId);
                              const grp = gRec?.customerGroupId
                                ? customerGroupMap.get(gRec.customerGroupId)
                                : undefined;
                              if (!grp) return null;
                              return (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold"
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
              {filteredBookings.length > 0 && (() => {
                // v2.2.1 #9: Exclude cancelled & no_show from totals; display forfeited cancellation fees separately
                const activeRows = filteredBookings.filter(
                  (b) => b.status !== 'cancelled' && b.status !== 'no_show'
                );
                const forfeitedFeeSum = filteredBookings
                  .filter((b) => b.depositResolutionStatus === 'forfeited_fee')
                  .reduce((s, b) => s + (b.forfeitedFeeAmount || 0), 0);
                const excludedCount = filteredBookings.length - activeRows.length;
                return (
                  <tfoot className="bg-[#FAF9F6] border-t border-[#E7E3DA] font-semibold text-[12px]">
                    <tr>
                      <td colSpan={4} className="px-3.5 py-2.5 text-[#57534E]">
                        Tổng đơn hoạt động ({activeRows.length} đơn
                        {excludedCount > 0 ? ` · loại trừ ${excludedCount} đơn hủy/no-show` : ''})
                        {forfeitedFeeSum > 0 && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-[#E8F3EC] text-[#0F5132] font-mono-num text-[11px]">
                            Phí giữ cọc: {formatCurrency(forfeitedFeeSum)}
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono-num text-[#1C1B18]">
                        {formatCurrency(
                          activeRows.reduce(
                            (s, b) =>
                              s +
                              (b.grossRoomTotal || 0) +
                              (b.serviceTotal || 0) +
                              (b.hourlySurcharge || 0),
                            0
                          )
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono-num text-[#0F5132]">
                        Đã thu:{' '}
                        {formatCurrency(
                          activeRows.reduce(
                            (s, b) => s + (b.depositPaid || 0) + (b.guestPaid || 0),
                            0
                          )
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono-num text-[#B45309]">
                        Còn lại:{' '}
                        {formatCurrency(
                          activeRows.reduce(
                            (s, b) => s + Math.max(0, getBookingGuestBalance(b)),
                            0
                          )
                        )}
                      </td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>

          <PaginationBar
            testId="bookings-pagination"
            page={bookingsPag.page}
            pageSize={bookingsPag.pageSize}
            totalItems={bookingsPag.totalItems}
            onPageChange={bookingsPag.setPage}
            onPageSizeChange={bookingsPag.setPageSize}
          />
        </div>
      )}

      {/* TAB 2: GROUPS */}
      {subTab === 'groups' && (
        <div className="space-y-3">
          {/* Group Filter Bar */}
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-3.5 sm:p-4 space-y-3">
            {/* Row 1: Quick Status Filter Pills with counts */}
            <div className="flex flex-wrap items-center gap-1.5" data-testid="groups-status-pills">
              {(
                [
                  { id: 'active_upcoming', label: 'Đang ở & Sắp đến', count: groupStatusCounts.active_upcoming },
                  { id: 'reserved', label: 'Đặt trước', count: groupStatusCounts.reserved },
                  { id: 'in_house', label: 'Đang lưu trú', count: groupStatusCounts.in_house },
                  { id: 'checked_out', label: 'Đã trả phòng', count: groupStatusCounts.checked_out },
                  { id: 'all', label: 'Tất cả', count: groupStatusCounts.all },
                ] as const
              ).map((pill) => {
                const active = groupStatusFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    data-testid={`groups-status-pill-${pill.id}`}
                    onClick={() => setGroupStatusFilter(pill.id)}
                    className={`min-h-[38px] sm:min-h-0 sm:h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 border transition-colors ${
                      active
                        ? 'bg-[#0F5132] border-[#0F5132] text-white'
                        : 'bg-[#FAF9F6] border-[#E5E2DC] text-[#57534E] hover:border-[#0F5132]/50 hover:text-[#1C1B18]'
                    }`}
                  >
                    <span>{pill.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full font-mono-num text-[11px] ${
                        active ? 'bg-white/20 text-white' : 'bg-[#EAE7E0] text-[#44403C]'
                      }`}
                    >
                      {pill.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Row 2: Search + Payment Status + Date Range + Reset */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end">
              <div className="sm:col-span-2 lg:col-span-4 relative">
                <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                  Tìm kiếm nhanh
                </label>
                <div className="relative">
                  <Search
                    className="w-4 h-4 text-[#8A847C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    strokeWidth={1.5}
                  />
                  <input
                    type="text"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    data-testid="groups-search-input"
                    placeholder="Mã đoàn (LIK00848), tên, SĐT, P.202..."
                    className="w-full min-h-[40px] sm:min-h-0 sm:h-9 pl-9 pr-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] focus:outline-none focus:border-[#0F5132]"
                  />
                </div>
              </div>

              <div className="lg:col-span-3">
                <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                  Công nợ thanh toán
                </label>
                <select
                  value={groupPaymentFilter}
                  onChange={(e) =>
                    setGroupPaymentFilter(e.target.value as 'all' | 'unpaid' | 'paid')
                  }
                  data-testid="groups-payment-filter"
                  className="w-full min-h-[40px] sm:min-h-0 sm:h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[13px] focus:outline-none focus:border-[#0F5132]"
                >
                  <option value="all">Tất cả thanh toán</option>
                  <option value="unpaid">Chưa thu đủ (Còn nợ)</option>
                  <option value="paid">Đã thanh toán đủ</option>
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                  Từ ngày (Nhận/Trả)
                </label>
                <DateInputVN
                  value={groupDateFrom}
                  onChange={setGroupDateFrom}
                  placeholder="dd/mm/yyyy"
                  className="w-full min-h-[40px] sm:min-h-0 sm:h-9"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                  Đến ngày (Nhận/Trả)
                </label>
                <DateInputVN
                  value={groupDateTo}
                  onChange={setGroupDateTo}
                  placeholder="dd/mm/yyyy"
                  className="w-full min-h-[40px] sm:min-h-0 sm:h-9"
                />
              </div>

              <div className="lg:col-span-1">
                <button
                  type="button"
                  disabled={!hasCustomGroupFilters}
                  onClick={resetGroupFilters}
                  data-testid="groups-reset-filters-btn"
                  title="Đưa bộ lọc về mặc định (Đang ở & Sắp đến)"
                  className="w-full min-h-[40px] sm:min-h-0 sm:h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#FAF9F6] disabled:opacity-45 text-[#57534E] hover:text-[#1C1B18] text-[12px] font-medium inline-flex items-center justify-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} />
                  <span>Xóa lọc</span>
                </button>
              </div>
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="bg-white border border-[#E5E2DC] rounded-2xl p-10 text-center text-[13px] text-[#8A847C]">
              Chưa có hồ sơ khách đoàn nào. Bấm "Đặt khách đoàn" hoặc chọn nhiều phòng từ Tìm phòng trống.
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="bg-white border border-[#E5E2DC] rounded-2xl p-8 text-center space-y-2.5">
              <p className="text-[13px] text-[#57534E]">
                Không tìm thấy hồ sơ khách đoàn nào khớp với bộ lọc hiện tại.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {groupStatusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setGroupStatusFilter('all')}
                    className="min-h-[38px] sm:min-h-0 sm:h-8 px-3.5 rounded-lg bg-[#0F5132] text-white text-[12px] font-medium"
                  >
                    Xem tất cả đoàn ({groups.length})
                  </button>
                )}
                {hasCustomGroupFilters && (
                  <button
                    type="button"
                    onClick={resetGroupFilters}
                    className="min-h-[38px] sm:min-h-0 sm:h-8 px-3.5 rounded-lg border border-[#E5E2DC] bg-white text-[#57534E] text-[12px] font-medium"
                  >
                    Xóa bộ lọc
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {groupsPag.pageItems.map((item) => {
                const {
                  group: g,
                  gBookings,
                  activeGroupBookings,
                  hasInHouse,
                  hasReserved,
                  totalGross,
                  totalPaid,
                  balance,
                  reservedCount,
                  earliestCheckIn,
                  latestCheckOut,
                } = item;
                const isExpanded = Boolean(expandedGroupIds[g.id]);
                const hasMoreRooms = gBookings.length > 4;
                const visibleBookings =
                  hasMoreRooms && !isExpanded ? gBookings.slice(0, 4) : gBookings;

                return (
                  <div
                    key={g.id}
                    data-testid={`group-card-${g.id}`}
                    className="bg-white border border-[#E5E2DC] rounded-2xl p-4 sm:p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono-num text-[12px] px-2 py-0.5 rounded bg-[#E8F2EE] text-[#1B5E4B] font-semibold">
                            {g.groupCode}
                          </span>
                          <h3 className="text-[15px] font-semibold text-[#1C1B18]">{g.groupName}</h3>
                          {hasInHouse ? (
                            <span className="px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#065F46] text-[11px] font-medium">
                              Đang lưu trú
                            </span>
                          ) : hasReserved ? (
                            <span className="px-2 py-0.5 rounded-full bg-[#FFFBEB] text-[#92400E] text-[11px] font-medium">
                              Đặt trước
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-[#F1EFEA] text-[#57534E] text-[11px] font-medium">
                              Đã trả phòng
                            </span>
                          )}
                          {balance > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#B45309] font-mono-num text-[11px] font-semibold">
                              Còn nợ: {formatCurrency(balance)}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-[#E8F3EC] text-[#0F5132] text-[11px] font-medium">
                              Đã thanh toán đủ
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-[#57534E] mt-1">
                          Trưởng đoàn: <strong className="text-[#1C1B18]">{g.leaderName}</strong> (
                          {g.leaderPhone || '—'}) •{' '}
                          <span className="font-mono-num">
                            {formatDateVN(earliestCheckIn)} → {formatDateVN(latestCheckOut)}
                          </span>{' '}
                          • {gBookings.length} phòng •{' '}
                          {g.billingMode === 'master' ? 'Gộp hóa đơn đoàn' : 'Tách từng phòng'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <div className="text-left sm:text-right font-mono-num text-[12px]">
                          <div>
                            Tổng đoàn: <strong>{formatCurrency(totalGross)}</strong>
                          </div>
                          <div className="text-[#15803D]">
                            Đã thu/cọc: {formatCurrency(totalPaid)}
                          </div>
                        </div>
                        {activeGroupBookings.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setPartialCancelScope(activeGroupBookings)}
                            className="min-h-[38px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] text-[12px] font-medium"
                          >
                            Hủy một phần / phòng
                          </button>
                        )}
                        {reservedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => handleBulkCheckIn(g.id, g.groupName)}
                            className="min-h-[38px] sm:min-h-0 sm:h-9 px-3.5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[12px] font-medium inline-flex items-center gap-1.5"
                          >
                            <LogIn className="w-3.5 h-3.5" strokeWidth={1.5} />
                            Check-in cả đoàn ({reservedCount})
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      {visibleBookings.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          data-testid={`group-room-tile-${g.id}-${b.roomNumber}`}
                          onClick={() => onSelectBooking(b)}
                          className="text-left p-3 rounded-xl border border-[#E5E2DC] hover:border-[#1B5E4B] bg-[#FAF9F6] transition-colors"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono-num font-semibold text-[13px] text-[#1C1B18]">
                              P.{b.roomNumber}
                            </span>
                            <span className="text-[11px] text-[#57534E]">
                              {getStatusLabel(b.status)}
                            </span>
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

                    {hasMoreRooms && (
                      <div className="pt-0.5">
                        <button
                          type="button"
                          data-testid={`group-toggle-rooms-${g.id}`}
                          onClick={() =>
                            setExpandedGroupIds((prev) => ({ ...prev, [g.id]: !prev[g.id] }))
                          }
                          className="min-h-[38px] sm:min-h-0 sm:h-8 px-3 rounded-lg border border-dashed border-[#0F5132]/40 bg-[#FAF9F6] hover:bg-[#E8F2EE] text-[#0F5132] text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.75} />
                              <span>Thu gọn bớt</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} />
                              <span>Xem thêm {gBookings.length - 4} phòng...</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              <PaginationBar
                testId="groups-pagination"
                page={groupsPag.page}
                pageSize={groupsPag.pageSize}
                pageSizeOptions={[10, 20, 50]}
                totalItems={groupsPag.totalItems}
                onPageChange={groupsPag.setPage}
                onPageSizeChange={groupsPag.setPageSize}
              />
            </>
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
              <>
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
                    {asmPag.pageItems.map(({ booking, occ }) => {
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
                              {formatCountryBadge(occ.nationality) || 'Chưa rõ'} • {occ.dob ? formatDateVN(occ.dob) : '—'}
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
              <PaginationBar
                testId="asm-pagination"
                page={asmPag.page}
                pageSize={asmPag.pageSize}
                totalItems={asmPag.totalItems}
                onPageChange={asmPag.setPage}
                onPageSizeChange={asmPag.setPageSize}
              />
              </>
            )}
          </div>

          {/* Repeat Guest Directory */}
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                  Kho Hồ sơ Khách hàng & Khách quay lại ({filteredGuests.length}
                  {filteredGuests.length !== guests.length ? ` / ${guests.length}` : ''})
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                <select
                  value={guestGroupFilter}
                  onChange={(e) => setGuestGroupFilter(e.target.value)}
                  data-testid="guests-group-filter"
                  className="min-h-[40px] sm:min-h-0 sm:h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px] text-[#1C1B18] w-full sm:w-44 focus:outline-none focus:border-[#0F5132]"
                >
                  <option value="all">Tất cả nhóm khách</option>
                  <option value="__UNGROUPED__">Chưa phân nhóm</option>
                  {customerGroups.map((cg) => (
                    <option key={cg.id} value={cg.id}>
                      {cg.name}
                    </option>
                  ))}
                </select>
                <div className="w-full sm:w-52">
                  <CountrySelect
                    value={guestCountryFilter}
                    onChange={setGuestCountryFilter}
                    allowEmpty
                    emptyLabel="Tất cả quốc tịch"
                    compact
                    testId="guests-country-filter"
                  />
                </div>
                <input
                  type="text"
                  value={guestSearch}
                  onChange={(e) => setGuestSearch(e.target.value)}
                  placeholder="Tìm tên, SĐT, CCCD, quốc tịch..."
                  className="min-h-[40px] sm:min-h-0 sm:h-8 px-3 rounded-lg border border-[#E5E2DC] text-[12px] w-full sm:w-56"
                />
                <button
                  type="button"
                  onClick={() => {
                    setEditingGroupId(null);
                    setGroupFormName('');
                    setGroupFormColor('#0F5132');
                    setShowGroupManager(true);
                  }}
                  data-testid="manage-customer-groups-btn"
                  className="min-h-[40px] sm:min-h-0 sm:h-8 px-3 rounded-lg border border-[#0F5132]/35 bg-[#E8F2EE] hover:bg-[#D5E9E0] text-[#0F5132] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Tag className="w-3.5 h-3.5" strokeWidth={1.6} />
                  <span>Quản lý nhóm khách</span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    disabled={mergingWalkIn}
                    onClick={() => void handleMergeWalkInDuplicates()}
                    data-testid="merge-walkin-btn"
                    className={`min-h-[40px] sm:min-h-0 sm:h-8 px-3 rounded-lg border text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                      duplicateWalkInCount > 0
                        ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#92400E] hover:bg-[#FEF3C7]'
                        : 'border-[#E5E2DC] bg-white text-[#57534E] hover:bg-[#F7F6F3]'
                    }`}
                    title="Gộp toàn bộ hồ sơ Khách lẻ vô danh trùng lặp về 1 hồ sơ hệ thống duy nhất (WALK_IN_DEFAULT)"
                  >
                    <Merge className="w-3.5 h-3.5" strokeWidth={1.6} />
                    <span>
                      {mergingWalkIn
                        ? 'Đang gộp...'
                        : duplicateWalkInCount > 0
                          ? `Gộp khách lẻ trùng (${duplicateWalkInCount})`
                          : 'Gộp khách lẻ trùng'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto border border-[#E5E2DC] rounded-xl">
              <table className="w-full text-[12px]">
                <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Họ tên / Nhóm khách</th>
                    <th className="text-left px-3 py-2 font-medium">SĐT</th>
                    <th className="text-left px-3 py-2 font-medium">CCCD / Hộ chiếu</th>
                    <th className="text-left px-3 py-2 font-medium">Quốc tịch</th>
                    <th className="text-right px-3 py-2 font-medium">Số lần lưu trú</th>
                    <th className="text-right px-3 py-2 font-medium">Lần cuối</th>
                    <th className="text-right px-3 py-2 font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1EFEA]">
                  {guestsPag.pageItems.map((g) => {
                    const isSysWalkIn = g.id === WALK_IN_DEFAULT_GUEST_ID || g.isSystemDefault;
                    const assignedGroup = g.customerGroupId
                      ? customerGroupMap.get(g.customerGroupId)
                      : undefined;
                    return (
                      <tr
                        key={g.id}
                        data-testid={`guest-row-${g.id}`}
                        className={isSysWalkIn ? 'bg-[#FAF9F6]/80' : undefined}
                      >
                        <td className="px-3 py-2 font-medium text-[#1C1B18]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{g.fullName}</span>
                            {isSysWalkIn && (
                              <span
                                data-testid="walkin-system-badge"
                                className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#E7E5E0] text-[#44403C] text-[10px] font-semibold"
                              >
                                [Hệ thống]
                              </span>
                            )}
                            {inlineAssignGuestId === g.id ? (
                              <select
                                autoFocus
                                value={g.customerGroupId || ''}
                                onBlur={() => setInlineAssignGuestId(null)}
                                onChange={(e) =>
                                  void handleQuickAssignGroup(g.id, e.target.value || null)
                                }
                                data-testid={`inline-group-select-${g.id}`}
                                className="h-6 px-1.5 rounded border border-[#0F5132] bg-white text-[11px] font-medium text-[#1C1B18]"
                              >
                                <option value="">Chưa phân nhóm</option>
                                {customerGroups.map((cg) => (
                                  <option key={cg.id} value={cg.id}>
                                    {cg.name}
                                  </option>
                                ))}
                              </select>
                            ) : assignedGroup ? (
                              <button
                                type="button"
                                onClick={() => setInlineAssignGuestId(g.id)}
                                data-testid={`guest-group-badge-${g.id}`}
                                title="Bấm để đổi nhóm khách"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-opacity hover:opacity-85"
                                style={{
                                  backgroundColor: `${assignedGroup.color}18`,
                                  borderColor: `${assignedGroup.color}40`,
                                  color: assignedGroup.color,
                                }}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: assignedGroup.color }}
                                />
                                {assignedGroup.name}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setInlineAssignGuestId(g.id)}
                                data-testid={`guest-group-assign-btn-${g.id}`}
                                title="Bấm để gán nhóm khách thủ công"
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-[#D6D1C7] text-[#8A847C] hover:border-[#0F5132] hover:text-[#0F5132] text-[10px] font-medium transition-colors"
                              >
                                + Nhóm
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono-num">{g.phone || '—'}</td>
                        <td className="px-3 py-2 font-mono-num">{g.idNumber || '—'}</td>
                        <td className="px-3 py-2 font-medium text-[#3F3D37]">
                          {formatCountryBadge(g.nationality) || '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-num font-semibold text-[#1B5E4B]">
                          {g.totalStays}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-num text-[#57534E]">
                          {formatDateVN(g.lastVisitDate)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setEditingGuest({ ...g })}
                            data-testid={`edit-guest-btn-${g.id}`}
                            className="min-h-[34px] sm:min-h-0 sm:h-7 px-2.5 rounded-lg border border-[#E5E2DC] hover:border-[#0F5132] hover:text-[#0F5132] text-[11px] font-medium inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" strokeWidth={1.5} />
                            <span>Sửa</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationBar
              testId="guests-pagination"
              page={guestsPag.page}
              pageSize={guestsPag.pageSize}
              totalItems={guestsPag.totalItems}
              onPageChange={guestsPag.setPage}
              onPageSizeChange={guestsPag.setPageSize}
            />
          </div>
        </div>
      )}

      {editingGuest && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3"
          onClick={() => !savingGuest && setEditingGuest(null)}
        >
          <form
            onSubmit={handleSaveGuestEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white border border-[#E5E2DC] shadow-xl overflow-visible"
          >
            <div className="px-4 py-3 border-b border-[#E5E2DC] flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#1C1B18]">Chỉnh sửa hồ sơ khách hàng</h3>
              <button
                type="button"
                onClick={() => setEditingGuest(null)}
                className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-[#F5F4F0] flex items-center justify-center text-[#57534E]"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="inline-flex p-0.5 rounded-lg bg-[#F1EFEA] text-[12px]">
                {(['vietnamese', 'foreigner'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() =>
                      setEditingGuest((prev) =>
                        prev
                          ? {
                              ...prev,
                              guestCategory: cat,
                              nationality:
                                cat === 'vietnamese'
                                  ? 'VN'
                                  : normalizeCountryCode(prev.nationality) === 'VN'
                                    ? ''
                                    : normalizeCountryCode(prev.nationality),
                            }
                          : null
                      )
                    }
                    className={`px-3 py-1 rounded-md font-medium ${
                      editingGuest.guestCategory === cat ? 'bg-white text-[#1C1B18]' : 'text-[#57534E]'
                    }`}
                  >
                    {cat === 'vietnamese' ? 'Khách Việt Nam' : 'Khách nước ngoài'}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Họ và tên *</label>
                <input
                  type="text"
                  required
                  disabled={editingGuest.id === WALK_IN_DEFAULT_GUEST_ID || editingGuest.isSystemDefault}
                  value={editingGuest.fullName}
                  onChange={(e) => setEditingGuest({ ...editingGuest, fullName: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] disabled:bg-[#F5F4F0] disabled:text-[#8A847C] text-[13px]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    disabled={editingGuest.id === WALK_IN_DEFAULT_GUEST_ID || editingGuest.isSystemDefault}
                    value={editingGuest.phone || ''}
                    onChange={(e) => setEditingGuest({ ...editingGuest, phone: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] disabled:bg-[#F5F4F0] disabled:text-[#8A847C] text-[13px] font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">
                    {editingGuest.guestCategory === 'vietnamese' ? 'Số CCCD' : 'Số Hộ chiếu'}
                  </label>
                  <input
                    type="text"
                    disabled={editingGuest.id === WALK_IN_DEFAULT_GUEST_ID || editingGuest.isSystemDefault}
                    value={editingGuest.idNumber || ''}
                    onChange={(e) => setEditingGuest({ ...editingGuest, idNumber: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] disabled:bg-[#F5F4F0] disabled:text-[#8A847C] text-[13px] font-mono-num"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Quốc tịch</label>
                <CountrySelect
                  value={editingGuest.nationality || ''}
                  onChange={(code) => setEditingGuest({ ...editingGuest, nationality: code })}
                  disabled={editingGuest.id === WALK_IN_DEFAULT_GUEST_ID || editingGuest.isSystemDefault}
                  placeholder="Chọn quốc tịch..."
                  testId="guest-edit-nationality-select"
                />
              </div>
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Nhóm khách hàng (Phân loại thủ công)</label>
                <select
                  value={editingGuest.customerGroupId || ''}
                  onChange={(e) =>
                    setEditingGuest({
                      ...editingGuest,
                      customerGroupId: e.target.value || null,
                    })
                  }
                  data-testid="guest-edit-group-select"
                  className="w-full min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] focus:outline-none focus:border-[#0F5132]"
                >
                  <option value="">Chưa phân nhóm</option>
                  {customerGroups.map((cg) => (
                    <option key={cg.id} value={cg.id}>
                      {cg.name}
                    </option>
                  ))}
                </select>
              </div>
              {(editingGuest.id === WALK_IN_DEFAULT_GUEST_ID || editingGuest.isSystemDefault) && (
                <p className="text-[11px] text-[#8A847C] bg-[#FAF9F6] border border-[#E5E2DC] rounded-lg px-3 py-2">
                  Đây là hồ sơ hệ thống mặc định (<strong>WALK_IN_DEFAULT</strong>) gom toàn bộ lượt khách lẻ vô danh — không thể xóa hoặc đổi tên định danh.
                </p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-[#E5E2DC] bg-[#FAF9F6] rounded-b-2xl flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingGuest(null)}
                className="min-h-[40px] sm:min-h-0 sm:h-9 px-3.5 rounded-lg border border-[#E5E2DC] bg-white text-[13px] text-[#57534E]"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingGuest}
                className="min-h-[40px] sm:min-h-0 sm:h-9 px-4 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-50 text-white text-[13px] font-medium"
              >
                {savingGuest ? 'Đang lưu...' : 'Lưu hồ sơ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Quản lý Danh mục Nhóm khách (customer_groups) */}
      {showGroupManager && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3"
          onClick={() => !savingGroup && setShowGroupManager(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-white border border-[#E5E2DC] shadow-xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[#E5E2DC] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-[#0F5132]" strokeWidth={1.75} />
                <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                  Quản lý Danh mục Nhóm khách hàng
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGroupManager(false)}
                className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-[#F5F4F0] flex items-center justify-center text-[#57534E]"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <form
                onSubmit={handleSaveCustomerGroupForm}
                className="p-3.5 rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] space-y-3"
              >
                <div className="text-[12px] font-semibold text-[#1C1B18]">
                  {editingGroupId ? 'Chỉnh sửa nhóm khách' : 'Thêm nhóm khách mới'}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    required
                    value={groupFormName}
                    onChange={(e) => setGroupFormName(e.target.value)}
                    data-testid="customer-group-name-input"
                    placeholder="VD: Khách VIP, Khách thân quen, Cần lưu ý..."
                    className="flex-1 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] focus:outline-none focus:border-[#0F5132]"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="submit"
                      disabled={savingGroup}
                      data-testid="customer-group-save-btn"
                      className="min-h-[40px] sm:min-h-0 sm:h-9 px-3.5 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-50 text-white text-[12px] font-medium"
                    >
                      {savingGroup ? 'Đang lưu...' : editingGroupId ? 'Cập nhật' : '+ Thêm nhóm'}
                    </button>
                    {editingGroupId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGroupId(null);
                          setGroupFormName('');
                          setGroupFormColor('#0F5132');
                        }}
                        className="min-h-[40px] sm:min-h-0 sm:h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px] text-[#57534E]"
                      >
                        Hủy
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-[#57534E]">Màu nhãn:</span>
                  {CUSTOMER_GROUP_COLOR_PALETTE.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.label}
                      onClick={() => setGroupFormColor(c.hex)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        groupFormColor === c.hex
                          ? 'border-[#1C1B18] scale-110'
                          : 'border-white shadow-xs'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                  {groupFormName.trim() && (
                    <span
                      className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                      style={{
                        backgroundColor: `${groupFormColor}18`,
                        borderColor: `${groupFormColor}40`,
                        color: groupFormColor,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: groupFormColor }}
                      />
                      {groupFormName.trim()}
                    </span>
                  )}
                </div>
              </form>

              <div className="space-y-1.5">
                <div className="text-[12px] font-semibold text-[#57534E]">
                  Danh sách nhóm hiện có ({customerGroups.length})
                </div>
                {customerGroups.length === 0 ? (
                  <p className="text-[12px] text-[#8A847C] py-3">Chưa có nhóm khách nào.</p>
                ) : (
                  <div className="divide-y divide-[#F1EFEA] border border-[#E5E2DC] rounded-xl overflow-hidden">
                    {customerGroups.map((grp) => {
                      const count = guests.filter((g) => g.customerGroupId === grp.id).length;
                      return (
                        <div
                          key={grp.id}
                          data-testid={`customer-group-item-${grp.id}`}
                          className="px-3 py-2.5 bg-white flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-semibold border"
                              style={{
                                backgroundColor: `${grp.color}18`,
                                borderColor: `${grp.color}40`,
                                color: grp.color,
                              }}
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: grp.color }}
                              />
                              {grp.name}
                            </span>
                            <span className="text-[11px] font-mono-num text-[#8A847C]">
                              ({count} khách)
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingGroupId(grp.id);
                                setGroupFormName(grp.name);
                                setGroupFormColor(grp.color);
                              }}
                              className="min-h-[34px] sm:min-h-0 sm:h-7 px-2.5 rounded-lg border border-[#E5E2DC] hover:border-[#0F5132] text-[11px] font-medium text-[#57534E] hover:text-[#0F5132] inline-flex items-center gap-1"
                            >
                              <Pencil className="w-3 h-3" strokeWidth={1.5} />
                              Sửa
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteCustomerGroupItem(grp)}
                              data-testid={`delete-group-btn-${grp.id}`}
                              className="min-h-[34px] sm:min-h-0 sm:h-7 px-2.5 rounded-lg border border-[#FECACA] hover:bg-[#FEF2F2] text-[11px] font-medium text-[#B91C1C] inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" strokeWidth={1.5} />
                              Xóa
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
