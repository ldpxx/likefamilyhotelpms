import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';
import { formatDateVN } from '../lib/utils';

interface DateInputVNProps {
  value: string; // ISO YYYY-MM-DD
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Displays dates strictly in Vietnam standard `dd/mm/YYYY` across all browsers/OS locales,
 * backed by a native calendar picker trigger so staff never see `mm/dd/yyyy`.
 */
export const DateInputVN: React.FC<DateInputVNProps> = ({
  value,
  onChange,
  min,
  max,
  disabled = false,
  required = false,
  placeholder = 'dd/mm/yyyy',
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    if (disabled || !inputRef.current) return;
    const el = inputRef.current as HTMLInputElement & { showPicker?: () => void };
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        // fallback to focus/click
      }
    }
    el.focus();
    el.click();
  };

  const display = value ? formatDateVN(value) : '';

  return (
    <div
      onClick={openPicker}
      className={`relative flex items-center h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] font-mono-num select-none ${
        disabled
          ? 'opacity-60 cursor-not-allowed bg-[#FAF9F6]'
          : 'cursor-pointer hover:border-[#B8B2A6] focus-within:border-[#1B5E4B]'
      } ${className}`}
    >
      <Calendar
        className="w-3.5 h-3.5 text-[#8A847C] mr-2 shrink-0 pointer-events-none"
        strokeWidth={1.5}
      />
      <span className={display ? 'text-[#1C1B18]' : 'text-[#8A847C]'}>
        {display || placeholder}
      </span>
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Chọn ngày"
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
      />
    </div>
  );
};
