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
import { ArrowRightLeft, Lock, Plus, RotateCcw, Wallet } from 'lucide-react';
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
  isBookingEligibleForPnLRevenue,
  todayISO,
} from '../lib/utils';
import { recordTransaction, voidTransactionWithUndo } from '../lib/pmsActions';
import { DateInputVN } from './DateInputVN';
import { ReclassifyPaymentModal } from './ReclassifyPaymentModal';

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

  const [subTab, setSubTab] = useState<'pnl' | 'cashbook' | 'handover'>('pnl');
  const [reclassifyingTx, setReclassifyingTx] = useState<Transaction | null>(null);

  const [fromDate, setFromDate] = useState(() => addDays(todayISO(), -29));
  const [toDate, setToDate] = useState(() => todayISO());
  const [sourceFilter, setSourceFilter] = useState('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');

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

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (!isBookingEligibleForPnLRevenue(b, bookings, transactions)) return false;
      if (b.checkOut <= fromDate || b.checkIn > toDate) return false;
      if (sourceFilter !== 'all') {
        if (sourceFilter === 'ota' && b.source !== 'ota') return false;
        if (
          sourceFilter !== 'ota' &&
          b.source !== sourceFilter &&
          b.otaChannel !== sourceFilter &&
          b.sourceLabel !== sourceFilter
        )
          return false;
      }
      if (roomTypeFilter !== 'all' && b.roomTypeId !== roomTypeFilter) return false;
      return true;
    });
  }, [bookings, transactions, fromDate, toDate, sourceFilter, roomTypeFilter]);

  // Rule 4 & Rule 5: Track Pending Deposits (excluded from revenue!) & Explicit Forfeited Cancellation Fees
  const pendingDepositsTotal = useMemo(
    () =>
      bookings
        .filter((b) => b.depositResolutionStatus === 'pending_deposit_resolution')
        .reduce((s, b) => s + (b.pendingDepositAmount || 0), 0),
    [bookings]
  );

  const forfeitedCancelFees = useMemo(
    () =>
      bookings
        .filter(
          (b) =>
            (b.status === 'cancelled' || b.status === 'no_show') &&
            b.depositResolutionStatus === 'forfeited_fee' &&
            (b.depositResolvedAt || b.cancelledAt || '').slice(0, 10) >= fromDate &&
            (b.depositResolvedAt || b.cancelledAt || '').slice(0, 10) <= toDate
        )
        .reduce((s, b) => s + (b.forfeitedFeeAmount || 0), 0),
    [bookings, fromDate, toDate]
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

  const activeTxs = useMemo(
    () => filteredTransactions.filter((t) => t.status === 'active'),
    [filteredTransactions]
  );

  const metrics = useMemo(() => {
    const roomRev = filteredBookings.reduce((s, b) => s + (b.grossRoomTotal || 0), 0);
    const serviceRev = filteredBookings.reduce(
      (s, b) => s + (b.serviceTotal || 0) + (b.hourlySurcharge || 0),
      0
    );
    // Only explicit forfeited cancellation fees count into revenue; NEVER pending_deposit_resolution!
    const totalRevenue = roomRev + serviceRev + forfeitedCancelFees;

    const unsettledOtaDebt = filteredBookings
      .filter(
        (b) =>
          (b.source === 'ota' || b.paymentMethod === 'ota_debt') &&
          b.otaSettlementStatus !== 'settled'
      )
      .reduce((s, b) => s + (b.grossRoomTotal || 0), 0);

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

    const rangeDays = Math.max(1, diffDays(fromDate, toDate) + 1);
    const totalRoomNightsAvailable = Math.max(1, rooms.length * rangeDays);
    const soldRoomNights = filteredBookings.reduce(
      (s, b) => s + (b.bookingMode === 'hourly' ? 0 : b.nights || 0),
      0
    );
    const hourlyCount = filteredBookings.filter((b) => b.bookingMode === 'hourly').length;
    const occupancyPct = Math.min(100, Math.round((soldRoomNights / totalRoomNightsAvailable) * 100));
    const adr = soldRoomNights > 0 ? Math.round(roomRev / soldRoomNights) : 0;
    const revPar = Math.round(roomRev / totalRoomNightsAvailable);

    return {
      roomRev,
      totalRevenue,
      unsettledOtaDebt,
      totalCashIn,
      totalExpense,
      netProfit,
      occupancyPct,
      adr,
      revPar,
      soldRoomNights,
      hourlyCount,
    };
  }, [filteredBookings, forfeitedCancelFees, activeTxs, rooms.length, fromDate, toDate]);

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
    await recordTransaction({
      type: txDirection === 'out' ? 'expense' : 'payment',
      direction: txDirection,
      category: txCategory,
      amount: txAmount,
      method: txMethod,
      date: txDate,
      note: txNote,
      actor,
    });
    setTxAmount(0);
    setTxNote('');
    notify(`Đã ghi sổ ${txDirection === 'out' ? 'Chi' : 'Thu'} ${formatCurrency(txAmount)}`);
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-[#EAE7E0]">
          {[
            { id: 'pnl', label: 'Báo cáo Lãi / Lỗ (P&L) & KPI' },
            { id: 'cashbook', label: 'Sổ Quỹ Thu – Chi' },
            { id: 'handover', label: 'Bàn giao tiền mặt cuối ca' },
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

      {subTab !== 'handover' && (
        <div className="bg-white border border-[#E5E2DC] rounded-xl p-3 flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="text-[#57534E]">Từ</span>
            <DateInputVN value={fromDate} onChange={setFromDate} className="h-8 text-[12px] w-36" />
            <span className="text-[#57534E]">đến</span>
            <DateInputVN value={toDate} onChange={setToDate} className="h-8 text-[12px] w-36" />
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
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
            className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
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
            className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
          >
            <option value="all">Mọi hình thức thanh toán</option>
            <option value="cash">Tiền mặt</option>
            <option value="bank_transfer">Chuyển khoản (VietQR)</option>
            <option value="card">Quẹt thẻ</option>
            <option value="ota_debt">Công nợ OTA</option>
          </select>
        </div>
      )}

      {subTab === 'pnl' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
              <div className="text-[12px] text-[#57534E]">Tổng doanh thu phòng, DV & phí hủy</div>
              <div className="mt-1 text-[20px] font-semibold font-mono-num text-[#1B5E4B]">
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
                className={`mt-1 text-[20px] font-semibold font-mono-num ${
                  !canViewProfit
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

          <div className="grid grid-cols-3 gap-3">
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
                  <Bar dataKey="thu" name="Thực thu" fill="#1B5E4B" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="chi" name="Chi phí" fill="#C7C1B7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
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
                {filteredTransactions.map((tx) => (
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
                      className={`px-4 py-2.5 text-right font-mono-num font-semibold ${
                        tx.status === 'voided_by_undo'
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
                ))}
              </tbody>
            </table>
          </div>
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
