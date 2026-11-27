import React, { useState } from 'react';
import { Calculator, Layers } from 'lucide-react';
import type { DailyRate, RoomType } from '../types/pms';
import {
  applyUniformDailyRate,
  formatCurrency,
  formatDateVN,
  getWeekdayLabelVN,
  splitTotalToDailyRates,
  sumDailyRates,
} from '../lib/utils';

interface PricingEditorProps {
  roomType?: RoomType;
  dailyRates: DailyRate[];
  selectedTierId?: string | null;
  onChange: (nextRates: DailyRate[], nextTierId?: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
}

export const PricingEditor: React.FC<PricingEditorProps> = ({
  roomType,
  dailyRates,
  selectedTierId,
  onChange,
  disabled = false,
  compact = false,
}) => {
  const [bulkRateInput, setBulkRateInput] = useState('');
  const [totalTargetInput, setTotalTargetInput] = useState('');

  const currentTotal = sumDailyRates(dailyRates);

  const handleSelectTier = (tierId: string) => {
    const tier = roomType?.priceTiers.find((t) => t.id === tierId);
    if (!tier) return;
    onChange(applyUniformDailyRate(dailyRates, tier.price), tier.id);
  };

  const handleApplyBulk = () => {
    const val = Number(bulkRateInput.replace(/[^\d]/g, ''));
    if (!val && val !== 0) return;
    onChange(applyUniformDailyRate(dailyRates, val), null);
    setBulkRateInput('');
  };

  const handleApplyTotalSplit = () => {
    const val = Number(totalTargetInput.replace(/[^\d]/g, ''));
    if (isNaN(val) || val < 0) return;
    onChange(splitTotalToDailyRates(dailyRates, val), null);
    setTotalTargetInput('');
  };

  const handleEditNight = (idx: number, raw: string) => {
    const val = Number(raw.replace(/[^\d]/g, '')) || 0;
    const next = dailyRates.map((d, i) => (i === idx ? { ...d, rate: val } : d));
    onChange(next, null);
  };

  return (
    <div className="rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#1C1B18]">
          <Calculator className="w-4 h-4 text-[#57534E]" strokeWidth={1.5} />
          <span>Chi tiết giá phòng ({dailyRates.length} đêm)</span>
        </div>
        <div className="text-[14px] font-semibold font-mono-num text-[#1B5E4B]">
          Tổng: {formatCurrency(currentTotal)}
        </div>
      </div>

      {/* Row 1: Tier Selector + Bulk Single Rate + Total Auto-Split */}
      {!disabled && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {/* 1. Price Tier Selector */}
          <div>
            <label className="block text-[11px] text-[#57534E] mb-1">
              Chọn nhanh gói giá
            </label>
            <div className="relative">
              <Layers className="w-3.5 h-3.5 text-[#8A847C] absolute left-2.5 top-2.5" strokeWidth={1.5} />
              <select
                value={selectedTierId || ''}
                onChange={(e) => handleSelectTier(e.target.value)}
                className="w-full h-8 pl-8 pr-2 text-[12px] rounded-lg border border-[#E5E2DC] bg-white text-[#1C1B18] focus:outline-none focus:border-[#1B5E4B]"
              >
                <option value="">-- Giá tùy chỉnh --</option>
                {(roomType?.priceTiers || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tierName} ({formatCurrency(t.price)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 2. Bulk Apply 1 Rate for All Nights */}
          <div>
            <label className="block text-[11px] text-[#57534E] mb-1">
              Đổi 1 giá cho tất cả các đêm
            </label>
            <div className="flex gap-1.5">
              <input
                type="number"
                min={0}
                step={10000}
                value={bulkRateInput}
                onChange={(e) => setBulkRateInput(e.target.value)}
                placeholder="VD: 320000"
                className="w-full h-8 px-2.5 text-[12px] font-mono-num rounded-lg border border-[#E5E2DC] bg-white focus:outline-none focus:border-[#1B5E4B]"
              />
              <button
                type="button"
                onClick={handleApplyBulk}
                disabled={!bulkRateInput}
                className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#F1EFEA] disabled:opacity-40 text-[12px] font-medium text-[#1C1B18] shrink-0 transition-colors"
              >
                Áp dụng
              </button>
            </div>
          </div>

          {/* 3. Total-to-Daily Auto Split */}
          <div>
            <label className="block text-[11px] text-[#57534E] mb-1">
              Nhập tổng tiền (tự chia đều)
            </label>
            <div className="flex gap-1.5">
              <input
                type="number"
                min={0}
                step={10000}
                value={totalTargetInput}
                onChange={(e) => setTotalTargetInput(e.target.value)}
                placeholder="VD: 2000000"
                className="w-full h-8 px-2.5 text-[12px] font-mono-num rounded-lg border border-[#E5E2DC] bg-white focus:outline-none focus:border-[#1B5E4B]"
              />
              <button
                type="button"
                onClick={handleApplyTotalSplit}
                disabled={!totalTargetInput}
                className="h-8 px-2.5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-40 text-[12px] font-medium text-white shrink-0 transition-colors"
              >
                Chia đều
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Per-night editable table */}
      <div
        className={`grid gap-1.5 ${
          compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
        } max-h-48 overflow-y-auto pr-1`}
      >
        {dailyRates.map((d, idx) => (
          <div
            key={d.date}
            className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-[#E5E2DC]"
          >
            <div className="text-[11px] text-[#57534E] shrink-0">
              <span className="font-mono-num font-medium text-[#1C1B18]">
                {formatDateVN(d.date)}
              </span>{' '}
              <span>({getWeekdayLabelVN(d.date)})</span>
            </div>
            {disabled ? (
              <span className="text-[12px] font-mono-num font-medium text-[#1C1B18]">
                {formatCurrency(d.rate)}
              </span>
            ) : (
              <input
                type="number"
                min={0}
                step={10000}
                value={d.rate}
                onChange={(e) => handleEditNight(idx, e.target.value)}
                className="w-24 text-right text-[12px] font-mono-num font-medium text-[#1C1B18] bg-transparent border-b border-transparent focus:border-[#1B5E4B] focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
