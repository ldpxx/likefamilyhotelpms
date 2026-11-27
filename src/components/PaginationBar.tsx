import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export interface PaginationState<T> {
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  totalItems: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  pageItems: T[];
}

/**
 * Reusable client-side pagination hook.
 * Automatically resets to page 1 whenever `resetKey` or `pageSize` changes,
 * while clamping safely if `items.length` shrinks.
 */
export function usePagination<T>(
  items: T[],
  resetKey: string | number = '',
  defaultPageSize = 20
): PaginationState<T> {
  const [page, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(defaultPageSize);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    setPageRaw(1);
  }, [resetKey, pageSize]);

  useEffect(() => {
    if (page > totalPages) {
      setPageRaw(totalPages);
    }
  }, [page, totalPages]);

  const setPage = (next: number) => {
    setPageRaw(Math.min(Math.max(1, next), totalPages));
  };

  const setPageSize = (nextSize: number) => {
    setPageSizeRaw(nextSize);
    setPageRaw(1);
  };

  const startIndex = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endIndex = Math.min(totalItems, safePage * pageSize);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    totalPages,
    startIndex,
    endIndex,
    pageItems,
  };
}

interface PaginationBarProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  testId?: string;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  testId,
}) => {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(totalItems, safePage * pageSize);

  return (
    <div
      data-testid={testId}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2.5 px-1 text-[12px] text-[#57534E] max-w-full"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span data-testid={testId ? `${testId}-summary` : undefined} className="font-mono-num">
          Hiển thị <strong className="text-[#1C1B18]">{start}–{end}</strong> /{' '}
          <strong className="text-[#1C1B18]">{totalItems}</strong> bản ghi
        </span>
        <label className="inline-flex items-center gap-1.5">
          <span className="text-[#8A847C]">Mỗi trang:</span>
          <select
            aria-label="Số bản ghi mỗi trang"
            data-testid={testId ? `${testId}-pagesize` : undefined}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) || 20)}
            className="min-h-[38px] sm:min-h-[34px] px-2 rounded-lg border border-[#E7E3DA] bg-white text-[#1C1B18] font-mono-num text-[12px] focus:outline-none focus:border-[#0F5132]"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(1)}
          aria-label="Trang đầu"
          data-testid={testId ? `${testId}-first` : undefined}
          className="min-h-[38px] min-w-[38px] px-2 rounded-lg border border-[#E7E3DA] bg-white hover:bg-[#FAF9F6] disabled:opacity-40 disabled:pointer-events-none text-[#1C1B18] inline-flex items-center justify-center gap-1 font-medium transition-colors"
        >
          <ChevronsLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span className="hidden md:inline">Đầu</span>
        </button>
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Trang trước"
          data-testid={testId ? `${testId}-prev` : undefined}
          className="min-h-[38px] px-2.5 rounded-lg border border-[#E7E3DA] bg-white hover:bg-[#FAF9F6] disabled:opacity-40 disabled:pointer-events-none text-[#1C1B18] inline-flex items-center justify-center gap-1 font-medium transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Trước</span>
        </button>

        <span
          data-testid={testId ? `${testId}-page-indicator` : undefined}
          className="min-h-[38px] px-3 rounded-lg bg-[#E8F3EC] border border-[#0F5132]/20 text-[#0F5132] font-mono-num font-semibold inline-flex items-center justify-center"
        >
          {safePage} / {totalPages}
        </span>

        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Trang sau"
          data-testid={testId ? `${testId}-next` : undefined}
          className="min-h-[38px] px-2.5 rounded-lg border border-[#E7E3DA] bg-white hover:bg-[#FAF9F6] disabled:opacity-40 disabled:pointer-events-none text-[#1C1B18] inline-flex items-center justify-center gap-1 font-medium transition-colors"
        >
          <span>Sau</span>
          <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          aria-label="Trang cuối"
          data-testid={testId ? `${testId}-last` : undefined}
          className="min-h-[38px] min-w-[38px] px-2 rounded-lg border border-[#E7E3DA] bg-white hover:bg-[#FAF9F6] disabled:opacity-40 disabled:pointer-events-none text-[#1C1B18] inline-flex items-center justify-center gap-1 font-medium transition-colors"
        >
          <span className="hidden md:inline">Cuối</span>
          <ChevronsRight className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
};
