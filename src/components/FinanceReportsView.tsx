import React, { useMemo, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRightLeft, Download, Lock, Plus, RotateCcw, Search, Wallet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { usePms } from '../context/PmsContext';
import type { PaymentMethod, ShiftHandover, Transaction } from '../types/pms';
import {
  addDays,
  diffDays,
  formatCurrency,
  formatDateVN,
  generateId,
  getPaymentMethodLabel,
  normalizeVietnamese,
  todayISO,
} from '../lib/utils';
import { getRoomRevenueInRange, type RevenueServiceGroup } from '../lib/revenueMetrics';
import { recordTransaction, voidTransactionWithUndo } from '../lib/pmsActions';
import { DateInputVN } from './DateInputVN';
import { ReclassifyPaymentModal } from './ReclassifyPaymentModal';
import { PaginationBar, usePagination } from './PaginationBar';

export const FinanceReportsView: React.FC = () => {
  const {
    bookings,
    activeRooms: rooms,
    roomTypes,
    transactions,
    shiftHandovers,
    hotelConfig,
    actor,
    staffProfile,
    isAdmin,
    notify,
  } = usePms();

  const [subTab, setSubTab] = useState<'pnl' | 'monthly' | 'cashbook' | 'handover'>('pnl');
  const [reclassifyingTx, setReclassifyingTx] = useState<Transaction | null>(null);

  const [fromDate, setFromDate] = useState(() => addDays(todayISO(), -29));
  const [toDate, setToDate] = useState(() => todayISO());
  const [sourceFilter, setSourceFilter] = useState('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');

  // Service Revenue Breakdown & Multi-Dimensional Detail Table Filters
  const [svcGroupFilter, setSvcGroupFilter] = useState<'all' | RevenueServiceGroup>('all');
  const [svcRoomFilter, setSvcRoomFilter] = useState('all');
  const [svcSearchQuery, setSvcSearchQuery] = useState('');

  const [txDirection, setTxDirection] = useState<'out' | 'in'>('out');
  const [txCategory, setTxCategory] = useState(
    hotelConfig.expenseCategories[0] || 'Điện / Nước / Internet'
  );
  const [txAmount, setTxAmount] = useState(0);
  const [txMethod, setTxMethod] = useState<PaymentMethod>('cash');
  const [txDate, setTxDate] = useState(todayISO());
  const [txNote, setTxNote] = useState('');

  const [openingCash, setOpeningCash] = useState(1000000);
  const [actualHandoverCash, setActualHandoverCash] = useState(0);
  const [handoverNote, setHandoverNote] = useState('');

  const canViewProfit = Boolean(staffProfile?.permissions.canViewProfit);

  // Single Source of Truth for P&L Revenue, Sold Nights, Occupancy, ADR & RevPAR (v2.2.1 #1)
  const rangeRev = useMemo(
    () =>
      getRoomRevenueInRange(bookings, transactions, fromDate, toDate, {
        roomCount: rooms.length,
        sourceFilter,
        roomTypeFilter,
      }),
    [bookings, transactions, fromDate, toDate, rooms.length, sourceFilter, roomTypeFilter]
  );

  const filteredBookings = rangeRev.eligibleBookings;
  const forfeitedCancelFees = rangeRev.forfeitedCancelFees;

  const filteredServiceRows = useMemo(() => {
    const normQ = normalizeVietnamese(svcSearchQuery.trim());
    return rangeRev.serviceDetailRows.filter((row) => {
      if (svcGroupFilter !== 'all' && row.group !== svcGroupFilter) return false;
      if (svcRoomFilter !== 'all' && row.roomNumber !== svcRoomFilter) return false;
      if (normQ) {
        const hay = normalizeVietnamese(
          `${row.serviceName} ${row.bookingCode} ${row.guestName} P.${row.roomNumber} ${row.groupLabel}`
        );
        if (!hay.includes(normQ)) return false;
      }
      return true;
    });
  }, [rangeRev.serviceDetailRows, svcGroupFilter, svcRoomFilter, svcSearchQuery]);

  const filteredServiceTotal = useMemo(
    () => filteredServiceRows.reduce((s, r) => s + r.total, 0),
    [filteredServiceRows]
  );

  const serviceDetailPag = usePagination(
    filteredServiceRows,
    `${fromDate}|${toDate}|${sourceFilter}|${roomTypeFilter}|${svcGroupFilter}|${svcRoomFilter}|${svcSearchQuery}`,
    20
  );

  const handleExportServiceDetailExcel = () => {
    const data = filteredServiceRows.map((r) => ({
      'Ngày phát sinh': formatDateVN(r.businessDate),
      'Mã đơn': r.bookingCode,
      Phòng: `P.${r.roomNumber}`,
      'Tên khách': r.guestName,
      'Tên món / Dịch vụ': r.serviceName,
      'Phân loại': r.groupLabel,
      'Số lượng': r.quantity,
      'Đơn giá (VNĐ)': r.unitPrice,
      'Thành tiền (VNĐ)': r.total,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DoanhThuDichVu');
    XLSX.writeFile(wb, `LikeFamily_DichVu_${fromDate}_${toDate}.xlsx`);
    notify('Đã xuất file Excel Bảng kê Doanh thu Dịch vụ');
  };

  // Rule 4 & Rule 5: Track Pending Deposits (excluded from revenue!)
  const pendingDepositsTotal = useMemo(
    () =>
      bookings
        .filter((b) => b.depositResolutionStatus === 'pending_deposit_resolution')
        .reduce((s, b) => s + (b.pendingDepositAmount || 0), 0),
    [bookings]
  );

  // Set of original txIds that already have an immutable reversal entry
  const reversedOriginalIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.reversalOfTxId) set.add(t.reversalOfTxId);
    }
    return set;
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (t.date < fromDate || t.date > toDate) return false;
      if (methodFilter !== 'all' && t.method !== methodFilter) return false;
      return true;
    });
  }, [transactions, fromDate, toDate, methodFilter]);

  const cashbookPag = usePagination(
    filteredTransactions,
    `${fromDate}|${toDate}|${methodFilter}`,
    20
  );

  const activeTxs = useMemo(
    () => filteredTransactions.filter((t) => t.status === 'active'),
    [filteredTransactions]
  );

  const metrics = useMemo(() => {
    const roomRev = rangeRev.roomRev;
    const totalRevenue = rangeRev.totalRevenue;
    const unsettledOtaDebt = rangeRev.unsettledOtaDebt;

    // Cash & bank received (excluding ota_debt, internal deposit transfers, fee markers, and reclassifications — Rule 3)
    const totalCashIn = activeTxs
      .filter(
        (t) =>
          t.direction === 'in' &&
          t.method !== 'ota_debt' &&
          t.type !== 'cancellation_fee' &&
          t.type !== 'deposit_transfer_in' &&
          t.type !== 'reclassification_in' &&
          t.type !== 'void_receipt_entry'
      )
      .reduce((s, t) => s + t.amount, 0);
    const totalExpense = activeTxs
      .filter((t) => t.direction === 'out' && t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);
    const netProfit = totalRevenue - totalExpense;

    return {
      roomRev,
      totalRevenue,
      unsettledOtaDebt,
      totalCashIn,
      totalExpense,
      netProfit,
      occupancyPct: rangeRev.occupancyPct,
      adr: rangeRev.adr,
      revPar: rangeRev.revPar,
      soldRoomNights: rangeRev.soldNights,
      hourlyCount: rangeRev.hourlyBookingsCount,
    };
  }, [rangeRev, activeTxs]);

  const chartData = useMemo(() => {
    const map = new Map<string, { date: string; label: string; thu: number; chi: number }>();
    const days = Math.min(31, Math.max(1, diffDays(fromDate, toDate) + 1));
    for (let i = 0; i < days; i++) {
      const d = addDays(toDate, -(days - 1 - i));
      map.set(d, { date: d, label: formatDateVN(d), thu: 0, chi: 0 });
    }
    for (const t of activeTxs) {
      if (
        t.method === 'ota_debt' ||
        t.type === 'reclassification_in' ||
        t.type === 'reclassification_out' ||
        t.type === 'deposit_transfer_in' ||
        t.type === 'deposit_transfer_out' ||
        t.type === 'cancellation_fee'
      ) {
        continue;
      }
      const bucket = map.get(t.date);
      if (!bucket) continue;
      if (t.direction === 'in') bucket.thu += t.amount;
      else bucket.chi += t.amount;
    }
    return Array.from(map.values());
  }, [activeTxs, fromDate, toDate]);

  // Today's Cash Shift Calculation (strictly cash only — never polluted by ota_debt!)
  const today = todayISO();
  const todayCashIn = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            t.status === 'active' && t.date === today && t.method === 'cash' && t.direction === 'in'
        )
        .reduce((s, t) => s + t.amount, 0),
    [transactions, today]
  );
  const todayCashOut = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            t.status === 'active' &&
            t.date === today &&
            t.method === 'cash' &&
            t.direction === 'out'
        )
        .reduce((s, t) => s + t.amount, 0),
    [transactions, today]
  );
  const expectedClosingCash = openingCash + todayCashIn - todayCashOut;

  const handleAddTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (txAmount <= 0) return;
    if (hotelConfig.accountingLockDate && txDate <= hotelConfig.accountingLockDate) {
      notify(
        `Không thể ghi sổ lùi ngày vào kỳ đã khóa sổ (≤ ${formatDateVN(
          hotelConfig.accountingLockDate
        )}). Vui lòng chọn ngày thuộc kỳ đang mở.`,
        'error'
      );
      return;
    }
    try {
      await recordTransaction({
        type: txDirection === 'out' ? 'expense' : 'payment',
        direction: txDirection,
        category: txCategory,
        amount: txAmount,
        method: txMethod,
        date: txDate,
        note: txNote,
        accountingLockDate: hotelConfig.accountingLockDate,
        actor,
      });
      setTxAmount(0);
      setTxNote('');
      notify(`Đã ghi sổ ${txDirection === 'out' ? 'Chi' : 'Thu'} ${formatCurrency(txAmount)}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi ghi sổ thu chi', 'error');
    }
  };

  const handleVoidTx = async (tx: Transaction) => {
    const reason = window.prompt(
      'Giao dịch gốc bị khóa sửa/xóa. Nhập lý do để lập BÚT TOÁN ĐỐI ỨNG hoàn tác:'
    );
    if (!reason || !reason.trim()) return;
    const relatedBooking = tx.bookingId ? bookings.find((b) => b.id === tx.bookingId) : null;
    await voidTransactionWithUndo({ tx, booking: relatedBooking, reason, actor });
    notify('Đã lập bút toán đối ứng (giữ nguyên giao dịch gốc & ghi audit_logs)');
  };

  const handleSaveHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = generateId('shift');
    const actual = actualHandoverCash || expectedClosingCash;
    const handover: ShiftHandover = {
      id,
      shiftDate: today,
      staffUid: actor.uid,
      staffName: actor.name,
      startTime: '07:00',
      endTime: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      openingCash,
      cashInTotal: todayCashIn,
      cashOutTotal: todayCashOut,
      expectedClosingCash,
      actualHandoverCash: actual,
      variance: actual - expectedClosingCash,
      note: handoverNote.trim(),
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'shift_handovers', id), handover);
    setHandoverNote('');
    notify('Đã chốt Sổ Bàn Giao Tiền Mặt Cuối Ca');
  };

  const applyDatePreset = (preset: 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month') => {
    const t = todayISO();
    if (preset === 'today') {
      setFromDate(t);
      setToDate(t);
    } else if (preset === 'yesterday') {
      const y = addDays(t, -1);
      setFromDate(y);
      setToDate(y);
    } else if (preset === '7d') {
      setFromDate(addDays(t, -6));
      setToDate(t);
    } else if (preset === '30d') {
      setFromDate(addDays(t, -29));
      setToDate(t);
    } else if (preset === 'this_month') {
      setFromDate(`${t.slice(0, 7)}-01`);
      setToDate(t);
    } else if (preset === 'last_month') {
      const d = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
      setFromDate(`${y}-${m}-01`);
      setToDate(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
    }
  };

  // Room-Type & Hourly Capacity Breakdown (Single Source of Truth via getRoomRevenueInRange)
  const roomTypeBreakdown = useMemo(() => {
    const rangeDays = Math.max(1, diffDays(fromDate, toDate) + 1);
    return roomTypes.map((rt) => {
      const rtRooms = rooms.filter((r) => r.roomTypeId === rt.id);
      const rtMetrics = getRoomRevenueInRange(bookings, transactions, fromDate, toDate, {
        roomCount: Math.max(1, rtRooms.length),
        sourceFilter,
        roomTypeFilter: rt.id,
      });
      return {
        id: rt.id,
        name: rt.isActive === false ? `${rt.name} (Ngừng SD)` : rt.name,
        roomCount: rtRooms.length,
        availNights: rtRooms.length * rangeDays,
        soldNights: rtMetrics.soldNights,
        hourlyCount: rtMetrics.hourlyBookingsCount,
        hourlyHours: rtMetrics.hourlyHoursTotal,
        occPct: rtRooms.length > 0 ? rtMetrics.occupancyPct : 0,
        rev: rtMetrics.roomRev,
        adr: rtMetrics.adr,
      };
    });
  }, [roomTypes, rooms, bookings, transactions, fromDate, toDate, sourceFilter]);

  // 12-Month Trailing P&L Matrix — Single Source of Truth via getRoomRevenueInRange()
  const monthlyReport = useMemo(() => {
    const curY = Number(today.slice(0, 4));
    const curM = Number(today.slice(5, 7));
    const rows: Array<{
      ym: string;
      label: string;
      isCurrent: boolean;
      bookingCount: number;
      soldNights: number;
      roomRev: number;
      serviceRev: number;
      totalRev: number;
      expense: number;
      profit: number;
      occPct: number;
      adr: number;
      revPar: number;
    }> = [];

    for (let offset = 0; offset < 12; offset++) {
      const dt = new Date(curY, curM - 1 - offset, 1);
      const y = dt.getFullYear();
      const m = dt.getMonth() + 1;
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const daysInMonth = new Date(y, m, 0).getDate();
      const mStart = `${ym}-01`;
      const mEnd = `${ym}-${String(daysInMonth).padStart(2, '0')}`;

      const mRev = getRoomRevenueInRange(bookings, transactions, mStart, mEnd, {
        roomCount: rooms.length,
      });
      const expense = transactions
        .filter(
          (t) =>
            t.status === 'active' &&
            t.direction === 'out' &&
            t.type === 'expense' &&
            t.date.slice(0, 7) === ym
        )
        .reduce((s, t) => s + t.amount, 0);

      rows.push({
        ym,
        label: `${String(m).padStart(2, '0')}/${y}`,
        isCurrent: offset === 0,
        bookingCount: mRev.eligibleBookings.length,
        soldNights: mRev.soldNights,
        roomRev: mRev.roomRev,
        serviceRev: mRev.serviceRev + mRev.forfeitedCancelFees,
        totalRev: mRev.totalRevenue,
        expense,
        profit: mRev.totalRevenue - expense,
        occPct: mRev.occupancyPct,
        adr: mRev.adr,
        revPar: mRev.revPar,
      });
    }
    return rows;
  }, [bookings, transactions, rooms.length, today]);

  const handleExportMonthlyExcel = () => {
    const data = monthlyReport.map((r) => ({
      Tháng: r.label,
      'Số đặt phòng': r.bookingCount,
      'Số đêm': r.soldNights,
      'Tiền phòng (VNĐ)': r.roomRev,
      'Dịch vụ & Phí hủy (VNĐ)': r.serviceRev,
      'Tổng doanh thu (VNĐ)': r.totalRev,
      'Chi phí (VNĐ)': r.expense,
      'Lợi nhuận (VNĐ)': canViewProfit ? r.profit : 'Ẩn theo phân quyền',
      'Lấp đầy (%)': r.occPct,
      'ADR (VNĐ)': r.adr,
      'RevPAR (VNĐ)': r.revPar,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BaoCao12Thang');
    XLSX.writeFile(wb, `LikeFamily_BaoCao12Thang_${today}.xlsx`);
    notify('Đã xuất file Excel Báo cáo 12 tháng');
  };

  return (
    <div className="space-y-5 max-w-full overflow-x-clip">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-auto max-w-full inline-flex flex-wrap gap-2 p-1.5 rounded-xl bg-[#F3F0E9] border border-[#E7E3DA]">
          {[
            { id: 'pnl', label: 'Báo cáo Lãi / Lỗ (P&L) & Công suất' },
            { id: 'monthly', label: 'Báo cáo 12 tháng' },
            { id: 'cashbook', label: 'Sổ Quỹ Thu – Chi' },
            { id: 'handover', label: 'Bàn giao tiền mặt cuối ca' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id as typeof subTab)}
              className={`h-8 px-3.5 rounded-lg text-[13px] font-medium transition-colors ${subTab === t.id ? 'bg-[#0F5132] text-white' : 'text-[#57534E] hover:text-[#1C1B18]'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {hotelConfig.accountingLockDate && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-2.5 flex items-center gap-2 text-[12px] text-[#92400E]">
          <Lock className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          <span>
            Đang áp dụng <strong>Khóa sổ kế toán</strong> đến hết ngày{' '}
            <strong className="font-mono-num">{formatDateVN(hotelConfig.accountingLockDate)}</strong>
            . Không cho phép ghi lùi ngày; mọi điều chỉnh sau kỳ khóa sổ tự động hạch toán vào kỳ
            đang mở.
          </span>
        </div>
      )}

      {subTab !== 'handover' && subTab !== 'monthly' && (
        <div className="bg-white border border-[#E7E3DA] rounded-xl p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-[#8A847C] mr-1">Chọn nhanh kỳ:</span>
            {(
              [
                { id: 'today', label: 'Hôm nay' },
                { id: 'yesterday', label: 'Hôm qua' },
                { id: '7d', label: '7 ngày qua' },
                { id: '30d', label: '30 ngày qua' },
                { id: 'this_month', label: 'Tháng này' },
                { id: 'last_month', label: 'Tháng trước' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyDatePreset(p.id)}
                className="h-7 px-2.5 rounded-lg border border-[#E7E3DA] bg-[#FAF9F6] hover:border-[#0F5132] hover:text-[#0F5132] font-medium text-[#57534E] transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-[12px] max-w-full">
              <span className="text-[#57534E]">Từ</span>
              <DateInputVN value={fromDate} onChange={setFromDate} className="h-9 text-[12px] w-[132px] sm:w-36" />
              <span className="text-[#57534E]">đến</span>
              <DateInputVN value={toDate} onChange={setToDate} className="h-9 text-[12px] w-[132px] sm:w-36" />
            </div>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
            >
              <option value="all">Tất cả nguồn khách</option>
              <option value="ota">Tất cả kênh OTA</option>
              {(hotelConfig.bookingSources || []).map((s) => (
                <option key={s.id} value={s.name}>
                  {s.kind === 'ota' ? `OTA: ${s.name}` : s.name}
                </option>
              ))}
            </select>

            <select
              value={roomTypeFilter}
              onChange={(e) => setRoomTypeFilter(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
            >
              <option value="all">Tất cả loại phòng</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </select>

            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
            >
              <option value="all">Mọi hình thức thanh toán</option>
              <option value="cash">Tiền mặt</option>
              <option value="bank_transfer">Chuyển khoản (VietQR)</option>
              <option value="card">Quẹt thẻ</option>
              <option value="ota_debt">Công nợ OTA</option>
            </select>
          </div>
        </div>
      )}

      {subTab === 'pnl' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-[#E5E2DC] rounded-xl p-4 min-w-0">
              <div className="text-[12px] text-[#57534E]">Tổng doanh thu phòng, DV & phí hủy</div>
              <div className="mt-1 text-[18px] sm:text-[20px] font-semibold font-mono-num text-[#1B5E4B] break-words">
                {formatCurrency(metrics.totalRevenue)}
              </div>
              <div className="text-[11px] text-[#8A847C] font-mono-num mt-0.5">
                Phí hủy giữ cọc: {formatCurrency(forfeitedCancelFees)}
                {pendingDepositsTotal > 0
                  ? ` • Cọc treo (chưa tính DT): ${formatCurrency(pendingDepositsTotal)}`
                  : ''}
              </div>
            </div>

            <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
              <div className="text-[12px] text-[#57534E]">Công nợ OTA chưa về</div>
              <div className="mt-1 text-[20px] font-semibold font-mono-num text-[#C2410C]">
                {formatCurrency(metrics.unsettledOtaDebt)}
              </div>
              <div className="text-[11px] text-[#8A847C] mt-0.5">
                Tách riêng khỏi quỹ tiền mặt tại quầy
              </div>
            </div>

            <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
              <div className="text-[12px] text-[#57534E]">Tổng chi phí vận hành & bảo trì</div>
              <div className="mt-1 text-[20px] font-semibold font-mono-num text-[#B91C1C]">
                {formatCurrency(metrics.totalExpense)}
              </div>
              <div className="text-[11px] text-[#8A847C] mt-0.5">Từ sổ chi phí & bảo trì phòng</div>
            </div>

            <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
              <div className="text-[12px] text-[#57534E]">Lợi nhuận ròng (P&L)</div>
              <div
                className={`mt-1 text-[20px] font-semibold font-mono-num ${!canViewProfit
                  ? 'text-[#8A847C]'
                  : metrics.netProfit >= 0
                    ? 'text-[#15803D]'
                    : 'text-[#B91C1C]'
                  }`}
              >
                {canViewProfit ? formatCurrency(metrics.netProfit) : 'Ẩn theo phân quyền'}
              </div>
              <div className="text-[11px] text-[#8A847C] mt-0.5">Doanh thu - Chi phí</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
              <div className="text-[12px] text-[#57534E]">Công suất phòng (Occupancy)</div>
              <div className="mt-1 text-[22px] font-semibold font-mono-num text-[#1C1B18]">
                {metrics.occupancyPct}%
              </div>
              <div className="text-[11px] text-[#8A847C] font-mono-num">
                {metrics.soldRoomNights} đêm + {metrics.hourlyCount} lượt nghỉ giờ
              </div>
            </div>
            <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
              <div className="text-[12px] text-[#57534E]">Giá phòng trung bình (ADR)</div>
              <div className="mt-1 text-[22px] font-semibold font-mono-num text-[#1C1B18]">
                {formatCurrency(metrics.adr)}
              </div>
              <div className="text-[11px] text-[#8A847C]">Bình quân mỗi đêm đã bán</div>
            </div>
            <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
              <div className="text-[12px] text-[#57534E]">Doanh thu / Phòng khả dụng (RevPAR)</div>
              <div className="mt-1 text-[22px] font-semibold font-mono-num text-[#1B5E4B]">
                {formatCurrency(metrics.revPar)}
              </div>
              <div className="text-[11px] text-[#8A847C]">Trên tổng {rooms.length} phòng đang hoạt động</div>
            </div>
          </div>

          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
            <div className="mb-4">
              <h3 className="text-[14px] font-semibold text-[#1C1B18]">
                Dòng tiền Thực Thu – Chi theo ngày (dd/mm/YYYY)
              </h3>
              <p className="text-[12px] text-[#57534E]">
                Không tính Công nợ OTA chưa thanh toán về tài khoản
              </p>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E2DC" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8A847C' }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#8A847C' }}
                    tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      borderRadius: '10px',
                      border: '1px solid #E5E2DC',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="thu" name="Thực thu" fill="#0F5132" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="chi" name="Chi phí" fill="#D97706" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Room-Type & Hourly Capacity Breakdown Table */}
          <div className="bg-white border border-[#E7E3DA] rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[14px] font-semibold text-[#1C1B18]">
                  Báo cáo Công suất theo Loại phòng &amp; Nghỉ giờ
                </h3>
                <p className="text-[12px] text-[#57534E]">
                  Kỳ {formatDateVN(fromDate)} → {formatDateVN(toDate)} • Chỉ tính đơn lưu trú thực tế
                </p>
              </div>
              <div className="text-[12px] font-mono-num text-[#57534E]">
                Tổng giờ bán:{' '}
                <strong className="text-[#D97706]">
                  {roomTypeBreakdown.reduce((s, r) => s + r.hourlyHours, 0)} giờ
                </strong>{' '}
                ({metrics.hourlyCount} lượt)
              </div>
            </div>

            <div className="overflow-x-auto border border-[#E7E3DA] rounded-xl">
              <table className="w-full text-[12px] min-w-[680px]">
                <thead className="bg-[#FAF9F6] border-b border-[#E7E3DA] text-[#57534E]">
                  <tr>
                    <th className="text-left px-3.5 py-2 font-medium">Loại phòng</th>
                    <th className="text-right px-3.5 py-2 font-medium">Số phòng</th>
                    <th className="text-right px-3.5 py-2 font-medium">Đêm khả dụng</th>
                    <th className="text-right px-3.5 py-2 font-medium">Đêm bán</th>
                    <th className="text-right px-3.5 py-2 font-medium">Nghỉ giờ</th>
                    <th className="text-right px-3.5 py-2 font-medium">% Công suất</th>
                    <th className="text-right px-3.5 py-2 font-medium">Doanh thu phòng</th>
                    <th className="text-right px-3.5 py-2 font-medium">ADR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1EFEA] font-mono-num">
                  {roomTypeBreakdown.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3.5 py-2 font-sans font-medium text-[#1C1B18]">{r.name}</td>
                      <td className="px-3.5 py-2 text-right">{r.roomCount}</td>
                      <td className="px-3.5 py-2 text-right text-[#57534E]">{r.availNights}</td>
                      <td className="px-3.5 py-2 text-right font-semibold text-[#0F5132]">
                        {r.soldNights}
                      </td>
                      <td className="px-3.5 py-2 text-right text-[#D97706]">
                        {r.hourlyCount > 0 ? `${r.hourlyCount} (${r.hourlyHours}h)` : '—'}
                      </td>
                      <td className="px-3.5 py-2 text-right font-semibold">{r.occPct}%</td>
                      <td className="px-3.5 py-2 text-right font-semibold text-[#0F5132]">
                        {formatCurrency(r.rev)}
                      </td>
                      <td className="px-3.5 py-2 text-right">{formatCurrency(r.adr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Service Revenue Breakdown by Group (Food / Drink / Service / Hourly Surcharge) & Multi-Dimensional Detail Table */}
          <div
            data-testid="pnl-service-revenue-section"
            className="bg-white border border-[#E7E3DA] rounded-2xl p-4 sm:p-5 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-semibold text-[#1C1B18]">
                  Cơ cấu Doanh thu Dịch vụ &amp; Bảng kê chi tiết
                </h3>
                <p className="text-[12px] text-[#57534E]">
                  Hạch toán theo ngày phát sinh bất biến ({formatDateVN(fromDate)} →{' '}
                  {formatDateVN(toDate)}) • Tổng doanh thu DV &amp; Phụ thu:{' '}
                  <strong className="font-mono-num text-[#0F5132]">
                    {formatCurrency(rangeRev.serviceRev)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportServiceDetailExcel}
                disabled={filteredServiceRows.length === 0}
                className="min-h-[38px] sm:min-h-0 sm:h-8 px-3 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-40 text-white text-[12px] font-medium inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                Xuất Excel DV ({filteredServiceRows.length})
              </button>
            </div>

            {/* 4 Breakdown Cards: Food, Drink, Service, Surcharge */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              {rangeRev.serviceBreakdownByGroup.map((g) => {
                const isSelected = svcGroupFilter === g.group;
                const accent =
                  g.group === 'food'
                    ? 'text-[#B45309] bg-[#FFFBEB] border-[#FDE68A]'
                    : g.group === 'drink'
                    ? 'text-[#0F5132] bg-[#E8F3EC] border-[#BBF7D0]'
                    : g.group === 'surcharge'
                    ? 'text-[#C2410C] bg-[#FFF7ED] border-[#FED7AA]'
                    : 'text-[#335C67] bg-[#F0F7F9] border-[#BFD5DA]';
                return (
                  <button
                    key={g.group}
                    type="button"
                    data-testid={`service-group-card-${g.group}`}
                    onClick={() =>
                      setSvcGroupFilter((prev) => (prev === g.group ? 'all' : g.group))
                    }
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-[#0F5132] ring-2 ring-[#0F5132]/20 bg-[#FAF9F6]'
                        : 'border-[#E7E3DA] bg-white hover:border-[#0F5132]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${accent}`}
                      >
                        {g.label}
                      </span>
                      <span className="text-[11px] font-mono-num font-semibold text-[#57534E]">
                        {g.sharePct}%
                      </span>
                    </div>
                    <div className="mt-2 text-[16px] sm:text-[18px] font-bold font-mono-num text-[#1C1B18] break-words">
                      {formatCurrency(g.revenue)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#8A847C] font-mono-num">
                      {g.count} lượt bán • SL: {g.quantity}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Multi-Dimensional Filter Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="sm:col-span-5 flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: 'Tất cả' },
                    { id: 'food', label: 'Thức ăn' },
                    { id: 'drink', label: 'Đồ uống' },
                    { id: 'service', label: 'Dịch vụ' },
                    { id: 'surcharge', label: 'Phụ thu giờ' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`service-filter-pill-${opt.id}`}
                    onClick={() => setSvcGroupFilter(opt.id)}
                    className={`min-h-[36px] sm:min-h-0 sm:h-8 px-2.5 rounded-lg text-[12px] font-medium transition-colors ${
                      svcGroupFilter === opt.id
                        ? 'bg-[#0F5132] text-white'
                        : 'bg-[#F3F0E9] text-[#57534E] hover:text-[#1C1B18]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <select
                aria-label="Lọc dịch vụ theo phòng"
                value={svcRoomFilter}
                onChange={(e) => setSvcRoomFilter(e.target.value)}
                className="sm:col-span-3 min-h-[40px] sm:min-h-0 sm:h-8 px-2.5 rounded-lg border border-[#E7E3DA] bg-white text-[12px]"
              >
                <option value="all">Tất cả phòng</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.roomNumber}>
                    P.{r.roomNumber} ({r.floor})
                  </option>
                ))}
              </select>

              <div className="sm:col-span-4 relative">
                <Search
                  className="w-3.5 h-3.5 text-[#8A847C] absolute left-2.5 top-1/2 -translate-y-1/2"
                  strokeWidth={1.5}
                />
                <input
                  type="text"
                  value={svcSearchQuery}
                  onChange={(e) => setSvcSearchQuery(e.target.value)}
                  placeholder="Tìm tên món, mã đơn, khách..."
                  data-testid="service-detail-search-input"
                  className="w-full min-h-[40px] sm:min-h-0 sm:h-8 pl-8 pr-3 rounded-lg border border-[#E7E3DA] bg-white text-[12px] focus:outline-none focus:border-[#0F5132]"
                />
              </div>
            </div>

            {/* Detailed Service Ledger Table */}
            <div className="overflow-x-auto border border-[#E7E3DA] rounded-xl">
              <table className="w-full text-[12px] min-w-[760px]">
                <thead className="bg-[#FAF9F6] border-b border-[#E7E3DA] text-[#57534E]">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Ngày phát sinh</th>
                    <th className="text-left px-3 py-2 font-medium">Mã đơn</th>
                    <th className="text-left px-3 py-2 font-medium">Phòng</th>
                    <th className="text-left px-3 py-2 font-medium">Tên khách</th>
                    <th className="text-left px-3 py-2 font-medium">Tên món / Dịch vụ</th>
                    <th className="text-left px-3 py-2 font-medium">Phân loại</th>
                    <th className="text-right px-3 py-2 font-medium">SL</th>
                    <th className="text-right px-3 py-2 font-medium">Đơn giá</th>
                    <th className="text-right px-3 py-2 font-medium">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1EFEA]">
                  {filteredServiceRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center text-[#8A847C]">
                        Không có giao dịch dịch vụ nào khớp bộ lọc trong kỳ này.
                      </td>
                    </tr>
                  ) : (
                    serviceDetailPag.pageItems.map((r) => (
                      <tr key={r.id} className="hover:bg-[#FAF9F6]">
                        <td className="px-3 py-2 font-mono-num text-[#57534E]">
                          {formatDateVN(r.businessDate)}
                        </td>
                        <td className="px-3 py-2 font-mono-num font-medium text-[#1C1B18]">
                          {r.bookingCode}
                        </td>
                        <td className="px-3 py-2 font-mono-num font-semibold text-[#0F5132]">
                          P.{r.roomNumber}
                        </td>
                        <td className="px-3 py-2 text-[#1C1B18]">{r.guestName}</td>
                        <td className="px-3 py-2 font-medium text-[#1C1B18]">{r.serviceName}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              r.group === 'food'
                                ? 'bg-[#FFFBEB] text-[#B45309]'
                                : r.group === 'drink'
                                ? 'bg-[#E8F3EC] text-[#0F5132]'
                                : r.group === 'surcharge'
                                ? 'bg-[#FFF7ED] text-[#C2410C]'
                                : 'bg-[#F0F7F9] text-[#335C67]'
                            }`}
                          >
                            {r.groupLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono-num">{r.quantity}</td>
                        <td className="px-3 py-2 text-right font-mono-num text-[#57534E]">
                          {formatCurrency(r.unitPrice)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-num font-semibold text-[#0F5132]">
                          {formatCurrency(r.total)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredServiceRows.length > 0 && (
                  <tfoot className="bg-[#FAF9F6] border-t border-[#E7E3DA] font-semibold">
                    <tr>
                      <td colSpan={6} className="px-3 py-2.5 text-[#1C1B18]">
                        Tổng cộng toàn bộ bộ lọc ({filteredServiceRows.length} dòng)
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-num">
                        {filteredServiceRows.reduce((s, r) => s + r.quantity, 0)}
                      </td>
                      <td className="px-3 py-2.5" />
                      <td
                        data-testid="finance-service-footer-total"
                        className="px-3 py-2.5 text-right font-mono-num text-[#0F5132]"
                      >
                        {formatCurrency(filteredServiceTotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <PaginationBar
              testId="finance-service-pagination"
              page={serviceDetailPag.page}
              pageSize={serviceDetailPag.pageSize}
              totalItems={serviceDetailPag.totalItems}
              onPageChange={serviceDetailPag.setPage}
              onPageSizeChange={serviceDetailPag.setPageSize}
            />
          </div>
        </div>
      )}

      {/* SUBTAB: 12-MONTH P&L REPORT MATRIX (GoHost-inspired Báo cáo Tháng) */}
      {subTab === 'monthly' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">Tổng doanh thu 12T</div>
              <div className="mt-1 text-[19px] font-bold font-mono-num text-[#0F5132]">
                {formatCurrency(monthlyReport.reduce((s, r) => s + r.totalRev, 0))}
              </div>
            </div>
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">Tổng chi phí 12T</div>
              <div className="mt-1 text-[19px] font-bold font-mono-num text-[#B91C1C]">
                {formatCurrency(monthlyReport.reduce((s, r) => s + r.expense, 0))}
              </div>
            </div>
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">Lợi nhuận 12T</div>
              <div className="mt-1 text-[19px] font-bold font-mono-num text-[#0F5132]">
                {canViewProfit
                  ? formatCurrency(monthlyReport.reduce((s, r) => s + r.profit, 0))
                  : 'Ẩn theo quyền'}
              </div>
            </div>
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">Tổng đêm đã bán</div>
              <div className="mt-1 text-[19px] font-bold font-mono-num text-[#1C1B18]">
                {monthlyReport.reduce((s, r) => s + r.soldNights, 0)} đêm
              </div>
            </div>
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium text-[#8A847C] uppercase">Lấp đầy TB</div>
                <div className="mt-1 text-[19px] font-bold font-mono-num text-[#1C1B18]">
                  {(
                    monthlyReport.reduce((s, r) => s + r.occPct, 0) /
                    Math.max(1, monthlyReport.length)
                  ).toFixed(1)}
                  %
                </div>
              </div>
              <button
                type="button"
                onClick={handleExportMonthlyExcel}
                className="h-9 px-3 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[12px] font-medium inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                Excel
              </button>
            </div>
          </div>

          <div className="bg-white border border-[#E7E3DA] rounded-2xl overflow-x-auto">
            <table className="w-full text-[12px] min-w-[920px]">
              <thead className="bg-[#FAF9F6] border-b border-[#E7E3DA] text-[#57534E]">
                <tr>
                  <th className="text-left px-3.5 py-2.5 font-medium">Tháng</th>
                  <th className="text-right px-3 py-2.5 font-medium">Số ĐP</th>
                  <th className="text-right px-3 py-2.5 font-medium">Số đêm</th>
                  <th className="text-right px-3 py-2.5 font-medium">Tiền phòng</th>
                  <th className="text-right px-3 py-2.5 font-medium">DV &amp; Phí hủy</th>
                  <th className="text-right px-3 py-2.5 font-medium">Tổng doanh thu</th>
                  <th className="text-right px-3 py-2.5 font-medium">Chi phí</th>
                  <th className="text-right px-3 py-2.5 font-medium">Lợi nhuận</th>
                  <th className="text-right px-3 py-2.5 font-medium">Lấp đầy</th>
                  <th className="text-right px-3 py-2.5 font-medium">ADR</th>
                  <th className="text-right px-3 py-2.5 font-medium">RevPAR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EFEA] font-mono-num">
                {monthlyReport.map((r) => (
                  <tr key={r.ym} className="hover:bg-[#FAF9F6]">
                    <td className="px-3.5 py-2.5 font-semibold text-[#1C1B18]">
                      {r.label}
                      {r.isCurrent && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[#FFFBEB] text-[#B45309] font-sans text-[10px] font-medium">
                          Tạm tính
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">{r.bookingCount}</td>
                    <td className="px-3 py-2.5 text-right">{r.soldNights}</td>
                    <td className="px-3 py-2.5 text-right">{formatCurrency(r.roomRev)}</td>
                    <td className="px-3 py-2.5 text-right">{formatCurrency(r.serviceRev)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-[#0F5132]">
                      {formatCurrency(r.totalRev)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#B91C1C]">
                      {formatCurrency(r.expense)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-semibold ${!canViewProfit
                        ? 'text-[#8A847C] font-sans font-normal'
                        : r.profit >= 0
                          ? 'text-[#0F5132]'
                          : 'text-[#B91C1C]'
                        }`}
                    >
                      {canViewProfit ? formatCurrency(r.profit) : 'Ẩn'}
                    </td>
                    <td className="px-3 py-2.5 text-right">{r.occPct}%</td>
                    <td className="px-3 py-2.5 text-right">{formatCurrency(r.adr)}</td>
                    <td className="px-3 py-2.5 text-right text-[#57534E]">
                      {formatCurrency(r.revPar)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#FAF9F6] border-t-2 border-[#E7E3DA] font-mono-num font-bold">
                <tr>
                  <td className="px-3.5 py-2.5 font-sans text-[#1C1B18]">TỔNG 12 THÁNG</td>
                  <td className="px-3 py-2.5 text-right">
                    {monthlyReport.reduce((s, r) => s + r.bookingCount, 0)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {monthlyReport.reduce((s, r) => s + r.soldNights, 0)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {formatCurrency(monthlyReport.reduce((s, r) => s + r.roomRev, 0))}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {formatCurrency(monthlyReport.reduce((s, r) => s + r.serviceRev, 0))}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#0F5132]">
                    {formatCurrency(monthlyReport.reduce((s, r) => s + r.totalRev, 0))}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#B91C1C]">
                    {formatCurrency(monthlyReport.reduce((s, r) => s + r.expense, 0))}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#0F5132]">
                    {canViewProfit
                      ? formatCurrency(monthlyReport.reduce((s, r) => s + r.profit, 0))
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">—</td>
                  <td className="px-3 py-2.5 text-right">—</td>
                  <td className="px-3 py-2.5 text-right">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {subTab === 'cashbook' && (
        <div className="space-y-4">
          <form
            onSubmit={handleAddTx}
            className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3"
          >
            <div className="text-[14px] font-semibold text-[#1C1B18]">
              Lập phiếu Chi phí vận hành / Thu ngoài
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
              <select
                value={txDirection}
                onChange={(e) => setTxDirection(e.target.value as 'in' | 'out')}
                className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="out">Phiếu CHI</option>
                <option value="in">Phiếu THU</option>
              </select>
              <select
                value={txCategory}
                onChange={(e) => setTxCategory(e.target.value)}
                className="sm:col-span-2 h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                {hotelConfig.expenseCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="Thu dịch vụ ngoài">Thu dịch vụ ngoài</option>
              </select>
              <input
                type="number"
                min={0}
                step={10000}
                required
                value={txAmount || ''}
                onChange={(e) => setTxAmount(Number(e.target.value) || 0)}
                placeholder="Số tiền (VNĐ)"
                className="h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
              />
              <select
                value={txMethod}
                onChange={(e) => setTxMethod(e.target.value as PaymentMethod)}
                className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="cash">Tiền mặt</option>
                <option value="bank_transfer">Chuyển khoản (VietQR)</option>
                <option value="card">Quẹt thẻ</option>
                <option value="ota_debt">Công nợ OTA</option>
              </select>
              <DateInputVN value={txDate} onChange={setTxDate} />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={txNote}
                onChange={(e) => setTxNote(e.target.value)}
                placeholder="Diễn giải chi tiết khoản thu/chi..."
                className="flex-1 h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
              />
              <button
                type="submit"
                className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                Ghi sổ quỹ
              </button>
            </div>
          </form>

          <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-x-auto">
            <table className="w-full text-[12px] min-w-[760px]">
              <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Ngày</th>
                  <th className="text-left px-4 py-2.5 font-medium">Hạng mục / Ghi chú</th>
                  <th className="text-left px-4 py-2.5 font-medium">Phương thức</th>
                  <th className="text-left px-4 py-2.5 font-medium">Nhân viên</th>
                  <th className="text-right px-4 py-2.5 font-medium">Số tiền</th>
                  <th className="text-right px-4 py-2.5 font-medium">Hoàn tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EFEA]">
                {cashbookPag.pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#8A847C]">
                      Không có giao dịch thu chi nào trong kỳ đã chọn.
                    </td>
                  </tr>
                ) : (
                  cashbookPag.pageItems.map((tx) => (
                  <tr
                    key={tx.id}
                    className={tx.status === 'voided_by_undo' ? 'opacity-45 bg-[#FAF9F6]' : ''}
                  >
                    <td className="px-4 py-2.5 font-mono-num">{formatDateVN(tx.date)}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#1C1B18]">
                        {tx.category}
                        {tx.roomNumber ? ` (P.${tx.roomNumber})` : ''}
                      </div>
                      <div className="text-[11px] text-[#8A847C]">
                        {tx.note || tx.bookingCode || '—'}
                        {tx.status === 'voided_by_undo' && ` • ĐÃ HỦY: ${tx.voidReason}`}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">{getPaymentMethodLabel(tx.method)}</td>
                    <td className="px-4 py-2.5 text-[#57534E]">{tx.createdByName}</td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono-num font-semibold ${tx.status === 'voided_by_undo'
                        ? 'line-through text-[#8A847C]'
                        : tx.method === 'ota_debt'
                          ? 'text-[#C2410C]'
                          : tx.direction === 'in'
                            ? 'text-[#15803D]'
                            : 'text-[#B91C1C]'
                        }`}
                    >
                      {tx.direction === 'in' ? '+' : '-'}
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                        {tx.type === 'reclassification_in' || tx.type === 'reclassification_out' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#EFF6FF] text-[#1D4ED8]">
                            Chuyển PTTT
                          </span>
                        ) : tx.type === 'void_receipt_entry' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C]">
                            Hủy phiếu thu
                          </span>
                        ) : tx.type === 'post_checkout_adjustment' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#E8F2EE] text-[#1B5E4B]">
                            Điều chỉnh sau CO
                          </span>
                        ) : reversedOriginalIds.has(tx.id) ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#F1EFEA] text-[#57534E]">
                            Đã đối ứng
                          </span>
                        ) : tx.type === 'reversal' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#FFFBEB] text-[#92400E]">
                            Bút toán đối ứng
                          </span>
                        ) : (
                          <>
                            {tx.status === 'active' &&
                              isAdmin &&
                              tx.method !== 'ota_debt' &&
                              tx.type !== 'deposit_transfer_in' &&
                              tx.type !== 'deposit_transfer_out' &&
                              tx.type !== 'cancellation_fee' && (
                                <button
                                  type="button"
                                  onClick={() => setReclassifyingTx(tx)}
                                  className="h-7 px-2 rounded-md border border-[#E5E2DC] hover:border-[#1B5E4B] hover:text-[#1B5E4B] text-[11px] inline-flex items-center gap-1"
                                  title="Chuyển đổi phương thức thanh toán bằng bút toán điều chỉnh (không tạo thu/chi giả)"
                                >
                                  <ArrowRightLeft className="w-3 h-3" strokeWidth={1.5} />
                                  Đổi PTTT
                                </button>
                              )}
                            {tx.status === 'active' && staffProfile?.permissions.canUndoAction && (
                              <button
                                type="button"
                                onClick={() => handleVoidTx(tx)}
                                className="h-7 px-2 rounded-md border border-[#E5E2DC] hover:border-[#B91C1C] hover:text-[#B91C1C] text-[11px] inline-flex items-center gap-1"
                              >
                                <RotateCcw className="w-3 h-3" strokeWidth={1.5} />
                                Đối ứng
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
                )}
              </tbody>
              {filteredTransactions.length > 0 && (
                <tfoot className="bg-[#FAF9F6] border-t border-[#E5E2DC] font-semibold text-[12px]">
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-[#57534E]">
                      Tổng toàn bộ bộ lọc ({filteredTransactions.length} bút toán • Thực thu:{' '}
                      <span className="font-mono-num text-[#15803D]">
                        +{formatCurrency(metrics.totalCashIn)}
                      </span>{' '}
                      • Chi phí:{' '}
                      <span className="font-mono-num text-[#B91C1C]">
                        -{formatCurrency(metrics.totalExpense)}
                      </span>
                      )
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num text-[#1C1B18]">
                      {formatCurrency(metrics.totalCashIn - metrics.totalExpense)}
                    </td>
                    <td className="px-4 py-2.5" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <PaginationBar
            testId="finance-cashbook-pagination"
            page={cashbookPag.page}
            pageSize={cashbookPag.pageSize}
            totalItems={cashbookPag.totalItems}
            onPageChange={cashbookPag.setPage}
            onPageSizeChange={cashbookPag.setPageSize}
          />
        </div>
      )}

      {subTab === 'handover' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form
            onSubmit={handleSaveHandover}
            className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1C1B18]">
              <Wallet className="w-5 h-5 text-[#1B5E4B]" strokeWidth={1.5} />
              Chốt Sổ Bàn Giao Tiền Mặt Ca Hôm Nay ({formatDateVN(today)})
            </div>

            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC]">
                <div className="text-[11px] text-[#57534E]">Thu tiền mặt trong ngày</div>
                <div className="font-mono-num font-semibold text-[#15803D] mt-0.5">
                  +{formatCurrency(todayCashIn)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC]">
                <div className="text-[11px] text-[#57534E]">Chi tiền mặt trong ngày</div>
                <div className="font-mono-num font-semibold text-[#B91C1C] mt-0.5">
                  -{formatCurrency(todayCashOut)}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Quỹ tiền mặt đầu ca</label>
                <input
                  type="number"
                  min={0}
                  step={50000}
                  value={openingCash}
                  onChange={(e) => setOpeningCash(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                />
              </div>

              <div className="p-3 rounded-xl bg-[#E8F2EE] text-[#1B5E4B] flex items-center justify-between text-[13px]">
                <span>Tồn quỹ tiền mặt lý thuyết cuối ca</span>
                <strong className="font-mono-num text-[15px]">
                  {formatCurrency(expectedClosingCash)}
                </strong>
              </div>

              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">
                  Tiền mặt thực tế kiểm đếm bàn giao
                </label>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={actualHandoverCash || ''}
                  onChange={(e) => setActualHandoverCash(Number(e.target.value) || 0)}
                  placeholder={String(expectedClosingCash)}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                />
              </div>

              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Ghi chú bàn giao ca</label>
                <input
                  type="text"
                  value={handoverNote}
                  onChange={(e) => setHandoverNote(e.target.value)}
                  placeholder="Khách P.302 hẹn thanh toán sáng mai..."
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full h-9 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium"
            >
              Xác nhận chốt bàn giao ca ({actor.name})
            </button>
          </form>

          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3">
            <h3 className="text-[14px] font-semibold text-[#1C1B18]">
              Lịch sử bàn giao ca ({shiftHandovers.length})
            </h3>
            <div className="divide-y divide-[#E5E2DC] border border-[#E5E2DC] rounded-xl max-h-[420px] overflow-y-auto">
              {shiftHandovers.length === 0 ? (
                <div className="p-6 text-center text-[12px] text-[#8A847C]">
                  Chưa có biên bản bàn giao ca nào.
                </div>
              ) : (
                shiftHandovers.map((h) => (
                  <div key={h.id} className="p-3.5 text-[12px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#1C1B18]">
                        {formatDateVN(h.shiftDate)} • {h.staffName}
                      </span>
                      <span className="font-mono-num font-semibold text-[#1B5E4B]">
                        {formatCurrency(h.actualHandoverCash)}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono-num text-[#57534E]">
                      Đầu ca: {formatCurrency(h.openingCash)} | Thu: +{formatCurrency(h.cashInTotal)}{' '}
                      | Chi: -{formatCurrency(h.cashOutTotal)} | Lệch:{' '}
                      <span className={h.variance !== 0 ? 'text-[#B91C1C] font-semibold' : ''}>
                        {formatCurrency(h.variance)}
                      </span>
                    </div>
                    {h.note && <div className="text-[11px] text-[#8A847C]">{h.note}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {reclassifyingTx && (
        <ReclassifyPaymentModal
          tx={reclassifyingTx}
          onClose={() => setReclassifyingTx(null)}
        />
      )}
    </div>
  );
};
