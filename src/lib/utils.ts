import type {
  Booking,
  DailyRate,
  HourlyPricingConfig,
  Occupant,
  PaymentMethod,
  StaffPermissions,
  StaffRole,
  Transaction,
} from '../types/pms';

export function formatCurrency(amount: number | undefined | null): string {
  const val = Math.round(Number(amount) || 0);
  return new Intl.NumberFormat('vi-VN').format(val) + 'đ';
}

export function formatNumber(amount: number | undefined | null): string {
  const val = Math.round(Number(amount) || 0);
  return new Intl.NumberFormat('vi-VN').format(val);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function diffDays(startIso: string, endIso: string): number {
  const a = parseISODate(startIso).getTime();
  const b = parseISODate(endIso).getTime();
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

/** Standard Vietnam dd/mm/YYYY date format used 100% system-wide */
export function formatDateVN(iso: string | undefined | null): string {
  if (!iso) return '—';
  const clean = iso.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatDateTimeVN(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return formatDateVN(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${hh}:${mi} ${dd}/${mm}/${yyyy}`;
}

export function formatShortDate(iso: string): string {
  const parts = iso.slice(0, 10).split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

export function getWeekdayLabelVN(iso: string): string {
  const d = parseISODate(iso);
  const map = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return map[d.getDay()];
}

export function isWeekendISO(iso: string): boolean {
  const day = parseISODate(iso).getDay();
  return day === 0 || day === 6;
}

export function normalizeVietnamese(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizePhone(phone: string | undefined | null): string {
  if (!phone) return '';
  let digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('84') && digits.length >= 10) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

export function generateCode(prefix: string): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${yy}${mm}${dd}-${rand}`;
}

export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 3-Tier Progressive Hourly Room Rate Formula (v1.1.0):
 * - h === 1: firstHourPrice
 * - h === 2: firstHourPrice + secondHourPrice
 * - h >= 3: firstHourPrice + secondHourPrice + (h - 2) * additionalHourPrice
 */
export function calculateHourlyRoomTotal(
  hours: number,
  config?: HourlyPricingConfig | null
): number {
  const h = Math.max(0, Math.round(hours || 0));
  if (h === 0) return 0;
  const first = Math.max(0, Math.round(config?.firstHourPrice ?? 150000));
  const second = Math.max(0, Math.round(config?.secondHourPrice ?? 50000));
  const additional = Math.max(0, Math.round(config?.additionalHourPrice ?? 30000));
  if (h === 1) return first;
  if (h === 2) return first + second;
  return first + second + (h - 2) * additional;
}

export function buildDailyRates(
  checkIn: string,
  checkOut: string,
  defaultRate: number,
  existing?: DailyRate[]
): DailyRate[] {
  const nights = Math.max(1, diffDays(checkIn, checkOut));
  const existingMap = new Map<string, number>();
  (existing || []).forEach((d) => existingMap.set(d.date, d.rate));
  const rates: DailyRate[] = [];
  for (let i = 0; i < nights; i++) {
    const date = addDays(checkIn, i);
    rates.push({
      date,
      rate: existingMap.has(date) ? (existingMap.get(date) as number) : defaultRate,
    });
  }
  return rates;
}

export function applyUniformDailyRate(dailyRates: DailyRate[], singleRate: number): DailyRate[] {
  const clean = Math.max(0, Math.round(singleRate));
  return dailyRates.map((d) => ({ ...d, rate: clean }));
}

export function splitTotalToDailyRates(dailyRates: DailyRate[], desiredTotal: number): DailyRate[] {
  const count = dailyRates.length;
  if (count === 0) return [];
  const total = Math.max(0, Math.round(desiredTotal));
  if (count === 1) {
    return [{ ...dailyRates[0], rate: total }];
  }
  const exactAvg = total / count;
  const baseRate =
    total >= count * 1000 ? Math.floor(exactAvg / 1000) * 1000 : Math.floor(exactAvg);
  const sumBeforeLast = baseRate * (count - 1);
  const lastRate = Math.max(0, total - sumBeforeLast);
  return dailyRates.map((d, idx) => ({
    ...d,
    rate: idx === count - 1 ? lastRate : baseRate,
  }));
}

export function sumDailyRates(dailyRates: DailyRate[]): number {
  return dailyRates.reduce((acc, d) => acc + (Number(d.rate) || 0), 0);
}

export function isDateRangeOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function isBookingBlockingCalendar(status: Booking['status']): boolean {
  return status === 'reserved' || status === 'in_house';
}

export function checkStayPermitAlert(occupants: Occupant[], checkOut: string): boolean {
  const today = todayISO();
  const warnLimit = addDays(today, 2);
  return occupants.some((occ) => {
    if (occ.guestCategory !== 'foreigner' || !occ.stayPermitExpiryDate) return false;
    const expiry = occ.stayPermitExpiryDate.slice(0, 10);
    return expiry < checkOut || expiry <= warnLimit;
  });
}

export function computeOccupantFlags(occupants: Occupant[], checkOut: string) {
  const hasForeigner = occupants.some((o) => o.guestCategory === 'foreigner');
  const hasPendingAsm = occupants.some(
    (o) => o.guestCategory === 'foreigner' && o.asmStatus === 'pending_asm'
  );
  const hasStayPermitAlert = checkStayPermitAlert(occupants, checkOut);
  return {
    occupantCount: Math.max(1, occupants.length),
    hasForeigner,
    hasPendingAsm,
    hasStayPermitAlert,
  };
}

export function getBookingTotalReceivable(b: Booking): number {
  return Math.round((b.grossRoomTotal || 0) + (b.serviceTotal || 0) + (b.hourlySurcharge || 0));
}

export function getBookingGuestBalance(b: Booking): number {
  if (b.source === 'ota' && b.paymentMethod === 'ota_debt') {
    // Room total is tracked under OTA Receivable Debt; guest only pays services & hourly surcharge at desk
    const guestCharge = (b.serviceTotal || 0) + (b.hourlySurcharge || 0);
    return Math.round(guestCharge - (b.guestPaid || 0));
  }
  const total = (b.grossRoomTotal || 0) + (b.serviceTotal || 0) + (b.hourlySurcharge || 0);
  return Math.round(total - (b.depositPaid || 0) - (b.guestPaid || 0));
}

export function getDefaultPermissionsForRole(role: StaffRole): StaffPermissions {
  if (role === 'superadmin') {
    return {
      canViewProfit: true,
      canEditPrice: true,
      canUndoAction: true,
      canManageStaff: true,
      canCleanupPhotos: true,
      canFullBackup: true,
      canEditFormTemplates: true,
      canManageConfig: true,
    };
  }
  if (role === 'owner') {
    return {
      canViewProfit: true,
      canEditPrice: true,
      canUndoAction: true,
      canManageStaff: true,
      canCleanupPhotos: false,
      canFullBackup: true,
      canEditFormTemplates: true,
      canManageConfig: true,
    };
  }
  if (role === 'manager') {
    return {
      canViewProfit: true,
      canEditPrice: true,
      canUndoAction: true,
      canManageStaff: true,
      canCleanupPhotos: false,
      canFullBackup: false,
      canEditFormTemplates: false,
      canManageConfig: true,
    };
  }
  if (role === 'receptionist') {
    return {
      canViewProfit: false,
      canEditPrice: true,
      canUndoAction: true,
      canManageStaff: false,
      canCleanupPhotos: false,
      canFullBackup: false,
      canEditFormTemplates: false,
      canManageConfig: false,
    };
  }
  return {
    canViewProfit: false,
    canEditPrice: false,
    canUndoAction: false,
    canManageStaff: false,
    canCleanupPhotos: false,
    canFullBackup: false,
    canEditFormTemplates: false,
    canManageConfig: false,
  };
}

export function getPaymentMethodLabel(method: PaymentMethod | string | undefined): string {
  const map: Record<string, string> = {
    cash: 'Tiền mặt',
    bank_transfer: 'Chuyển khoản (VietQR)',
    card: 'Quẹt thẻ',
    ota_debt: 'Công nợ OTA',
    ota_collect: 'Công nợ OTA',
  };
  return map[method || ''] || method || '—';
}

export function getRoleLabel(role: StaffRole): string {
  const map: Record<StaffRole, string> = {
    superadmin: 'SuperAdmin gốc',
    owner: 'Chủ khách sạn',
    manager: 'Quản lý',
    receptionist: 'Lễ tân',
    housekeeping: 'Buồng phòng',
  };
  return map[role] || role;
}

export function getSourceLabel(
  source: Booking['source'],
  otaChannel?: string | null,
  sourceLabel?: string
): string {
  if (source === 'ota') return otaChannel || sourceLabel || 'OTA';
  if (sourceLabel) return sourceLabel;
  const map: Record<Booking['source'], string> = {
    walk_in: 'Khách vãng lai',
    loyal_guest: 'Khách quen',
    phone: 'Điện thoại',
    zalo: 'Zalo',
    facebook: 'Facebook',
    ota: 'OTA',
    corporate: 'Công ty',
    group: 'Khách đoàn',
  };
  return map[source] || source;
}

export function getStatusLabel(status: Booking['status']): string {
  const map: Record<Booking['status'], string> = {
    reserved: 'Đặt trước',
    in_house: 'Đang lưu trú',
    checked_out: 'Đã trả phòng',
    cancelled: 'Đã hủy',
    no_show: 'Không đến (No-show)',
    transferred: 'Đã chuyển phòng',
  };
  return map[status] || status;
}

export function getCancellationTypeLabel(type?: Booking['cancellationType']): string {
  if (type === 'no_show') return 'Khách không đến (No-show)';
  if (type === 'void_entry_error') return 'Hủy do nhập sai (Void)';
  if (type === 'customer_cancelled') return 'Khách báo hủy';
  return 'Đã hủy';
}

export function getDepositResolutionLabel(status?: Booking['depositResolutionStatus']): string {
  const map: Record<string, string> = {
    none: 'Không có tiền cọc',
    pending_deposit_resolution: 'Chờ xử lý tiền cọc',
    refunded: 'Đã hoàn tiền cọc',
    forfeited_fee: 'Giữ cọc (Phí hủy)',
    transferred_to_booking: 'Đã chuyển cọc sang đơn khác',
  };
  return map[status || 'none'] || '—';
}

export function getOtaCancelStatusLabel(status?: Booking['otaCancelStatus']): string {
  const map: Record<string, string> = {
    none: '—',
    ota_cancel_requested: 'Yêu cầu hủy OTA',
    ota_cancel_confirmed: 'OTA đã xác nhận hủy',
    ota_cancel_reconciled: 'Đã đối soát công nợ hủy OTA',
  };
  return map[status || 'none'] || '—';
}

export function getHkStatusLabel(status: 'clean' | 'dirty' | 'cleaning' | 'maintenance'): string {
  const map = {
    clean: 'Sạch sẵn sàng',
    dirty: 'Chờ dọn',
    cleaning: 'Đang dọn',
    maintenance: 'Bảo trì',
  };
  return map[status];
}

export function isLoyalGuest(stayCount: number | undefined | null): boolean {
  return (stayCount || 0) >= 2;
}

/**
 * Determines whether a booking/leg counts toward realized P&L room revenue,
 * sold room nights, Occupancy %, ADR, and RevPAR.
 * - Includes ONLY valid actual stays (`in_house`, `checked_out`, valid `transferred`).
 * - Strictly excludes `reserved`, `cancelled`, `no_show`, and any voided booking.
 * - For Split-Stay `transferred` legs: excludes the leg if the chain has no remaining
 *   active/completed stay AND was voided or 100% cancelled/refunded (net cash retained <= 0).
 */
export function isBookingEligibleForPnLRevenue(
  booking: Booking,
  allBookings: Booking[],
  allTransactions: Transaction[]
): boolean {
  if (
    booking.status === 'cancelled' ||
    booking.status === 'no_show' ||
    booking.status === 'reserved'
  ) {
    return false;
  }
  if (booking.cancellationType === 'void_entry_error' || Boolean(booking.voidCheckedOutAt)) {
    return false;
  }

  if (booking.status === 'transferred') {
    const chainLegs = booking.bookingChainId
      ? allBookings.filter((b) => b.bookingChainId === booking.bookingChainId)
      : allBookings.filter(
          (b) =>
            b.id === booking.id ||
            (b.bookingCode && b.bookingCode.startsWith(`${booking.bookingCode}-T`))
        );

    const otherLegs = chainLegs.filter((b) => b.id !== booking.id);
    if (otherLegs.length === 0) return true;

    const hasValidOtherStay = otherLegs.some(
      (leg) =>
        (leg.status === 'in_house' || leg.status === 'checked_out') &&
        leg.cancellationType !== 'void_entry_error' &&
        !leg.voidCheckedOutAt
    );
    if (hasValidOtherStay) return true;

    const hasVoidedLeg = chainLegs.some(
      (leg) => leg.cancellationType === 'void_entry_error' || Boolean(leg.voidCheckedOutAt)
    );
    if (hasVoidedLeg) return false;

    const allOtherCancelled = otherLegs.every(
      (leg) => leg.status === 'cancelled' || leg.status === 'no_show'
    );
    if (allOtherCancelled) {
      const chainIdSet = new Set(chainLegs.map((l) => l.id));
      const chainCodeSet = new Set(chainLegs.map((l) => l.bookingCode));
      let chainNetRetained = 0;

      for (const tx of allTransactions) {
        if (tx.status !== 'active') continue;
        const belongsToChain =
          (tx.bookingId && chainIdSet.has(tx.bookingId)) ||
          (tx.bookingCode && chainCodeSet.has(tx.bookingCode));
        if (!belongsToChain) continue;
        if (
          tx.type === 'reclassification_in' ||
          tx.type === 'reclassification_out' ||
          tx.type === 'cancellation_fee'
        ) {
          continue;
        }
        chainNetRetained += tx.direction === 'in' ? tx.amount : -tx.amount;
      }

      // If entire cancelled chain has 0đ or negative net retained cash (100% refunded/uncollected),
      // the prior transferred leg MUST NOT count into P&L revenue or room nights.
      if (chainNetRetained <= 0) return false;
    }
  }

  return booking.status === 'in_house' || booking.status === 'checked_out' || booking.status === 'transferred';
}
