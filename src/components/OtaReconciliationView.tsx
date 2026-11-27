import React, { useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, Check, CheckCircle2, Landmark, PlusCircle } from 'lucide-react';
import { db } from '../lib/firebase';
import { usePms } from '../context/PmsContext';
import type { Booking, OtaAdjustment } from '../types/pms';
import { formatCurrency, formatDateVN, getOtaCancelStatusLabel, todayISO } from '../lib/utils';
import { createOtaPayoutBatch, writeAuditLog } from '../lib/pmsActions';
import { updateOtaCancelWorkflow } from '../lib/cancellationActions';
import { createOtaPostReconciledAdjustment } from '../lib/postStayActions';
import { DateInputVN } from './DateInputVN';

interface OtaReconciliationViewProps {
  onSelectBooking: (booking: Booking) => void;
}

export const OtaReconciliationView: React.FC<OtaReconciliationViewProps> = ({
  onSelectBooking,
}) => {
  const { bookings, otaBatches, otaAdjustments, hotelConfig, isAdmin, actor, notify } = usePms();
  const [channelFilter, setChannelFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [payoutDate, setPayoutDate] = useState(todayISO());
  const [actualReceived, setActualReceived] = useState<string>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Part C Rule 7: Post-Reconciliation OTA Adjustment (carry-forward to next payout)
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [adjBookingId, setAdjBookingId] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [savingAdj, setSavingAdj] = useState(false);

  const settledOtaBookings = useMemo(
    () =>
      bookings.filter(
        (b) =>
          (b.source === 'ota' || b.paymentMethod === 'ota_debt') &&
          b.otaSettlementStatus === 'settled'
      ),
    [bookings]
  );

  const pendingOtaAdjustments = useMemo(
    () => otaAdjustments.filter((a) => a.status === 'pending_next_payout'),
    [otaAdjustments]
  );

  const handleCreateOtaAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = settledOtaBookings.find((b) => b.id === adjBookingId);
    if (!target) {
      notify('Vui lòng chọn đơn OTA đã đối soát cần lập bút toán điều chỉnh kỳ sau', 'warning');
      return;
    }
    const amt = Number(adjAmount);
    if (!amt || amt === 0) {
      notify('Nhập số tiền điều chỉnh khác 0 (số âm để trừ kỳ sau, số dương để cộng thêm)', 'warning');
      return;
    }
    setSavingAdj(true);
    try {
      await createOtaPostReconciledAdjustment({
        booking: target,
        adjustmentAmount: amt,
        reason: adjReason,
        accountingLockDate: hotelConfig.accountingLockDate,
        actor,
      });
      setAdjBookingId('');
      setAdjAmount('');
      setAdjReason('');
      setShowAdjForm(false);
      notify(`Đã lập bút toán điều chỉnh công nợ OTA kỳ sau cho ${target.bookingCode}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi lập điều chỉnh OTA', 'error');
    } finally {
      setSavingAdj(false);
    }
  };

  const handleMarkAdjustmentApplied = async (adj: OtaAdjustment) => {
    const batchRef = window.prompt(
      `Nhập mã lô đối soát kỳ sau đã khấu trừ/cộng bù bút toán ${adj.bookingCode} (${formatCurrency(
        adj.adjustmentAmount
      )}):`,
      otaBatches[0]?.batchCode || ''
    );
    if (batchRef === null) return;
    await updateDoc(doc(db, 'ota_adjustments', adj.id), {
      status: 'applied',
      appliedBatchId: batchRef.trim() || 'manual_applied',
    });
    await writeAuditLog({
      actionType: 'ota_adjustment_applied',
      targetId: adj.id,
      targetLabel: `Khấu trừ xong Điều chỉnh OTA ${adj.bookingCode} (${adj.otaChannel})`,
      previousState: { status: adj.status },
      newState: { status: 'applied', appliedBatchId: batchRef.trim() || 'manual_applied' },
      reason: `Đã đối trừ bút toán ${formatCurrency(adj.adjustmentAmount)} vào lô ${
        batchRef.trim() || 'kỳ sau'
      }`,
      actor,
    });
    notify(`Đã đánh dấu hoàn tất đối trừ bút toán OTA ${adj.bookingCode}`);
  };

  const otaSources = useMemo(
    () => (hotelConfig.bookingSources || []).filter((s) => s.kind === 'ota'),
    [hotelConfig.bookingSources]
  );

  // Cancelled / No-Show OTA bookings waiting for 3-state reconciliation (Rule 7)
  const pendingOtaCancelled = useMemo(() => {
    return bookings.filter((b) => {
      const isOta = b.source === 'ota' || b.paymentMethod === 'ota_debt';
      if (!isOta) return false;
      if (b.status !== 'cancelled' && b.status !== 'no_show') return false;
      return b.otaCancelStatus !== 'ota_cancel_reconciled';
    });
  }, [bookings]);

  const unsettledBookings = useMemo(() => {
    return bookings.filter((b) => {
      const isOtaDebt = b.source === 'ota' || b.paymentMethod === 'ota_debt';
      if (!isOtaDebt || b.otaSettlementStatus === 'settled') return false;
      // Cancelled OTA bookings only enter payout batch AFTER reconciliation with penalty fee > 0
      if (b.status === 'cancelled' || b.status === 'no_show') {
        if (b.otaCancelStatus !== 'ota_cancel_reconciled' || (b.grossRoomTotal || 0) <= 0) {
          return false;
        }
      }
      if (channelFilter !== 'all' && (b.otaChannel || b.sourceLabel) !== channelFilter)
        return false;
      return true;
    });
  }, [bookings, channelFilter]);

  const totalsByChannel = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const b of bookings) {
      if (b.otaSettlementStatus === 'settled') continue;
      if (b.source !== 'ota' && b.paymentMethod !== 'ota_debt') continue;
      if (
        (b.status === 'cancelled' || b.status === 'no_show') &&
        b.otaCancelStatus === 'ota_cancel_reconciled' &&
        (b.grossRoomTotal || 0) <= 0
      ) {
        continue;
      }
      const ch = b.otaChannel || b.sourceLabel || 'Công nợ OTA';
      const cur = map.get(ch) || { count: 0, total: 0 };
      cur.count++;
      cur.total += b.grossRoomTotal || 0;
      map.set(ch, cur);
    }
    return Array.from(map.entries());
  }, [bookings]);

  const selectedBookings = useMemo(
    () => unsettledBookings.filter((b) => selectedIds.includes(b.id)),
    [unsettledBookings, selectedIds]
  );
  const selectedExpectedTotal = selectedBookings.reduce((s, b) => s + (b.grossRoomTotal || 0), 0);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSettleBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBookings.length === 0) return;

    const channels = new Set(
      selectedBookings.map((b) => b.otaChannel || b.sourceLabel || 'Công nợ OTA')
    );
    const channelLabel = channels.size === 1 ? Array.from(channels)[0] : 'Nhiều kênh OTA';
    const actualAmount =
      actualReceived.trim() === ''
        ? selectedExpectedTotal
        : Math.max(0, Number(actualReceived) || 0);

    setSubmitting(true);
    try {
      const batch = await createOtaPayoutBatch({
        otaChannel: channelLabel,
        payoutDate,
        bookings: selectedBookings,
        actualReceivedAmount: actualAmount,
        note,
        actor,
      });
      setSelectedIds([]);
      setActualReceived('');
      setNote('');
      notify(
        `Đã gạch nợ lô ${batch.batchCode} (${batch.bookingIds.length} đơn) — Thực nhận ${formatCurrency(
          batch.actualReceivedAmount
        )}`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi gạch nợ OTA', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-[#E5E2DC] rounded-xl p-4">
          <div className="text-[12px] text-[#57534E]">Tổng Công nợ OTA chưa về</div>
          <div className="mt-1 text-[20px] font-semibold font-mono-num text-[#C2410C]">
            {formatCurrency(totalsByChannel.reduce((s, [, v]) => s + v.total, 0))}
          </div>
          <div className="text-[11px] text-[#8A847C] mt-0.5">
            {totalsByChannel.reduce((s, [, v]) => s + v.count, 0)} đơn chưa đối soát
          </div>
        </div>
        {totalsByChannel.slice(0, 3).map(([ch, data]) => (
          <div key={ch} className="bg-white border border-[#E5E2DC] rounded-xl p-4">
            <div className="text-[12px] font-medium text-[#1C1B18]">{ch}</div>
            <div className="mt-1 text-[18px] font-semibold font-mono-num text-[#1B5E4B]">
              {formatCurrency(data.total)}
            </div>
            <div className="text-[11px] text-[#8A847C] font-mono-num mt-0.5">
              {data.count} đơn chưa thanh toán
            </div>
          </div>
        ))}
      </div>

      {/* Rule 7: Dedicated 3-State OTA Cancelled Reconciliation Queue */}
      {pendingOtaCancelled.length > 0 && (
        <div className="bg-[#FFF7ED] border border-[#FED7AA] rounded-2xl p-5 space-y-3">
          <div className="flex items-start gap-2.5 text-[#9A3412]">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.5} />
            <div>
              <h3 className="text-[14px] font-semibold">
                Đơn OTA đã hủy chờ đối soát công nợ ({pendingOtaCancelled.length} đơn)
              </h3>
              <p className="text-[12px]">
                Công nợ OTA không tự động bị xóa khi hủy đơn. Hãy cập nhật xác nhận từ kênh OTA và
                điều chỉnh công nợ về 0đ (hủy miễn phí) hoặc giữ đúng phần phí phạt thực nhận.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {pendingOtaCancelled.map((b) => (
              <div
                key={b.id}
                className="p-3.5 rounded-xl bg-white border border-[#FED7AA] flex flex-wrap items-center justify-between gap-3 text-[12px]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-num font-semibold text-[#C2410C]">
                      {b.otaChannel || 'OTA'}
                    </span>
                    <span className="font-mono-num font-medium text-[#1C1B18]">
                      {b.bookingCode} (P.{b.roomNumber})
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#FFFBEB] text-[#92400E] font-medium text-[11px]">
                      {getOtaCancelStatusLabel(b.otaCancelStatus)}
                    </span>
                  </div>
                  <div className="text-[#57534E] mt-0.5">
                    {b.primaryGuestName} • {formatDateVN(b.checkIn)} → {formatDateVN(b.checkOut)} •
                    Công nợ gốc: <strong className="font-mono-num">{formatCurrency(b.grossRoomTotal)}</strong>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {b.otaCancelStatus === 'ota_cancel_requested' && (
                    <button
                      type="button"
                      onClick={async () => {
                        const r = window.prompt('Ghi chú xác nhận hủy từ kênh OTA:', 'OTA đã gửi email xác nhận hủy');
                        if (!r) return;
                        await updateOtaCancelWorkflow({
                          booking: b,
                          nextOtaStatus: 'ota_cancel_confirmed',
                          reason: r,
                          actor,
                        });
                        notify(`Đã cập nhật ${b.bookingCode} sang: OTA đã xác nhận hủy`);
                      }}
                      className="h-8 px-3 rounded-lg border border-[#FDBA74] bg-[#FFF7ED] text-[#9A3412] font-medium"
                    >
                      Đánh dấu OTA đã xác nhận hủy
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const feeStr = window.prompt(
                        `Nhập số tiền công nợ OTA thực nhận sau đối soát cho ${b.bookingCode} (nhập 0 nếu hủy miễn phí, hoặc nhập số tiền phí phạt thực nhận):`,
                        '0'
                      );
                      if (feeStr === null) return;
                      const fee = Math.max(0, Number(feeStr) || 0);
                      const r = window.prompt(
                        'Lý do / căn cứ đối soát OTA (Bắt buộc):',
                        fee === 0 ? 'OTA xác nhận hủy miễn phí, điều chỉnh công nợ về 0đ' : `OTA xác nhận giữ phí phạt hủy ${formatCurrency(fee)}`
                      );
                      if (!r || !r.trim()) return;
                      await updateOtaCancelWorkflow({
                        booking: b,
                        nextOtaStatus: 'ota_cancel_reconciled',
                        adjustedDebtAmount: fee,
                        reason: r,
                        actor,
                      });
                      notify(
                        fee === 0
                          ? `Đã đối soát hủy miễn phí ${b.bookingCode} (Công nợ OTA về 0đ)`
                          : `Đã đối soát ${b.bookingCode} — Giữ phí phạt OTA ${formatCurrency(fee)} chờ gạch nợ`
                      );
                    }}
                    className="h-8 px-3 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white font-medium"
                  >
                    Đối soát điều chỉnh công nợ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[#1C1B18]">
              Sổ Công nợ OTA phải thu (Chưa về tài khoản)
            </h2>
            <p className="text-[12px] text-[#57534E]">
              Thống kê riêng toàn bộ khoản Công nợ OTA chưa về — không làm lệch quỹ tiền mặt tại quầy
            </p>
          </div>
          <select
            value={channelFilter}
            onChange={(e) => {
              setChannelFilter(e.target.value);
              setSelectedIds([]);
            }}
            className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
          >
            <option value="all">Tất cả kênh OTA</option>
            {otaSources.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
                {c.isActive === false ? ' (Ngừng dùng)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto border border-[#E5E2DC] rounded-xl">
          <table className="w-full text-[12px] min-w-[680px]">
            <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
              <tr>
                <th className="w-10 px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={
                      unsettledBookings.length > 0 &&
                      selectedIds.length === unsettledBookings.length
                    }
                    onChange={(e) =>
                      setSelectedIds(e.target.checked ? unsettledBookings.map((b) => b.id) : [])
                    }
                    className="accent-[#1B5E4B]"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">Kênh / Mã OTA</th>
                <th className="text-left px-3 py-2 font-medium">Khách / Phòng</th>
                <th className="text-left px-3 py-2 font-medium">Lưu trú (dd/mm/YYYY)</th>
                <th className="text-right px-3 py-2 font-medium">Tiền thực thu (Công nợ OTA)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1EFEA]">
              {unsettledBookings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#8A847C]">
                    Không có công nợ OTA nào đang chờ đối soát.
                  </td>
                </tr>
              ) : (
                unsettledBookings.map((b) => {
                  const checked = selectedIds.includes(b.id);
                  return (
                    <tr key={b.id} className={checked ? 'bg-[#E8F2EE]/40' : 'hover:bg-[#FAF9F6]'}>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelect(b.id)}
                          className={`w-4 h-4 rounded border inline-flex items-center justify-center ${
                            checked
                              ? 'bg-[#1B5E4B] border-[#1B5E4B] text-white'
                              : 'border-[#D0CBC2] bg-white'
                          }`}
                        >
                          {checked && <Check className="w-3 h-3" strokeWidth={2.5} />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-[#C2410C]">
                          {b.otaChannel || b.sourceLabel || 'OTA'}
                        </div>
                        <div className="font-mono-num text-[11px] text-[#8A847C]">
                          {b.otaBookingRef || b.bookingCode}
                        </div>
                      </td>
                      <td
                        className="px-3 py-2.5 cursor-pointer"
                        onClick={() => onSelectBooking(b)}
                      >
                        <div className="font-medium text-[#1C1B18]">{b.primaryGuestName}</div>
                        <div className="font-mono-num text-[11px] text-[#57534E]">
                          P.{b.roomNumber} • {b.bookingCode}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono-num">
                        {formatDateVN(b.checkIn)} → {formatDateVN(b.checkOut)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-num font-semibold text-[#1B5E4B]">
                        {formatCurrency(b.grossRoomTotal)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {selectedBookings.length > 0 && (
          <form
            onSubmit={handleSettleBatch}
            className="p-4 rounded-xl bg-[#FAF9F6] border border-[#1B5E4B]/30 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#1B5E4B]">
                <Landmark className="w-4 h-4" strokeWidth={1.5} />
                Gạch nợ theo lô ({selectedBookings.length} đơn đã chọn)
              </div>
              <div className="text-[13px] font-mono-num">
                Tổng công nợ dự kiến: <strong>{formatCurrency(selectedExpectedTotal)}</strong>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">Ngày tiền về ngân hàng</label>
                <DateInputVN value={payoutDate} onChange={setPayoutDate} />
              </div>
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">
                  Số tiền thực nhận trên sao kê
                </label>
                <input
                  type="number"
                  min={0}
                  value={actualReceived}
                  onChange={(e) => setActualReceived(e.target.value)}
                  placeholder={String(selectedExpectedTotal)}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[12px]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">Ghi chú sao kê</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: Sao kê Agoda tuần 4"
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-9 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium"
                >
                  {submitting ? 'Đang gạch nợ...' : 'Xác nhận gạch nợ lô'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Part C Rule 7: Post-Reconciliation OTA Adjustments (Carry-forward to next payout) */}
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-[#1C1B18]">
              Điều chỉnh Công nợ OTA sau đối soát kỳ sau (`ota_adjustments` — {pendingOtaAdjustments.length}{' '}
              chờ đối trừ)
            </h3>
            <p className="text-[12px] text-[#57534E]">
              Tuyệt đối không xóa lô đối soát đã nhận tiền. Mọi phát sinh hủy/sửa đơn OTA đã thanh
              toán được ghi nhận sang bút toán điều chỉnh để khấu trừ/cộng bù vào kỳ thanh toán kế
              tiếp.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAdjForm((v) => !v)}
              className="h-8 px-3 rounded-lg border border-[#1B5E4B] text-[#1B5E4B] hover:bg-[#E8F2EE] text-[12px] font-medium inline-flex items-center gap-1.5"
            >
              <PlusCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
              Lập bút toán điều chỉnh OTA
            </button>
          )}
        </div>

        {showAdjForm && isAdmin && (
          <form
            onSubmit={handleCreateOtaAdjustment}
            className="p-4 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">
                  Đơn OTA đã gạch nợ (Settled) *
                </label>
                <select
                  required
                  value={adjBookingId}
                  onChange={(e) => setAdjBookingId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                >
                  <option value="">-- Chọn đơn OTA đã đối soát --</option>
                  {settledOtaBookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bookingCode} • {b.otaChannel || 'OTA'} • P.{b.roomNumber} (
                      {formatCurrency(b.grossRoomTotal)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">
                  Số tiền điều chỉnh kỳ sau (Âm = trừ kỳ sau) *
                </label>
                <input
                  type="number"
                  required
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="VD: -500000"
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[12px]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">
                  Lý do điều chỉnh OTA (Bắt buộc) *
                </label>
                <input
                  type="text"
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="VD: OTA hoàn tiền khách sau kỳ payout, trừ vào kỳ tới..."
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdjForm(false)}
                className="h-8 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingAdj}
                className="h-8 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[12px] font-medium"
              >
                {savingAdj ? 'Đang lưu...' : 'Lưu bút toán điều chỉnh OTA'}
              </button>
            </div>
          </form>
        )}

        {otaAdjustments.length === 0 ? (
          <p className="text-[12px] text-[#8A847C]">
            Chưa có bút toán điều chỉnh công nợ OTA sau đối soát nào.
          </p>
        ) : (
          <div className="overflow-x-auto border border-[#E5E2DC] rounded-xl">
            <table className="w-full text-[12px] min-w-[680px]">
              <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Ngày HT</th>
                  <th className="text-left px-3 py-2 font-medium">Kênh / Mã đơn</th>
                  <th className="text-left px-3 py-2 font-medium">Lý do điều chỉnh</th>
                  <th className="text-right px-3 py-2 font-medium">Số tiền điều chỉnh</th>
                  <th className="text-right px-3 py-2 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EFEA]">
                {otaAdjustments.map((adj) => (
                  <tr key={adj.id}>
                    <td className="px-3 py-2 font-mono-num">{formatDateVN(adj.accountingDate)}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-[#C2410C]">{adj.otaChannel}</span> •{' '}
                      <span className="font-mono-num">{adj.bookingCode}</span>
                    </td>
                    <td className="px-3 py-2 text-[#57534E]">
                      {adj.reason}
                      <span className="block text-[11px] text-[#8A847C]">
                        Người lập: {adj.createdByName}
                        {adj.appliedBatchId ? ` • Lô áp dụng: ${adj.appliedBatchId}` : ''}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono-num font-semibold ${
                        adj.adjustmentAmount < 0 ? 'text-[#B91C1C]' : 'text-[#15803D]'
                      }`}
                    >
                      {adj.adjustmentAmount > 0 ? '+' : ''}
                      {formatCurrency(adj.adjustmentAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {adj.status === 'applied' ? (
                        <span className="px-2 py-0.5 rounded bg-[#E8F2EE] text-[#1B5E4B] text-[11px] font-medium">
                          Đã đối trừ kỳ sau
                        </span>
                      ) : isAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleMarkAdjustmentApplied(adj)}
                          className="h-7 px-2.5 rounded-md border border-[#1B5E4B] text-[#1B5E4B] hover:bg-[#E8F2EE] text-[11px] font-medium"
                        >
                          Đánh dấu đã đối trừ
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-[#FFFBEB] text-[#92400E] text-[11px] font-medium">
                          Chờ trừ kỳ sau
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3">
        <h3 className="text-[14px] font-semibold text-[#1C1B18]">
          Lịch sử các lô đối soát OTA đã hoàn tất ({otaBatches.length})
        </h3>
        {otaBatches.length === 0 ? (
          <p className="text-[13px] text-[#8A847C]">Chưa có lô đối soát OTA nào được lập.</p>
        ) : (
          <div className="overflow-x-auto border border-[#E5E2DC] rounded-xl">
            <table className="w-full text-[12px]">
              <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Mã lô</th>
                  <th className="text-left px-3 py-2 font-medium">Kênh OTA</th>
                  <th className="text-left px-3 py-2 font-medium">Ngày tiền về</th>
                  <th className="text-center px-3 py-2 font-medium">Số đơn</th>
                  <th className="text-right px-3 py-2 font-medium">Tổng công nợ</th>
                  <th className="text-right px-3 py-2 font-medium">Thực nhận</th>
                  <th className="text-right px-3 py-2 font-medium">Chênh lệch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EFEA]">
                {otaBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-3 py-2 font-mono-num font-medium text-[#1B5E4B]">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" strokeWidth={1.5} />
                        {batch.batchCode}
                      </span>
                    </td>
                    <td className="px-3 py-2">{batch.otaChannel}</td>
                    <td className="px-3 py-2 font-mono-num">{formatDateVN(batch.payoutDate)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">
                      {batch.bookingIds.length}
                    </td>
                    <td className="px-3 py-2 text-right font-mono-num">
                      {formatCurrency(batch.expectedNetTotal)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono-num font-semibold text-[#15803D]">
                      {formatCurrency(batch.actualReceivedAmount)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono-num text-[#57534E]">
                      {formatCurrency(batch.bankFeeDiff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
