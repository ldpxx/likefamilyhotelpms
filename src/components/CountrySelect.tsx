import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, Search, X } from 'lucide-react';
import {
  findCountryByValue,
  formatCountryDisplay,
  normalizeCountryCode,
  searchCountries,
  type CountryOption,
} from '../lib/countries';

interface CountrySelectProps {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  testId?: string;
  className?: string;
}

export const CountrySelect: React.FC<CountrySelectProps> = ({
  value,
  onChange,
  placeholder = 'Chọn quốc tịch...',
  allowEmpty = false,
  emptyLabel = 'Tất cả quốc tịch',
  disabled = false,
  compact = false,
  testId,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pushedHistoryRef = useRef(false);

  const normalizedVal = useMemo(() => normalizeCountryCode(value), [value]);
  const selectedCountry = useMemo(() => findCountryByValue(value), [value]);
  const displayLabel = useMemo(() => {
    if (!value?.trim()) return '';
    return formatCountryDisplay(value);
  }, [value]);

  const { priority, others } = useMemo(() => searchCountries(query), [query]);
  const trimmedQuery = query.trim();
  const exactExists = useMemo(() => {
    if (!trimmedQuery) return true;
    const normQ = normalizeCountryCode(trimmedQuery).toLowerCase();
    return [...priority, ...others].some(
      (c) =>
        c.code.toLowerCase() === normQ ||
        c.iso3.toLowerCase() === trimmedQuery.toLowerCase() ||
        c.nameVi.toLowerCase() === trimmedQuery.toLowerCase() ||
        c.nameEn.toLowerCase() === trimmedQuery.toLowerCase()
    );
  }, [trimmedQuery, priority, others]);

  const closePicker = () => {
    setOpen(false);
    setQuery('');
  };

  // Focus search input when opened + support Escape, outside click & Android Back button (popstate)
  useEffect(() => {
    if (!open) return;

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 30);

    // Push lightweight history state so pressing Android hardware/gesture Back closes the picker cleanly
    try {
      window.history.pushState({ lfpmsCountrySelect: true }, '');
      pushedHistoryRef.current = true;
    } catch {
      pushedHistoryRef.current = false;
    }

    const handlePopState = () => {
      pushedHistoryRef.current = false;
      closePicker();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePicker();
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePicker();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handlePointerDown);
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false;
        if (window.history.state && (window.history.state as { lfpmsCountrySelect?: boolean }).lfpmsCountrySelect) {
          window.history.back();
        }
      }
    };
  }, [open]);

  const handleSelectOption = (code: string) => {
    onChange(code);
    closePicker();
  };

  const renderOptionRow = (c: CountryOption) => {
    const isSelected = normalizedVal.toLowerCase() === c.code.toLowerCase();
    return (
      <button
        key={c.code}
        type="button"
        data-testid={testId ? `${testId}-option-${c.code}` : `country-option-${c.code}`}
        onClick={() => handleSelectOption(c.code)}
        className={`w-full min-h-[40px] px-3 py-2 text-left flex items-center justify-between gap-2 text-[13px] transition-colors ${
          isSelected
            ? 'bg-[#E8F2EE] text-[#0F5132] font-semibold'
            : 'text-[#1C1B18] hover:bg-[#FAF9F6]'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded font-mono-num text-[11px] font-bold shrink-0 ${
              isSelected
                ? 'bg-[#0F5132] text-white'
                : 'bg-[#F1EFEA] text-[#0F5132]'
            }`}
          >
            {c.code}
          </span>
          <span className="truncate">
            <span>{c.nameVi}</span>
            {c.nameVi.toLowerCase() !== c.nameEn.toLowerCase() && (
              <span className="text-[#8A847C] font-normal"> ({c.nameEn})</span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono-num text-[#8A847C]">{c.iso3}</span>
          {isSelected && <Check className="w-4 h-4 text-[#0F5132]" strokeWidth={2} />}
        </span>
      </button>
    );
  };

  const renderListBody = () => (
    <div className="flex flex-col max-h-[65vh] sm:max-h-[320px]">
      {/* Search Box */}
      <div className="p-2.5 border-b border-[#E5E2DC] bg-[#FAF9F6] shrink-0">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-[#8A847C] absolute left-2.5 pointer-events-none" strokeWidth={1.6} />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid={testId ? `${testId}-search` : 'country-select-search'}
            placeholder="Tìm mã hoặc tên (VD: CN, Nga, KR, Mỹ...)"
            className="w-full min-h-[40px] sm:min-h-0 sm:h-9 pl-8 pr-8 rounded-lg border border-[#E5E2DC] bg-white text-[13px] text-[#1C1B18] focus:outline-none focus:border-[#0F5132]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Xóa từ khóa tìm kiếm"
              className="absolute right-2 p-1 text-[#8A847C] hover:text-[#1C1B18]"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="overflow-y-auto flex-1 divide-y divide-[#F5F3EE]">
        {allowEmpty && !trimmedQuery && (
          <button
            type="button"
            data-testid={testId ? `${testId}-option-empty` : 'country-option-empty'}
            onClick={() => handleSelectOption('')}
            className={`w-full min-h-[40px] px-3 py-2 text-left flex items-center justify-between text-[13px] ${
              !value ? 'bg-[#E8F2EE] text-[#0F5132] font-semibold' : 'text-[#57534E] hover:bg-[#FAF9F6]'
            }`}
          >
            <span>{emptyLabel}</span>
            {!value && <Check className="w-4 h-4 text-[#0F5132]" strokeWidth={2} />}
          </button>
        )}

        {priority.length > 0 && (
          <div>
            <div className="sticky top-0 z-10 px-3 py-1.5 bg-[#F4F2EC] text-[11px] font-semibold text-[#57534E] tracking-wide">
              Quốc gia ưu tiên
            </div>
            <div className="divide-y divide-[#F5F3EE]">{priority.map(renderOptionRow)}</div>
          </div>
        )}

        {others.length > 0 && (
          <div>
            <div className="sticky top-0 z-10 px-3 py-1.5 bg-[#F4F2EC] text-[11px] font-semibold text-[#57534E] tracking-wide">
              Tất cả quốc gia
            </div>
            <div className="divide-y divide-[#F5F3EE]">{others.map(renderOptionRow)}</div>
          </div>
        )}

        {trimmedQuery && !exactExists && (
          <button
            type="button"
            data-testid={testId ? `${testId}-option-custom` : 'country-option-custom'}
            onClick={() => handleSelectOption(trimmedQuery.toUpperCase().length <= 3 ? trimmedQuery.toUpperCase() : trimmedQuery)}
            className="w-full min-h-[40px] px-3 py-2 text-left text-[13px] text-[#0F5132] hover:bg-[#E8F2EE]/60 font-medium flex items-center gap-2"
          >
            <Globe className="w-4 h-4 shrink-0" strokeWidth={1.6} />
            <span className="truncate">Dùng giá trị nhập tay: &ldquo;{trimmedQuery}&rdquo;</span>
          </button>
        )}

        {priority.length === 0 && others.length === 0 && !trimmedQuery && (
          <div className="px-3 py-6 text-center text-[12px] text-[#8A847C]">
            Không có dữ liệu quốc gia.
          </div>
        )}
      </div>
    </div>
  );

  const handleToggleOpen = () => {
    if (disabled) return;
    if (!open) {
      const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
      setIsMobileViewport(mobile);
      if (!mobile && containerRef.current && typeof window !== 'undefined') {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        setOpenUpward(spaceBelow < 330 && spaceAbove > spaceBelow);
        setAlignRight(rect.left + 310 > window.innerWidth);
      } else {
        setOpenUpward(false);
        setAlignRight(false);
      }
      setOpen(true);
    } else {
      closePicker();
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        data-testid={testId || 'country-select-trigger'}
        onClick={handleToggleOpen}
        className={`w-full ${
          compact ? 'min-h-[40px] sm:min-h-0 sm:h-8 text-[12px]' : 'min-h-[40px] sm:min-h-0 sm:h-9 text-[13px]'
        } px-2.5 rounded-lg border border-[#E5E2DC] bg-white hover:border-[#0F5132]/60 focus:outline-none focus:border-[#0F5132] disabled:opacity-60 flex items-center justify-between gap-2 text-left transition-colors`}
      >
        <span className="truncate flex items-center gap-1.5 min-w-0">
          {displayLabel ? (
            <>
              {selectedCountry ? (
                <span className="truncate text-[#1C1B18] font-medium">{displayLabel}</span>
              ) : (
                <span className="truncate text-[#1C1B18]">{displayLabel}</span>
              )}
            </>
          ) : (
            <span className="text-[#8A847C] truncate">{allowEmpty ? emptyLabel : placeholder}</span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {allowEmpty && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-0.5 rounded hover:bg-[#F1EFEA] text-[#8A847C] hover:text-[#1C1B18]"
              title="Xóa lọc quốc tịch"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-[#8A847C] transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={1.6}
          />
        </span>
      </button>

      {open && isMobileViewport && (
        <div
          className="fixed inset-0 z-[90] bg-black/45 flex items-end justify-center p-2"
          onClick={closePicker}
        >
          <div
            role="dialog"
            aria-label="Chọn quốc tịch"
            className="w-full max-w-[440px] rounded-2xl bg-white border border-[#E5E2DC] shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3.5 py-2.5 border-b border-[#E5E2DC] flex items-center justify-between bg-white">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1C1B18]">
                <Globe className="w-4 h-4 text-[#0F5132]" strokeWidth={1.75} />
                <span>Chọn Quốc tịch</span>
              </div>
              <button
                type="button"
                onClick={closePicker}
                className="min-w-[40px] min-h-[40px] rounded-lg hover:bg-[#F5F4F0] text-[#57534E] flex items-center justify-center"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>
            {renderListBody()}
          </div>
        </div>
      )}

      {open && !isMobileViewport && (
        <div
          role="listbox"
          className={`absolute ${alignRight ? 'right-0' : 'left-0'} w-[310px] max-w-[calc(100vw-24px)] z-[80] rounded-xl bg-white border border-[#E5E2DC] shadow-lg overflow-hidden ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {renderListBody()}
        </div>
      )}
    </div>
  );
};
