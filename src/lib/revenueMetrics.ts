import type { AuditLog, Booking, BookingServiceItem, RoomMaintenance, Transaction } from '../types/pms';
import {
  diffDays,
  getSourceLabel,
  isBookingEligibleForPnLRevenue,
  parseISODate,
} from './utils';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converts an ISO date (`YYYY-MM-DD`) or UTC timestamp string into a fixed
 * `YYYY-MM-DD` business date in `Asia/Ho_Chi_Minh` (UTC+7).
 */
export function toVietnamISODate(input?: string | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (ISO_DATE_RE.test(trimmed)) return trimmed;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  const vn = new Date(ms + VN_OFFSET_MS);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface LegacyServiceDateReviewItem {
  bookingId: string;
  bookingCode: string;
  roomNumber: string;
  serviceId: string | null;
  serviceName: string;
  amount: number;
  flag: 'LEGACY_DATE_REVIEW_REQUIRED';
  resolvedFallbackDate: string;
  evidenceNote: string;
}

/**
 * Resolves a single immutable accounting `businessDate` (YYYY-MM-DD, Asia/Ho_Chi_Minh)
 * for a service item — NEVER dependent on the queried P&L range `[fromDateISO, toDateISO]`.
 */
export function resolveServiceBusinessDate(
  service: BookingServiceItem,
  booking: Pick<Booking, 'id' | 'checkIn' | 'checkOut'>,
  linkedTransactions?: Transaction[],
  auditLogs?: AuditLog[]
): { businessDate: string; source: 'businessDate' | 'occurredAt' | 'addedAt' | 'transaction' | 'audit_log' | 'legacy_fallback' } {
  const direct = toVietnamISODate(service.businessDate);
  if (direct) return { businessDate: direct, source: 'businessDate' };

  const occ = toVietnamISODate(service.occurredAt);
  if (occ) return { businessDate: occ, source: 'occurredAt' };

  const added = toVietnamISODate(service.addedAt);
  if (added) return { businessDate: added, source: 'addedAt' };

  if (linkedTransactions && linkedTransactions.length > 0) {
    const matchTx = linkedTransactions.find(
      (t) => t.bookingId === booking.id && t.status === 'active' && t.amount === service.total && t.date
    );
    const txDate = toVietnamISODate(matchTx?.date);
    if (txDate) return { businessDate: txDate, source: 'transaction' };
  }

  if (auditLogs && auditLogs.length > 0) {
    const matchLog = auditLogs.find(
      (l) => l.targetId === booking.id && (l.actionType.includes('service') || l.actionType.includes('adjustment'))
    );
    const logDate = toVietnamISODate(matchLog?.timestamp);
    if (logDate) return { businessDate: logDate, source: 'audit_log' };
  }

  // Traceable migration fallback (flagged by auditLegacyServiceDates)
  return { businessDate: booking.checkIn, source: 'legacy_fallback' };
}

/**
 * Resolves a single immutable accounting date for `booking.hourlySurcharge` based purely
 * on surcharge type (late check-out -> checkOut, early check-in / extra guest -> checkIn),
 * NEVER shifting dynamically with the queried report range.
 */
export function resolveSurchargeBusinessDate(
  booking: Pick<Booking, 'bookingMode' | 'checkIn' | 'checkOut' | 'hourlySurchargeNote'>
): string {
  if (booking.bookingMode === 'hourly') return booking.checkIn;
  const note = (booking.hourlySurchargeNote || '').toLowerCase();
  if (note.includes('muộn') || note.includes('late')) {
    return booking.checkOut;
  }
  return booking.checkIn;
}

/**
 * Read-only audit queue for legacy bookings whose services lack an explicit
 * `businessDate` / `occurredAt` / `addedAt` (flags `LEGACY_DATE_REVIEW_REQUIRED`
 * without mutating original records).
 */
export function auditLegacyServiceDates(
  allBookings: Booking[],
  allTransactions: Transaction[] = [],
  auditLogs: AuditLog[] = []
): LegacyServiceDateReviewItem[] {
  const queue: LegacyServiceDateReviewItem[] = [];
  for (const b of allBookings) {
    const services = (b.services || []).filter((s) => s.status !== 'voided');
    if (services.length > 0) {
      for (const srv of services) {
        const res = resolveServiceBusinessDate(srv, b, allTransactions, auditLogs);
        if (res.source === 'legacy_fallback') {
          queue.push({
            bookingId: b.id,
            bookingCode: b.bookingCode,
            roomNumber: b.roomNumber,
            serviceId: srv.id,
            serviceName: srv.name,
            amount: srv.total,
            flag: 'LEGACY_DATE_REVIEW_REQUIRED',
            resolvedFallbackDate: res.businessDate,
            evidenceNote: 'Thiếu businessDate/occurredAt/addedAt, không khớp giao dịch hay audit_logs; tạm đối chiếu theo checkIn.',
          });
        }
      }
    } else if ((b.serviceTotal || 0) > 0) {
      queue.push({
        bookingId: b.id,
        bookingCode: b.bookingCode,
        roomNumber: b.roomNumber,
        serviceId: null,
        serviceName: 'Tổng dịch vụ legacy (không có dòng services[])',
        amount: b.serviceTotal,
        flag: 'LEGACY_DATE_REVIEW_REQUIRED',
        resolvedFallbackDate: b.checkIn,
        evidenceNote: 'Booking có serviceTotal > 0 nhưng mảng services[] rỗng; tạm hạch toán cố định theo checkIn.',
      });
    }
  }
  return queue;
}

export interface RevenueRangeOptions {
  roomCount?: number;
  sourceFilter?: string;
  roomTypeFilter?: string;
}

export interface RevenueRangeMetrics {
  eligibleBookings: Booking[];
  roomRev: number;
  serviceRev: number;
  forfeitedCancelFees: number;
  totalRevenue: number;
  soldNights: number;
  hourlyBookingsCount: number;
  hourlyHoursTotal: number;
  occupancyPct: number;
  adr: number;
  revPar: number;
  unsettledOtaDebt: number;
  bySource: Array<[string, number]>;
}

/**
 * SINGLE SOURCE OF TRUTH for P&L Revenue, Sold Room Nights, Hourly Counts, Occupancy %, ADR & RevPAR.
 * Used identically across DashboardView, FinanceReportsView (P&L + Room-Type Breakdown), and 12-Month Report.
 *
 * Rules enforced (v2.2.1):
 * 1. Strictly filters through `isBookingEligibleForPnLRevenue()` (excludes reserved, cancelled, no_show, void,
 *    and 100%-refunded/voided Split-Stay `transferred` chains).
 * 2. Overnight stays: pro-rates `dailyRates` strictly for dates `dr.date` inside `[fromDateISO, toDateISO]`.
 * 3. Hourly stays (`bookingMode === 'hourly'`): adds `grossRoomTotal` to `roomRev` when `checkIn` is in
 *    `[fromDateISO, toDateISO]`, increments `hourlyBookingsCount` & `hourlyHoursTotal`, and NEVER adds to `soldNights`.
 * 4. Room consolidation (`transferredBalance`): NEVER counted as revenue (kept strictly on payable balance only).
 */
export function getRoomRevenueInRange(
  allBookings: Booking[],
  allTransactions: Transaction[],
  fromDateISO: string,
  toDateISO: string,
  options: RevenueRangeOptions = {}
): RevenueRangeMetrics {
  const { roomCount = 1, sourceFilter = 'all', roomTypeFilter = 'all' } = options;

  const matchesFilters = (b: Booking): boolean => {
    if (sourceFilter !== 'all') {
      if (sourceFilter === 'ota' && b.source !== 'ota') return false;
      if (
        sourceFilter !== 'ota' &&
        b.source !== sourceFilter &&
        b.otaChannel !== sourceFilter &&
        b.sourceLabel !== sourceFilter
      ) {
        return false;
      }
    }
    if (roomTypeFilter !== 'all' && b.roomTypeId !== roomTypeFilter) return false;
    return true;
  };

  const allPnLEligible = allBookings.filter(
    (b) => isBookingEligibleForPnLRevenue(b, allBookings, allTransactions) && matchesFilters(b)
  );

  const eligibleBookings = allPnLEligible.filter((b) => {
    if (b.bookingMode === 'hourly') {
      return b.checkIn >= fromDateISO && b.checkIn <= toDateISO;
    }
    return b.checkOut > fromDateISO && b.checkIn <= toDateISO;
  });

  let roomRev = 0;
  let serviceRev = 0;
  let soldNights = 0;
  let hourlyBookingsCount = 0;
  let hourlyHoursTotal = 0;
  let unsettledOtaDebt = 0;
  const bySourceMap = new Map<string, number>();

  for (const b of eligibleBookings) {
    let bRoomRevInPeriod = 0;

    if (b.bookingMode === 'hourly') {
      bRoomRevInPeriod = b.grossRoomTotal || 0;
      roomRev += bRoomRevInPeriod;
      hourlyBookingsCount += 1;
      hourlyHoursTotal += b.hourlyHours || 1;
    } else {
      let bNightsInPeriod = 0;
      const rates = b.dailyRates || [];
      for (const dr of rates) {
        if (dr.date >= fromDateISO && dr.date <= toDateISO) {
          bRoomRevInPeriod += dr.rate || 0;
          bNightsInPeriod += 1;
        }
      }
      // Fallback if legacy booking lacks dailyRates array
      if (rates.length === 0) {
        const effStart = b.checkIn > fromDateISO ? b.checkIn : fromDateISO;
        const effEndExclusive =
          b.checkOut <= toDateISO ? b.checkOut : toDateISO;
        const overlapNights = Math.max(
          0,
          diffDays(effStart, effEndExclusive) + (b.checkOut > toDateISO ? 1 : 0)
        );
        const totalNights = Math.max(1, b.nights || 1);
        bNightsInPeriod = Math.min(totalNights, overlapNights);
        bRoomRevInPeriod = Math.round(((b.grossRoomTotal || 0) * bNightsInPeriod) / totalNights);
      }

      roomRev += bRoomRevInPeriod;
      soldNights += bNightsInPeriod;
    }

    if (bRoomRevInPeriod > 0) {
      const srcLabel = getSourceLabel(b.source, b.otaChannel, b.sourceLabel);
      bySourceMap.set(srcLabel, (bySourceMap.get(srcLabel) || 0) + bRoomRevInPeriod);
    }

    if (
      (b.source === 'ota' || b.paymentMethod === 'ota_debt') &&
      b.otaSettlementStatus !== 'settled'
    ) {
      unsettledOtaDebt += bRoomRevInPeriod;
    }
  }

  // v2.2.2 BUG-01 FIX: Attribute every active service item & surcharge to ONE immutable
  // businessDate (Asia/Ho_Chi_Minh YYYY-MM-DD), completely independent of `[fromDateISO, toDateISO]`.
  // Guarantees `serviceRev(A, B) + serviceRev(B+1, C) === serviceRev(A, C)` with 0đ variance!
  for (const b of allPnLEligible) {
    const allServices = b.services || [];
    if (allServices.length > 0) {
      const activeServices = allServices.filter((s) => s.status !== 'voided');
      for (const srv of activeServices) {
        const { businessDate } = resolveServiceBusinessDate(srv, b, allTransactions);
        if (businessDate >= fromDateISO && businessDate <= toDateISO) {
          serviceRev += srv.total || 0;
        }
      }
    } else if ((b.serviceTotal || 0) > 0) {
      // Legacy booking with aggregate serviceTotal but empty services[]
      if (b.checkIn >= fromDateISO && b.checkIn <= toDateISO) {
        serviceRev += b.serviceTotal || 0;
      }
    }

    if ((b.hourlySurcharge || 0) > 0) {
      const surchargeDate = resolveSurchargeBusinessDate(b);
      if (surchargeDate >= fromDateISO && surchargeDate <= toDateISO) {
        serviceRev += b.hourlySurcharge || 0;
      }
    }
  }

  // Only explicit forfeited cancellation fees count into P&L revenue (NEVER pending_deposit_resolution!)
  const forfeitedCancelFees = allBookings
    .filter((b) => {
      if (!matchesFilters(b)) return false;
      if (b.status !== 'cancelled' && b.status !== 'no_show') return false;
      if (b.depositResolutionStatus !== 'forfeited_fee') return false;
      const resolvedDate = (b.depositResolvedAt || b.cancelledAt || '').slice(0, 10);
      return resolvedDate >= fromDateISO && resolvedDate <= toDateISO;
    })
    .reduce((s, b) => s + (b.forfeitedFeeAmount || 0), 0);

  const totalRevenue = roomRev + serviceRev + forfeitedCancelFees;
  const rangeDays = Math.max(1, diffDays(fromDateISO, toDateISO) + 1);
  const totalRoomNightsAvailable = Math.max(1, Math.max(1, roomCount) * rangeDays);
  const occupancyPct = Math.min(
    100,
    Math.round((soldNights / totalRoomNightsAvailable) * 1000) / 10
  );
  const adr = soldNights > 0 ? Math.round(roomRev / soldNights) : 0;
  const revPar = Math.round(roomRev / totalRoomNightsAvailable);
  const bySource = Array.from(bySourceMap.entries()).sort((a, b) => b[1] - a[1]);

  return {
    eligibleBookings,
    roomRev,
    serviceRev,
    forfeitedCancelFees,
    totalRevenue,
    soldNights,
    hourlyBookingsCount,
    hourlyHoursTotal,
    occupancyPct,
    adr,
    revPar,
    unsettledOtaDebt,
    bySource,
  };
}

/**
 * Converts ISO date `YYYY-MM-DD` + `HH:mm` into a local epoch timestamp (ms).
 */
export function dateTimeToMs(isoDate: string, hhmm: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = (hhmm || '00:00').split(':').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).getTime();
}

export interface BookingTimeInterval {
  startMs: number;
  endMs: number;
  endWithBufferMs: number;
}

/**
 * Converts ANY booking (overnight OR same-day hourly with `checkIn === checkOut`) into exact
 * timestamp interval `[startMs, endMs)` plus cleaning buffer (`default 5 minutes` per rev3 spec).
 */
export function getBookingInterval(
  b: Pick<Booking, 'bookingMode' | 'checkIn' | 'checkOut' | 'checkInTime' | 'checkOutTime' | 'hourlyHours'>,
  defaultCheckInTime = '14:00',
  defaultCheckOutTime = '12:00',
  cleaningBufferMinutes = 5
): BookingTimeInterval {
  const bufferMs = Math.max(0, cleaningBufferMinutes) * 60 * 1000;

  if (b.bookingMode === 'hourly') {
    const startTime = b.checkInTime || '14:00';
    const startMs = dateTimeToMs(b.checkIn, startTime);
    let endMs: number;
    if (b.checkOutTime) {
      const endDate = b.checkOut && b.checkOut >= b.checkIn ? b.checkOut : b.checkIn;
      const candidateEnd = dateTimeToMs(endDate, b.checkOutTime);
      // Guard against legacy hourly records that saved checkOut = checkIn + 1 day for a same-day slot
      if (
        endDate > b.checkIn &&
        dateTimeToMs(b.checkIn, b.checkOutTime) > startMs
      ) {
        endMs = dateTimeToMs(b.checkIn, b.checkOutTime);
      } else {
        endMs = candidateEnd > startMs ? candidateEnd : startMs + Math.max(1, b.hourlyHours || 1) * 3600000;
      }
    } else {
      endMs = startMs + Math.max(1, b.hourlyHours || 1) * 3600000;
    }
    return { startMs, endMs, endWithBufferMs: endMs + bufferMs };
  }

  // Overnight booking: checkIn at 14:00 -> checkOut at 12:00
  const startMs = dateTimeToMs(b.checkIn, defaultCheckInTime);
  const endMs = dateTimeToMs(b.checkOut, defaultCheckOutTime);
  const safeEnd = endMs > startMs ? endMs : parseISODate(b.checkOut).getTime();
  return { startMs, endMs: safeEnd, endWithBufferMs: safeEnd + bufferMs };
}

/**
 * Exact timestamp overlap check with cleaning buffer (default 5 minutes).
 * Supports multiple consecutive hourly bookings on the same room on the same day,
 * AND detects collisions between hourly stays and overnight stays!
 */
export function doBookingIntervalsOverlap(
  a: Pick<Booking, 'bookingMode' | 'checkIn' | 'checkOut' | 'checkInTime' | 'checkOutTime' | 'hourlyHours'>,
  b: Pick<Booking, 'bookingMode' | 'checkIn' | 'checkOut' | 'checkInTime' | 'checkOutTime' | 'hourlyHours'>,
  defaultCheckInTime = '14:00',
  defaultCheckOutTime = '12:00',
  cleaningBufferMinutes = 5
): boolean {
  const intA = getBookingInterval(a, defaultCheckInTime, defaultCheckOutTime, cleaningBufferMinutes);
  const intB = getBookingInterval(b, defaultCheckInTime, defaultCheckOutTime, cleaningBufferMinutes);
  return intA.startMs < intB.endWithBufferMs && intB.startMs < intA.endWithBufferMs;
}

/**
 * SINGLE SOURCE OF TRUTH for Room Maintenance blocking across AvailabilityFinder,
 * TimelineCalendarView, and BookingCreateModal (Bug #12a).
 * Uses `room_maintenances` ISO windows `[maintenanceFrom, maintenanceTo]` (inclusive).
 */
export function isRoomBlockedByMaintenance(
  roomId: string,
  maintenances: RoomMaintenance[],
  fromISO: string,
  toISO: string
): RoomMaintenance | null {
  const effectiveEnd = toISO > fromISO ? toISO : fromISO;
  for (const m of maintenances) {
    if (m.roomId !== roomId) continue;
    if (m.status === 'completed' || m.status === 'done') continue;
    const mFrom = m.maintenanceFrom || (m.reportedAt || m.reportedDate || '').slice(0, 10);
    const mTo = m.maintenanceTo || mFrom;
    if (!mFrom) continue;
    // Booking occupies nights [fromISO, toISO) or single day [fromISO, fromISO]
    if (toISO === fromISO) {
      if (fromISO >= mFrom && fromISO <= mTo) return m;
    } else {
      // Overlap between booking [fromISO, effectiveEnd) and maintenance [mFrom, mTo] inclusive
      if (fromISO <= mTo && effectiveEnd > mFrom) return m;
    }
  }
  return null;
}
