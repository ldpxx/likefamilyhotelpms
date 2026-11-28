import React, { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

/**
 * Mobile-safe input class: uses `text-[16px] sm:text-[13px]` and `min-h-[42px]`
 * so Android WebView / iOS Safari never auto-zooms when focusing inputs.
 */
export const APP_INPUT_CLASS =
  'w-full min-h-[42px] px-3 rounded-xl border border-[#E5E2DC] bg-white text-[16px] sm:text-[13px] text-[#1C1B18] focus:outline-none focus:border-[#0F5132] transition-colors';

export const APP_SELECT_CLASS =
  'w-full min-h-[42px] px-3 rounded-xl border border-[#E5E2DC] bg-white text-[16px] sm:text-[13px] text-[#1C1B18] focus:outline-none focus:border-[#0F5132] transition-colors';

/**
 * Formats an integer amount with Vietnamese thousand separators (e.g. 350000 -> "350.000")
 */
export function formatThousandVnd(value: number): string {
  const clean = Math.max(0, Math.round(Number(value) || 0));
  return clean.toLocaleString('vi-VN');
}

export function parseThousandVnd(raw: string): number {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return 0;
  return Math.max(0, Number(digits) || 0);
}

export interface CurrencyInputProps {
  value: number;
  onChange: (nextValue: number) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  testId?: string;
  id?: string;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  value,
  onChange,
  placeholder = '0',
  disabled = false,
  required = false,
  testId,
  id,
}) => {
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        required={required}
        disabled={disabled}
        data-testid={testId}
        value={value === 0 ? '0' : formatThousandVnd(value)}
        onChange={(e) => onChange(parseThousandVnd(e.target.value))}
        placeholder={placeholder}
        className={`${APP_INPUT_CLASS} pr-14 font-mono-num font-semibold text-right`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-mono-num font-medium text-[#8A847C]">
        VNĐ
      </span>
    </div>
  );
};

export interface AppModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit?: (e: React.FormEvent) => void | Promise<void>;
  submitLabel?: string;
  cancelLabel?: string;
  saving?: boolean;
  submitDisabled?: boolean;
  maxWidthClass?: string;
  testId?: string;
  children: React.ReactNode;
}

export const AppModal: React.FC<AppModalProps> = ({
  open,
  title,
  description,
  onClose,
  onSubmit,
  submitLabel = 'Lưu thay đổi',
  cancelLabel = 'Hủy',
  saving = false,
  submitDisabled = false,
  maxWidthClass = 'max-w-lg',
  testId = 'app-modal',
  children,
}) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = () => {
    const st = window.history.state as { lfpmsDialog?: string } | null;
    if (st?.lfpmsDialog === testId) {
      window.history.back();
      return;
    }
    onCloseRef.current();
  };

  useEffect(() => {
    if (!open) return;
    try {
      const st = window.history.state as { lfpmsDialog?: string } | null;
      if (st?.lfpmsDialog !== testId) {
        window.history.pushState({ ...(st || {}), lfpmsDialog: testId }, '');
      }
    } catch {
      // Ignore History API errors
    }

    const handlePopState = () => {
      const st = window.history.state as { lfpmsDialog?: string } | null;
      if (st?.lfpmsDialog === testId) return;
      onCloseRef.current();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, testId]);

  if (!open) return null;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || submitDisabled) return;
    void onSubmit?.(e);
  };

  return (
    <div
      data-testid={`${testId}-backdrop`}
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className={`w-full ${maxWidthClass} bg-white border border-[#E7E3DA] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#F1EFEA] bg-[#FAF9F6] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[#1C1B18] leading-snug">{title}</h3>
            {description && (
              <p className="text-[12px] text-[#57534E] mt-0.5 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={requestClose}
            aria-label="Đóng hộp thoại"
            data-testid={`${testId}-close-btn`}
            className="w-9 h-9 rounded-xl hover:bg-[#EAE7E0] text-[#57534E] flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Form or Body */}
        {onSubmit ? (
          <form onSubmit={handleFormSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">{children}</div>
            <div className="px-4 sm:px-5 py-3 border-t border-[#F1EFEA] bg-[#FAF9F6] flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                disabled={saving}
                onClick={requestClose}
                data-testid={`${testId}-cancel-btn`}
                className="min-h-[42px] px-4 rounded-xl border border-[#E5E2DC] bg-white hover:bg-[#F5F4F0] text-[#57534E] text-[13px] font-medium transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                type="submit"
                disabled={saving || submitDisabled}
                data-testid={`${testId}-submit-btn`}
                className="min-h-[42px] px-5 rounded-xl bg-[#0F5132] hover:bg-[#0B3D26] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors"
              >
                {saving ? 'Đang lưu...' : submitLabel}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">{children}</div>
            <div className="px-4 sm:px-5 py-3 border-t border-[#F1EFEA] bg-[#FAF9F6] flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={requestClose}
                data-testid={`${testId}-cancel-btn`}
                className="min-h-[42px] px-4 rounded-xl border border-[#E5E2DC] bg-white hover:bg-[#F5F4F0] text-[#57534E] text-[13px] font-medium transition-colors"
              >
                {cancelLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  variant?: 'primary' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  testId?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  variant = 'primary',
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Hủy',
  busy = false,
  onConfirm,
  onCancel,
  testId = 'confirm-dialog',
}) => {
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const requestCancel = () => {
    const st = window.history.state as { lfpmsDialog?: string } | null;
    if (st?.lfpmsDialog === testId) {
      window.history.back();
      return;
    }
    onCancelRef.current();
  };

  useEffect(() => {
    if (!open) return;
    try {
      const st = window.history.state as { lfpmsDialog?: string } | null;
      if (st?.lfpmsDialog !== testId) {
        window.history.pushState({ ...(st || {}), lfpmsDialog: testId }, '');
      }
    } catch {
      // Ignore History API errors
    }

    const handlePopState = () => {
      const st = window.history.state as { lfpmsDialog?: string } | null;
      if (st?.lfpmsDialog === testId) return;
      onCancelRef.current();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestCancel();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, testId]);

  if (!open) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      data-testid={`${testId}-backdrop`}
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) requestCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="w-full max-w-md bg-white border border-[#E7E3DA] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isDanger
                  ? 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]'
                  : 'bg-[#E8F3EC] text-[#0F5132] border border-[#BBF7D0]'
              }`}
            >
              {isDanger ? (
                <AlertTriangle className="w-5 h-5" strokeWidth={1.75} />
              ) : (
                <CheckCircle2 className="w-5 h-5" strokeWidth={1.75} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold text-[#1C1B18] leading-snug">{title}</h3>
              <div className="mt-1.5 text-[13px] text-[#57534E] leading-relaxed whitespace-pre-line">
                {message}
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#F1EFEA] bg-[#FAF9F6] flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={requestCancel}
            data-testid={`${testId}-cancel-btn`}
            className="min-h-[42px] px-4 rounded-xl border border-[#E5E2DC] bg-white hover:bg-[#F5F4F0] text-[#57534E] text-[13px] font-medium transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            data-testid={`${testId}-confirm-btn`}
            className={`min-h-[42px] px-5 rounded-xl text-white text-[13px] font-semibold transition-colors disabled:opacity-50 ${
              isDanger
                ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
                : 'bg-[#0F5132] hover:bg-[#0B3D26]'
            }`}
          >
            {busy ? 'Đang xử lý...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
