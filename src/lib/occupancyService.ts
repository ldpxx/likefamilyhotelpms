import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type Firestore,
  type Transaction as FirestoreTransaction,
} from 'firebase/firestore';
import type {
  Booking,
  HotelConfig,
  OccupancyDayDoc,
  OccupancyInterval,
  RoomMaintenance,
} from '../types/pms';
import { addDays, isBookingBlockingCalendar } from './utils';
import { dateTimeToMs, getBookingInterval, toVietnamISODate } from './revenueMetrics';

export const OCCUPANCY_COLLECTION = 'room_occupancy';
export const DEFAULT_CLEANING_BUFFER_MINUTES = 5;

export interface OccupancyReservationRequest {
  roomId: string;
  roomNumber?: string;
  interval: OccupancyInterval;
}

export interface OccupancyReleaseRequest {
  roomId: string;
  id: string;
  /** Optional hint of dates to scan; if provided, scans exactly these dates */
  dates: string[];
}

export function getOccupancyDocId(roomId: string, dateISO: string): string {
  return `${roomId}_${dateISO}`;
}

/**
 * Computes all Vietnam-timezone ISO dates (`YYYY-MM-DD`) covered by `[startAt, endAt + bufferMs)`.
 */
export function getAffectedOccupancyDates(
  startAt: number,
  endAt: number,
  bufferMinutes: number
): string[] {
  const effectiveEnd = Math.max(startAt + 1, endAt + Math.max(0, bufferMinutes) * 60 * 1000);
  const startDate = toVietnamISODate(new Date(startAt).toISOString());
  // Subtract 1ms from exclusive effectiveEnd so an interval ending exactly at 00:00:00 doesn't spill into next day
  const endDate = toVietnamISODate(new Date(effectiveEnd - 1).toISOString());
  if (!startDate || !endDate) return [];
  const dates: string[] = [];
  let cur = startDate;
  let guard = 0;
  while (cur <= endDate && guard < 400) {
    dates.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return dates;
}

/**
 * Half-open interval conflict check with cleaning buffer:
 * Effective span of an interval is `[startAt, endAt + bufferMinutes * 60_000)`.
 * Two intervals conflict iff `a.startAt < bEffectiveEnd && b.startAt < aEffectiveEnd`.
 */
export function doOccupancyIntervalsConflict(
  a: Pick<OccupancyInterval, 'startAt' | 'endAt' | 'bufferMinutes'>,
  b: Pick<OccupancyInterval, 'startAt' | 'endAt' | 'bufferMinutes'>
): boolean {
  const aEndEff = a.endAt + Math.max(0, a.bufferMinutes || 0) * 60 * 1000;
  const bEndEff = b.endAt + Math.max(0, b.bufferMinutes || 0) * 60 * 1000;
  return a.startAt < bEndEff && b.startAt < aEndEff;
}

export function buildBookingOccupancyInterval(
  booking: Pick<
    Booking,
    'id' | 'bookingMode' | 'checkIn' | 'checkOut' | 'checkInTime' | 'checkOutTime' | 'hourlyHours'
  >,
  defaultCheckInTime = '14:00',
  defaultCheckOutTime = '12:00',
  cleaningBufferMinutes = DEFAULT_CLEANING_BUFFER_MINUTES,
  nowISO = new Date().toISOString(),
  testRunId?: string
): OccupancyInterval {
  const interval = getBookingInterval(
    booking,
    defaultCheckInTime,
    defaultCheckOutTime,
    cleaningBufferMinutes
  );
  return {
    id: booking.id,
    kind: 'booking',
    startAt: interval.startMs,
    endAt: interval.endMs,
    bufferMinutes: Math.max(0, cleaningBufferMinutes),
    status: 'active',
    updatedAt: nowISO,
    ...(testRunId ? { testRunId } : {}),
  };
}

export function buildMaintenanceOccupancyInterval(
  maint: Pick<RoomMaintenance, 'id' | 'maintenanceFrom' | 'maintenanceTo' | 'reportedAt'>,
  nowISO = new Date().toISOString(),
  testRunId?: string
): OccupancyInterval {
  const fromISO = maint.maintenanceFrom || (maint.reportedAt || '').slice(0, 10);
  const toISO = maint.maintenanceTo && maint.maintenanceTo >= fromISO ? maint.maintenanceTo : fromISO;
  const startAt = dateTimeToMs(fromISO, '00:00');
  const endAt = dateTimeToMs(addDays(toISO, 1), '00:00');
  return {
    id: maint.id,
    kind: 'maintenance',
    startAt,
    endAt,
    bufferMinutes: 0,
    status: 'active',
    updatedAt: nowISO,
    ...(testRunId ? { testRunId } : {}),
  };
}

export interface OccupancyTransactionPlan {
  writes: Array<{ docId: string; data: OccupancyDayDoc }>;
}

/**
 * Atomic transaction-phase planner for `room_occupancy/{roomId}_{YYYY-MM-DD}` (Phương án A).
 * IMPORTANT: Call this BEFORE any `tx.set` / `tx.update` inside `runTransaction()` because
 * Firestore requires ALL `tx.get()` calls to complete before ANY write!
 *
 * Returns prepared `writes` so the caller can invoke `commitOccupancyPlanInTransaction(tx, db, plan)`
 * together with its booking/maintenance writes in the same atomic transaction.
 */
export async function prepareOccupancyPlanInTransaction(
  tx: FirestoreTransaction,
  db: Firestore,
  params: {
    reserve?: OccupancyReservationRequest[];
    release?: OccupancyReleaseRequest[];
    excludeIds?: string[];
  }
): Promise<OccupancyTransactionPlan> {
  const reserveList = params.reserve || [];
  const releaseList = params.release || [];
  const excludeSet = new Set<string>(params.excludeIds || []);
  for (const r of releaseList) excludeSet.add(r.id);

  // 1. Collect all unique room_occupancy docIds we must read
  const docMeta = new Map<string, { roomId: string; date: string }>();

  for (const rel of releaseList) {
    for (const d of rel.dates) {
      docMeta.set(getOccupancyDocId(rel.roomId, d), { roomId: rel.roomId, date: d });
    }
  }

  const reserveWithDates = reserveList.map((req) => {
    const dates = getAffectedOccupancyDates(
      req.interval.startAt,
      req.interval.endAt,
      req.interval.bufferMinutes
    );
    for (const d of dates) {
      docMeta.set(getOccupancyDocId(req.roomId, d), { roomId: req.roomId, date: d });
    }
    return { req, dates };
  });

  // 2. Read ALL affected room_occupancy docs inside the transaction
  const docIds = Array.from(docMeta.keys());
  const snapshots = await Promise.all(
    docIds.map((docId) => tx.get(doc(db, OCCUPANCY_COLLECTION, docId)))
  );

  // 3. Build working in-memory state of intervals per docId
  const workingIntervals = new Map<string, OccupancyInterval[]>();
  for (let i = 0; i < docIds.length; i++) {
    const docId = docIds[i];
    const snap = snapshots[i];
    const raw = snap.exists() ? (snap.data() as Partial<OccupancyDayDoc>) : null;
    const existing = Array.isArray(raw?.intervals)
      ? raw!.intervals.filter((iv) => iv && iv.status === 'active')
      : [];
    workingIntervals.set(docId, [...existing]);
  }

  // 4. Apply releases (remove released IDs from their dates)
  for (const rel of releaseList) {
    for (const d of rel.dates) {
      const docId = getOccupancyDocId(rel.roomId, d);
      const list = workingIntervals.get(docId) || [];
      workingIntervals.set(
        docId,
        list.filter((iv) => iv.id !== rel.id)
      );
    }
  }

  // 5. Validate & apply reservations atomically (checks BOTH existing docs AND intra-batch requests!)
  for (const { req, dates } of reserveWithDates) {
    for (const d of dates) {
      const docId = getOccupancyDocId(req.roomId, d);
      const list = (workingIntervals.get(docId) || []).filter(
        (iv) => iv.id !== req.interval.id && !excludeSet.has(iv.id)
      );
      const conflict = list.find((existing) => doOccupancyIntervalsConflict(existing, req.interval));
      if (conflict) {
        const roomLabel = req.roomNumber ? `P.${req.roomNumber}` : req.roomId;
        const kindLabel = conflict.kind === 'maintenance' ? 'lịch bảo trì' : 'đơn đặt phòng khác';
        throw new Error(
          `OCCUPANCY_CONFLICT: ${roomLabel} ngày ${d} bị trùng với ${kindLabel} (${conflict.id}, gồm đệm dọn phòng ${Math.max(
            conflict.bufferMinutes,
            req.interval.bufferMinutes
          )} phút). Vui lòng chọn phòng hoặc khung giờ khác.`
        );
      }
      list.push(req.interval);
      workingIntervals.set(docId, list);
    }
  }

  const nowISO = new Date().toISOString();
  const writes: Array<{ docId: string; data: OccupancyDayDoc }> = [];
  for (const docId of docIds) {
    const meta = docMeta.get(docId)!;
    writes.push({
      docId,
      data: {
        roomId: meta.roomId,
        date: meta.date,
        intervals: workingIntervals.get(docId) || [],
        updatedAt: nowISO,
      },
    });
  }

  return { writes };
}

export function applyOccupancyPlanInTransaction(
  tx: FirestoreTransaction,
  db: Firestore,
  plan: OccupancyTransactionPlan
): void {
  for (const w of plan.writes) {
    tx.set(doc(db, OCCUPANCY_COLLECTION, w.docId), w.data);
  }
}

export interface OccupancyAuditResult {
  dryRun: boolean;
  expectedDocCount: number;
  existingDocCount: number;
  missingDocs: number;
  mismatchedDocs: number;
  staleDocs: number;
  conflictsDetected: Array<{ docId: string; idA: string; idB: string }>;
  rebuiltDocsWritten: number;
}

/**
 * Auditing & Rebuild utility for `room_occupancy` index from authoritative `bookings` + `room_maintenances`.
 * Always run with `dryRun = true` first to inspect diffs before rebuilding (`dryRun = false`).
 */
export async function auditAndRebuildOccupancy(
  db: Firestore,
  bookings: Booking[],
  maintenances: RoomMaintenance[],
  hotelConfig?: Pick<HotelConfig, 'checkInTime' | 'checkOutTime' | 'hourlyCleaningBufferMinutes'>,
  dryRun = true
): Promise<OccupancyAuditResult> {
  const defaultIn = hotelConfig?.checkInTime || '14:00';
  const defaultOut = hotelConfig?.checkOutTime || '12:00';
  const bufferMinutes = hotelConfig?.hourlyCleaningBufferMinutes ?? DEFAULT_CLEANING_BUFFER_MINUTES;
  const nowISO = new Date().toISOString();

  const expectedMap = new Map<string, OccupancyDayDoc>();
  const conflictsDetected: Array<{ docId: string; idA: string; idB: string }> = [];

  const pushInterval = (roomId: string, interval: OccupancyInterval) => {
    const dates = getAffectedOccupancyDates(interval.startAt, interval.endAt, interval.bufferMinutes);
    for (const d of dates) {
      const docId = getOccupancyDocId(roomId, d);
      const cur = expectedMap.get(docId) || { roomId, date: d, intervals: [], updatedAt: nowISO };
      for (const existing of cur.intervals) {
        if (existing.id !== interval.id && doOccupancyIntervalsConflict(existing, interval)) {
          conflictsDetected.push({ docId, idA: existing.id, idB: interval.id });
        }
      }
      cur.intervals.push(interval);
      expectedMap.set(docId, cur);
    }
  };

  for (const b of bookings) {
    if (!isBookingBlockingCalendar(b.status)) continue;
    pushInterval(b.roomId, buildBookingOccupancyInterval(b, defaultIn, defaultOut, bufferMinutes, nowISO));
  }

  for (const m of maintenances) {
    if (m.status === 'completed' || m.status === 'done') continue;
    pushInterval(m.roomId, buildMaintenanceOccupancyInterval(m, nowISO));
  }

  const existingSnap = await getDocs(collection(db, OCCUPANCY_COLLECTION));
  const existingMap = new Map<string, OccupancyDayDoc>();
  existingSnap.forEach((d) => existingMap.set(d.id, d.data() as OccupancyDayDoc));

  let missingDocs = 0;
  let mismatchedDocs = 0;
  let staleDocs = 0;

  const toWrite: Array<{ docId: string; data: OccupancyDayDoc }> = [];

  for (const [docId, exp] of expectedMap.entries()) {
    const cur = existingMap.get(docId);
    if (!cur) {
      missingDocs++;
      toWrite.push({ docId, data: exp });
    } else {
      const curIds = (cur.intervals || []).map((x) => `${x.id}:${x.startAt}:${x.endAt}:${x.bufferMinutes}`).sort().join('|');
      const expIds = exp.intervals.map((x) => `${x.id}:${x.startAt}:${x.endAt}:${x.bufferMinutes}`).sort().join('|');
      if (curIds !== expIds) {
        mismatchedDocs++;
        toWrite.push({ docId, data: exp });
      }
    }
  }

  for (const [docId, cur] of existingMap.entries()) {
    if (!expectedMap.has(docId) && (cur.intervals || []).length > 0) {
      staleDocs++;
      toWrite.push({
        docId,
        data: { roomId: cur.roomId, date: cur.date, intervals: [], updatedAt: nowISO },
      });
    }
  }

  let rebuiltDocsWritten = 0;
  if (!dryRun && toWrite.length > 0) {
    for (let i = 0; i < toWrite.length; i += 350) {
      const chunk = toWrite.slice(i, i + 350);
      const batch = writeBatch(db);
      for (const item of chunk) {
        batch.set(doc(db, OCCUPANCY_COLLECTION, item.docId), item.data);
      }
      await batch.commit();
      rebuiltDocsWritten += chunk.length;
    }
  }

  return {
    dryRun,
    expectedDocCount: expectedMap.size,
    existingDocCount: existingMap.size,
    missingDocs,
    mismatchedDocs,
    staleDocs,
    conflictsDetected,
    rebuiltDocsWritten,
  };
}
