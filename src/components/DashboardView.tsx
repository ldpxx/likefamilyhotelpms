import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Clock,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePms } from '../context/PmsContext';
import type { Booking } from '../types/pms';
import {
  addDays,
  diffDays,
  formatCurrency,
  formatDateVN,
  formatShortDate,
  getBookingGuestBalance,
  getSourceLabel,
  isBookingBlockingCalendar,
  todayISO,
} from '../lib/utils';
import { getRoomRevenueInRange } from '../lib/revenueMetrics';

interface DashboardViewProps {
  onSelectBooking: (booking: Booking) => void;
  onOpenNewSingle: () => void;
  onOpenNewGroup: () => void;
  onGoToFinder: () => void;
  onGoToRooms: () => void;
  onGoToCalendar: () => void;
}

type PeriodKey = 'today' | 'yesterday' | '7d' | '30d' | 'this_month';
type QueueTab = 'arriving' | 'departing' | 'in_house' | 'pending_deposit' | 'asm_alert';

function calcDeltaPct(current: number, prev: number): number | null {
  if (prev === 0 && current === 0) return null;
  if (prev === 0) return 100;
  return Math.round(((current - prev) / prev) * 100);
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onSelectBooking,
  onOpenNewSingle,
  onOpenNewGroup,
  onGoToFinder,
  onGoToRooms,
  onGoToCalendar,
}) => {
  const { activeRooms: rooms, bookings, transactions, hotelConfig, staffProfile } = usePms();
  const today = todayISO();

  const [period, setPeriod] = useState<PeriodKey>('today');
  const [queueTab, setQueueTab] = useState<QueueTab>('arriving');

  // Compute current & comparison date ranges
  const { fromDate, toDate, prevFrom, prevTo, rangeLabel } = useMemo(() => {
    if (period === 'today') {
      return {
        fromDate: today,
        toDate: today,
        prevFrom: addDays(today, -7),
        prevTo: addDays(today, -7),
        rangeLabel: `Hôm nay ${formatShortDate(today)} · so với ${formatShortDate(addDays(today, -7))}`,
      };
    }
    if (period === 'yesterday') {
      const y = addDays(today, -1);
      return {
        fromDate: y,
        toDate: y,
        prevFrom: addDays(y, -7),
        prevTo: addDays(y, -7),
        rangeLabel: `Hôm qua ${formatShortDate(y)} · so với ${formatShortDate(addDays(y, -7))}`,
      };
    }
    if (period === '7d') {
      const f = addDays(today, -6);
      return {
        fromDate: f,
        toDate: today,
        prevFrom: addDays(f, -7),
        prevTo: addDays(f, -1),
        rangeLabel: `7 ngày qua (${formatShortDate(f)} – ${formatShortDate(today)})`,
      };
    }
    if (period === 'this_month') {
      const monthStart = `${today.slice(0, 7)}-01`;
      const daysSoFar = Math.max(1, diffDays(monthStart, today) + 1);
      const pEnd = addDays(monthStart, -1);
      const pStart = addDays(pEnd, -(daysSoFar - 1));
      return {
        fromDate: monthStart,
        toDate: today,
        prevFrom: pStart,
        prevTo: pEnd,
        rangeLabel: `Tháng này (${formatShortDate(monthStart)} – ${formatShortDate(today)})`,
      };
    }
    const f30 = addDays(today, -29);
    return {
      fromDate: f30,
      toDate: today,
      prevFrom: addDays(f30, -30),
      prevTo: addDays(f30, -1),
      rangeLabel: `30 ngày qua (${formatShortDate(f30)} – ${formatShortDate(today)})`,
    };
  }, [period, today]);

  // Period KPI aggregator — Single Source of Truth via getRoomRevenueInRange() (v2.2.1 #1)
  const computePeriodKpis = (start: string, end: string) => {
    const m = getRoomRevenueInRange(bookings, transactions, start, end, {
      roomCount: rooms.length,
    });
    return {
      totalRev: m.totalRevenue,
      roomRev: m.roomRev,
      serviceRev: m.serviceRev + m.forfeitedCancelFees,
      bookingCount: m.eligibleBookings.length,
      nightsSold: m.soldNights,
      hourlyCount: m.hourlyBookingsCount,
      occPct: m.occupancyPct,
      adr: m.adr,
      revPar: m.revPar,
      sourceBreakdown: m.bySource.slice(0, 6),
    };
  };

  const currentKpi = useMemo(
    () => computePeriodKpis(fromDate, toDate),
    [bookings, transactions, rooms.length, fromDate, toDate]
  );
  const prevKpi = useMemo(
    () => computePeriodKpis(prevFrom, prevTo),
    [bookings, transactions, rooms.length, prevFrom, prevTo]
  );

  // 14-day Trailing Revenue & Occupancy Chart — Single Source of Truth via getRoomRevenueInRange()
  const chart14Days = useMemo(() => {
    const arr: Array<{ date: string; label: string; doanhThu: number; lapDay: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(today, -i);
      const dayMetrics = getRoomRevenueInRange(bookings, transactions, d, d, {
        roomCount: rooms.length,
      });
      arr.push({
        date: d,
        label: formatShortDate(d),
        doanhThu: dayMetrics.roomRev,
        lapDay: Math.round(dayMetrics.occupancyPct),
      });
    }
    return arr;
  }, [bookings, transactions, rooms.length, today]);

  // 30-Day Forward Occupancy Forecast Strip (GoHost-inspired heat strip in Forest Emerald)
  const forward30Days = useMemo(() => {
    const totalRooms = Math.max(1, rooms.length);
    const out: Array<{ date: string; dayNum: string; pct: number; sold: number }> = [];
    for (let i = 1; i <= 30; i++) {
      const d = addDays(today, i);
      const occSet = new Set<string>();
      for (const b of bookings) {
        if (!isBookingBlockingCalendar(b.status)) continue;
        if (b.checkIn <= d && b.checkOut > d) occSet.add(b.roomId);
      }
      out.push({
        date: d,
        dayNum: d.slice(8, 10),
        sold: occSet.size,
        pct: Math.round((occSet.size / totalRooms) * 100),
      });
    }
    return out;
  }, [bookings, rooms.length, today]);

  const avgForward30Pct = useMemo(
    () =>
      Math.round(
        forward30Days.reduce((s, d) => s + d.pct, 0) / Math.max(1, forward30Days.length)
      ),
    [forward30Days]
  );

  // Operational Queue Lists
  const queues = useMemo(() => {
    const arriving = bookings.filter((b) => b.status === 'reserved' && b.checkIn === today);
    const departing = bookings.filter((b) => b.status === 'in_house' && b.checkOut === today);
    const in_house = bookings.filter((b) => b.status === 'in_house');
    const pending_deposit = bookings.filter(
      (b) => b.depositResolutionStatus === 'pending_deposit_resolution'
    );
    const asm_alert = bookings.filter(
      (b) => b.status === 'in_house' && (b.hasPendingAsm || b.hasStayPermitAlert)
    );
    return { arriving, departing, in_house, pending_deposit, asm_alert };
  }, [bookings, today]);

  const activeQueueList = queues[queueTab];
  const activeQueueReceivable = activeQueueList.reduce(
    (s, b) => s + Math.max(0, getBookingGuestBalance(b)),
    0
  );

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';

  const revDelta = calcDeltaPct(currentKpi.totalRev, prevKpi.totalRev);
  const adrDelta = calcDeltaPct(currentKpi.adr, prevKpi.adr);
  const revParDelta = calcDeltaPct(currentKpi.revPar, prevKpi.revPar);
  const occDelta = Math.round((currentKpi.occPct - prevKpi.occPct) * 10) / 10;

  return (
    <div className="space-y-5">
      {/* Top Greeting & 1-Click Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-bold text-[#1C1B18]">
            {greeting}, {staffProfile?.fullName || 'Like Family'}
          </h2>
          <p className="text-[12px] text-[#57534E] font-mono-num">
            {formatDateVN(today)} · {hotelConfig.hotelName} · {rooms.length} phòng đang hoạt động
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGoToRooms}
            className="h-9 px-3.5 rounded-xl border border-[#E7E3DA] bg-white hover:bg-[#FAF9F6] text-[13px] font-medium text-[#1C1B18]"
          >
            Sơ đồ phòng
          </button>
          <button
            type="button"
            onClick={onGoToFinder}
            className="h-9 px-3.5 rounded-xl border border-[#E7E3DA] bg-white hover:bg-[#FAF9F6] text-[13px] font-medium text-[#1C1B18] inline-flex items-center gap-1.5"
          >
            <Search className="w-3.5 h-3.5" strokeWidth={1.5} />
            Tìm phòng trống
          </button>
          <button
            type="button"
            onClick={onOpenNewGroup}
            className="h-9 px-3.5 rounded-xl border border-[#E7E3DA] bg-white hover:bg-[#FAF9F6] text-[13px] font-medium text-[#1C1B18] inline-flex items-center gap-1.5"
          >
            <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
            Đặt đoàn
          </button>
          <button
            type="button"
            onClick={onOpenNewSingle}
            className="h-9 px-4 rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} />
            Tạo đặt phòng
          </button>
        </div>
      </div>

      {/* Period Selector Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-[#1C1B18]">Chỉ số chính</div>
          <div className="text-[11px] text-[#8A847C] font-mono-num">{rangeLabel}</div>
        </div>
        <div className="inline-flex p-0.5 rounded-xl bg-[#F3F0E9] border border-[#E7E3DA]">
          {(
            [
              { id: 'today', label: 'Hôm nay' },
              { id: 'yesterday', label: 'Hôm qua' },
              { id: '7d', label: '7 ngày' },
              { id: '30d', label: '30 ngày' },
              { id: 'this_month', label: 'Tháng này' },
            ] as Array<{ id: PeriodKey; label: string }>
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`h-7 px-3 rounded-lg text-[12px] font-medium transition-colors ${
                period === p.id
                  ? 'bg-[#0F5132] text-white'
                  : 'text-[#57534E] hover:text-[#1C1B18]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tier 1: 4 Primary KPI Cards with Period-over-Period Delta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: 'DOANH THU THỰC TẾ',
            value: formatCurrency(currentKpi.totalRev),
            delta: revDelta,
            deltaUnit: '%',
            color: 'text-[#0F5132]',
          },
          {
            label: 'TỶ LỆ LẤP ĐẦY',
            value: `${currentKpi.occPct}%`,
            delta: occDelta,
            deltaUnit: ' điểm',
            color: 'text-[#1C1B18]',
          },
          {
            label: 'ADR (GIÁ TB / ĐÊM)',
            value: formatCurrency(currentKpi.adr),
            delta: adrDelta,
            deltaUnit: '%',
            color: 'text-[#1C1B18]',
          },
          {
            label: 'REVPAR',
            value: formatCurrency(currentKpi.revPar),
            delta: revParDelta,
            deltaUnit: '%',
            color: 'text-[#0F5132]',
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white border border-[#E7E3DA] rounded-2xl p-4 flex flex-col justify-between"
          >
            <div className="text-[11px] font-semibold text-[#8A847C] tracking-wide">
              {kpi.label}
            </div>
            <div className={`mt-1.5 text-[24px] font-bold font-mono-num ${kpi.color}`}>
              {kpi.value}
            </div>
            <div className="mt-1.5 text-[11px] font-mono-num flex items-center gap-1">
              {kpi.delta !== null ? (
                <span
                  className={`inline-flex items-center font-semibold ${
                    kpi.delta >= 0 ? 'text-[#0F5132]' : 'text-[#B91C1C]'
                  }`}
                >
                  {kpi.delta >= 0 ? (
                    <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2} />
                  ) : (
                    <ArrowDownRight className="w-3.5 h-3.5" strokeWidth={2} />
                  )}
                  {Math.abs(kpi.delta)}
                  {kpi.deltaUnit}
                </span>
              ) : (
                <span className="text-[#8A847C]">Ổn định</span>
              )}
              <span className="text-[#8A847C]">so với kỳ trước</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tier 2: 5 Secondary Operational Strips */}
      <div className="bg-white border border-[#E7E3DA] rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-[#F1EFEA]">
        <div>
          <div className="text-[11px] text-[#8A847C]">Doanh thu phòng</div>
          <div className="text-[15px] font-semibold font-mono-num text-[#1C1B18] mt-0.5">
            {formatCurrency(currentKpi.roomRev)}
          </div>
        </div>
        <div className="sm:pl-4 pt-2 sm:pt-0">
          <div className="text-[11px] text-[#8A847C]">Doanh thu dịch vụ</div>
          <div className="text-[15px] font-semibold font-mono-num text-[#1C1B18] mt-0.5">
            {formatCurrency(currentKpi.serviceRev)}
          </div>
        </div>
        <div className="sm:pl-4 pt-2 sm:pt-0">
          <div className="text-[11px] text-[#8A847C]">Đơn hợp lệ</div>
          <div className="text-[15px] font-semibold font-mono-num text-[#1C1B18] mt-0.5">
            {currentKpi.bookingCount}
          </div>
        </div>
        <div className="sm:pl-4 pt-2 sm:pt-0">
          <div className="text-[11px] text-[#8A847C]">Đêm đã bán</div>
          <div className="text-[15px] font-semibold font-mono-num text-[#0F5132] mt-0.5">
            {currentKpi.nightsSold} đêm
          </div>
        </div>
        <div className="sm:pl-4 pt-2 sm:pt-0">
          <div className="text-[11px] text-[#8A847C]">Lượt nghỉ giờ</div>
          <div className="text-[15px] font-semibold font-mono-num text-[#D97706] mt-0.5">
            {currentKpi.hourlyCount} lượt
          </div>
        </div>
      </div>

      {/* Performance Dual Panel: 14-Day Revenue Chart + Channel Share */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-[#E7E3DA] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[14px] font-semibold text-[#1C1B18]">
                Doanh thu phòng 14 ngày gần nhất
              </h3>
              <p className="text-[11px] text-[#8A847C]">
                Tính theo đơn lưu trú thực tế (đã loại hủy/void/chuỗi hoàn tiền 100%)
              </p>
            </div>
            <button
              type="button"
              onClick={onGoToCalendar}
              className="text-[12px] font-medium text-[#0F5132] hover:underline inline-flex items-center gap-1"
            >
              <CalendarRange className="w-3.5 h-3.5" strokeWidth={1.5} />
              Mở Lịch
            </button>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart14Days} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7E3DA" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8A847C' }} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#8A847C' }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), 'Doanh thu phòng']}
                  contentStyle={{
                    borderRadius: '10px',
                    border: '1px solid #E7E3DA',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="doanhThu" fill="#0F5132" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-[#E7E3DA] rounded-2xl p-5 space-y-3">
          <div>
            <h3 className="text-[14px] font-semibold text-[#1C1B18]">
              Theo kênh đặt phòng
            </h3>
            <p className="text-[11px] text-[#8A847C]">Tỷ trọng doanh thu phòng trong kỳ đang chọn</p>
          </div>
          {currentKpi.sourceBreakdown.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-[#8A847C]">
              Chưa phát sinh doanh thu phòng trong kỳ này.
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {currentKpi.sourceBreakdown.map(([srcName, amount], idx) => {
                const pct =
                  currentKpi.roomRev > 0 ? Math.round((amount / currentKpi.roomRev) * 100) : 0;
                return (
                  <div key={srcName} className="space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-[#1C1B18] truncate">{srcName}</span>
                      <span className="font-mono-num text-[#57534E]">
                        {pct}% · <strong className="text-[#1C1B18]">{formatCurrency(amount)}</strong>
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[#F3F0E9] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(3, pct)}%`,
                          backgroundColor: idx === 0 ? '#0F5132' : idx === 1 ? '#D97706' : '#57534E',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 30-Day Forward Occupancy Forecast Strip (Forest Emerald Heat Squares) */}
      <div className="bg-white border border-[#E7E3DA] rounded-2xl p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-[#1C1B18]">
            Dự báo 30 ngày tới{' '}
            <span className="font-normal text-[#57534E] font-mono-num">
              · Đã đặt trung bình <strong className="text-[#0F5132]">{avgForward30Pct}%</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#8A847C]">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#F3F0E9]" /> 0%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#B7DFC7]" /> 1–49%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#40916C]" /> 50–79%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#0F5132]" /> ≥ 80%
            </span>
          </div>
        </div>
        <div className="grid grid-cols-10 sm:grid-cols-15 lg:grid-cols-30 gap-1">
          {forward30Days.map((day) => {
            const bg =
              day.pct >= 80
                ? 'bg-[#0F5132] text-white'
                : day.pct >= 50
                ? 'bg-[#40916C] text-white'
                : day.pct > 0
                ? 'bg-[#B7DFC7] text-[#0F5132]'
                : 'bg-[#F3F0E9] text-[#8A847C]';
            return (
              <div
                key={day.date}
                title={`${formatDateVN(day.date)}: ${day.sold}/${rooms.length} phòng (${day.pct}%)`}
                className="flex flex-col items-center gap-0.5"
              >
                <div
                  className={`w-full h-7 rounded-md flex items-center justify-center font-mono-num text-[10px] font-semibold ${bg}`}
                >
                  {day.dayNum}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Operational Queue Today */}
      <div className="bg-white border border-[#E7E3DA] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'arriving', label: `Sắp nhận phòng (${queues.arriving.length})` },
              { id: 'departing', label: `Sắp trả phòng (${queues.departing.length})` },
              { id: 'in_house', label: `Đang lưu trú (${queues.in_house.length})` },
              { id: 'pending_deposit', label: `Cọc treo (${queues.pending_deposit.length})` },
              { id: 'asm_alert', label: `Cảnh báo ASM (${queues.asm_alert.length})` },
            ] as Array<{ id: QueueTab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setQueueTab(t.id)}
              className={`h-8 px-3.5 rounded-lg text-[12px] font-medium border transition-colors ${
                queueTab === t.id
                  ? 'border-[#0F5132] bg-[#E8F3EC] text-[#0F5132]'
                  : 'border-[#E7E3DA] bg-white text-[#57534E] hover:bg-[#FAF9F6]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto border border-[#E7E3DA] rounded-xl">
          <table className="w-full text-[12px] min-w-[660px]">
            <thead className="bg-[#FAF9F6] border-b border-[#E7E3DA] text-[#57534E]">
              <tr>
                <th className="text-left px-3.5 py-2 font-medium">Mã đơn</th>
                <th className="text-left px-3.5 py-2 font-medium">Phòng</th>
                <th className="text-left px-3.5 py-2 font-medium">Khách hàng</th>
                <th className="text-left px-3.5 py-2 font-medium">Nguồn</th>
                <th className="text-left px-3.5 py-2 font-medium">Nhận → Trả</th>
                <th className="text-right px-3.5 py-2 font-medium">Tổng cộng</th>
                <th className="text-right px-3.5 py-2 font-medium">Còn phải thu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1EFEA]">
              {activeQueueList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[#8A847C]">
                    Không có đơn nào trong danh mục này hôm nay.
                  </td>
                </tr>
              ) : (
                activeQueueList.map((b) => {
                  const total =
                    (b.grossRoomTotal || 0) + (b.serviceTotal || 0) + (b.hourlySurcharge || 0);
                  const bal = Math.max(0, getBookingGuestBalance(b));
                  return (
                    <tr
                      key={b.id}
                      onClick={() => onSelectBooking(b)}
                      className="hover:bg-[#FAF9F6] cursor-pointer"
                    >
                      <td className="px-3.5 py-2.5 font-mono-num font-semibold text-[#0F5132]">
                        {b.bookingCode}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className="font-mono-num font-semibold text-[#1C1B18]">
                          P.{b.roomNumber}
                        </span>
                        <span className="block text-[10px] text-[#8A847C]">{b.roomTypeName}</span>
                      </td>
                      <td className="px-3.5 py-2.5 font-medium text-[#1C1B18]">
                        <div className="flex items-center gap-1.5">
                          <span>{b.primaryGuestName}</span>
                          {b.bookingMode === 'hourly' && (
                            <Clock className="w-3 h-3 text-[#D97706]" strokeWidth={1.75} />
                          )}
                          {b.hasStayPermitAlert && (
                            <AlertTriangle className="w-3 h-3 text-[#B91C1C]" strokeWidth={1.75} />
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 text-[#57534E]">
                        {getSourceLabel(b.source, b.otaChannel, b.sourceLabel)}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono-num text-[#57534E]">
                        {formatShortDate(b.checkIn)} → {formatShortDate(b.checkOut)}
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono-num">
                        {formatCurrency(total)}
                      </td>
                      <td
                        className={`px-3.5 py-2.5 text-right font-mono-num font-semibold ${
                          bal > 0 ? 'text-[#B45309]' : 'text-[#0F5132]'
                        }`}
                      >
                        {formatCurrency(bal)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {activeQueueList.length > 0 && (
              <tfoot className="bg-[#FAF9F6] border-t border-[#E7E3DA] font-semibold">
                <tr>
                  <td colSpan={6} className="px-3.5 py-2 text-right text-[#57534E]">
                    Tổng còn phải thu
                  </td>
                  <td className="px-3.5 py-2 text-right font-mono-num text-[#B45309]">
                    {formatCurrency(activeQueueReceivable)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
