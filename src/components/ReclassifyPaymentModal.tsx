import React, { useState } from 'react';
import { ArrowRightLeft, Lock, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { PaymentMethod, Transaction } from '../types/pms';
import { formatCurrency, formatDateVN, getPaymentMethodLabel } from '../lib/utils';
import { reclassifyPaymentMethod, resolveAccountingPostingDate } from '../lib/postStayActions';

interface ReclassifyPaymentModalProps {
  tx: Transaction;
  onClose: () => void;
}

export const ReclassifyPaymentModal: React.FC<ReclassifyPaymentModalProps> = ({ tx, onClose }) => {
  const { hotelConfig, actor, notify } = usePms();
  const [newMethod, setNewMethod] = useState<PaymentMethod>(
    tx.method === 'cash' ? 'bank_transfer' : 'cash'
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const lockInfo = resolveAccountingPostingDate(tx.date, hotelConfig.accountingLockDate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await reclassifyPaymentMethod({
        tx,
        newMethod,
        reason,
        accountingLockDate: hotelConfig.accountingLockDate,
        actor,
      });
      notify(
        `Đã lập bút toán chuyển đổi phương thức ${formatCurrency(tx.amount)}: ${getPaymentMethodLabel(
          tx.method
        )} → ${getPaymentMethodLabel(newMethod)}`
      );
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi chuyển đổi phương thức', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E2DC] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-[#1B5E4B]" strokeWidth={1.5} />
            <div>
              <h2 className="text-[15px] font-semibold text-[#1C1B18]">
                Chuyển đổi Phương thức thanh toán (Không tạo thu/chi giả)
              </h2>
              <p className="text-[12px] text-[#57534E]">
                Phiếu gốc ngày {formatDateVN(tx.date)} • {formatCurrency(tx.amount)} (
                {getPaymentMethodLabel(tx.method)})
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {lockInfo.isLockedOrigin && (
            <div className="p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-[12px] flex gap-2">
              <Lock className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
              <span>{lockInfo.lockedNotice}</span>
            </div>
          )}

          <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] text-[12px] text-[#57534E]">
            Hệ thống giữ nguyên phiếu thu gốc bất biến và tự động lập cặp bút toán:{' '}
            <strong>Giảm {getPaymentMethodLabel(tx.method)}</strong> &{' '}
            <strong>Tăng {getPaymentMethodLabel(newMethod)}</strong> cùng số tiền{' '}
            <strong className="font-mono-num">{formatCurrency(tx.amount)}</strong>.
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#57534E] mb-1">
              Chuyển sang phương thức đúng
            </label>
            <select
              value={newMethod}
              onChange={(e) => setNewMethod(e.target.value as PaymentMethod)}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
            >
              {(['cash', 'bank_transfer', 'card', 'ota_debt'] as PaymentMethod[])
                .filter((m) => m !== tx.method)
                .map((m) => (
                  <option key={m} value={m}>
                    {getPaymentMethodLabel(m)}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#57534E] mb-1">
              Lý do điều chỉnh phương thức (Bắt buộc) *
            </label>
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Khách thực tế chuyển khoản VietQR nhưng lễ tân chọn nhầm Tiền mặt..."
              className="w-full p-2.5 rounded-xl border border-[#E5E2DC] text-[13px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-[#E5E2DC] text-[13px]"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium"
            >
              {saving ? 'Đang chuyển đổi...' : 'Xác nhận chuyển đổi PTTT'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
