import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type UpdateData,
} from 'firebase/firestore';
import { auth, db, getStaffCreatorAuth, usernameToInternalEmail } from './firebase';
import {
  applyOccupancyPlanInTransaction,
  buildBookingOccupancyInterval,
  buildMaintenanceOccupancyInterval,
  DEFAULT_CLEANING_BUFFER_MINUTES,
  getAffectedOccupancyDates,
  prepareOccupancyPlanInTransaction,
  type OccupancyReservationRequest,
} from './occupancyService';
import { toVietnamISODate } from './revenueMetrics';
import { normalizeCountryCode } from './countries';
import { DEFAULT_HOTEL_CONFIG } from './seedData';
import type {
  AuditLog,
  Booking,
  BookingGroup,
  BookingMode,
  BookingServiceItem,
  DailyRate,
  Guest,
  GuestDocument,
  HousekeepingStatus,
  Occupant,
  OtaAdjustment,
  OtaPayoutBatch,
  PaymentMethod,
  Room,
  RoomMaintenance,
  StaffPermissions,
  StaffRole,
  StaffUser,
  Transaction,
  TransactionType,
} from '../types/pms';
import {
  buildDailyRates,
  computeOccupantFlags,
  diffDays,
  formatDateVN,
  generateCode,
  generateId,
  getDefaultPermissionsForRole,
  normalizePhone,
  normalizeVietnamese,
  sumDailyRates,
  todayISO,
} from './utils';
import { estimateBase64Bytes } from './imageCompression';

export interface ActorInfo {
  uid: string;
  name: string;
}

/** Recursively removes `undefined` object properties so Firestore `set()`/`tx.set()` never throws `invalid-argument`. */
function stripUndefined<T>(val: T): T {
  if (Array.isArray(val)) {
    return val.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (val !== null && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return val;
}

export async function writeAuditLog(params: {
  actionType: string;
  targetId: string;
  targetLabel: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  relatedTransactionIds?: string[];
  reason: string;
  actor: ActorInfo;
}): Promise<void> {
  const id = generateId('log');
  const log: AuditLog = {
    id,
    actionType: params.actionType,
    targetId: params.targetId,
    targetLabel: params.targetLabel,
    previousState: params.previousState ?? null,
    newState: params.newState ?? null,
    before_snapshot: params.previousState ?? null,
    after_snapshot: params.newState ?? null,
    relatedTransactionIds: params.relatedTransactionIds || [],
    reason: params.reason,
    userId: params.actor.uid,
    userName: params.actor.name,
    performedByUid: params.actor.uid,
    performedByName: params.actor.name,
    timestamp: new Date().toISOString(),
  };
  await setDoc(doc(db, 'audit_logs', id), log);
}

/**
 * 3-Layer Repeat Guest Auto-Matching:
 * 1. Exact ID / Passport / Visa Number
 * 2. Normalized Phone Number
 * 3. Normalized Vietnamese Full Name
 */
export function findMatchingGuests(
  guests: Guest[],
  queryParams: { idNumber?: string; phone?: string; fullName?: string }
): Guest[] {
  const cleanId = (queryParams.idNumber || '').trim().toLowerCase();
  const cleanPhone = normalizePhone(queryParams.phone);
  const cleanName = normalizeVietnamese(queryParams.fullName);

  if (!cleanId && !cleanPhone && cleanName.length < 2) return [];

  const scored: Array<{ guest: Guest; score: number }> = [];
  for (const g of guests) {
    let score = 0;
    if (cleanId && cleanId.length >= 4) {
      if (g.idNumber && g.idNumber.toLowerCase().includes(cleanId)) {
        score += g.idNumber.toLowerCase() === cleanId ? 100 : 60;
      }
      if (g.visaNumber && g.visaNumber.toLowerCase().includes(cleanId)) {
        score += g.visaNumber.toLowerCase() === cleanId ? 90 : 50;
      }
    }
    if (cleanPhone && cleanPhone.length >= 4 && g.normalizedPhone) {
      if (g.normalizedPhone === cleanPhone) score += 85;
      else if (g.normalizedPhone.includes(cleanPhone)) score += 45;
    }
    if (cleanName && cleanName.length >= 2) {
      if (g.normalizedName === cleanName) score += 55;
      else if (g.normalizedName.includes(cleanName)) score += 25;
    }
    if (score > 0) scored.push({ guest: g, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.guest.totalStays || 0) - (a.guest.totalStays || 0));
  return scored.slice(0, 6).map((s) => s.guest);
}

export async function upsertGuestProfile(
  input: Partial<Guest> & { fullName: string },
  existingGuests?: Guest[],
  incrementStay = false
): Promise<{ guestId: string; isReturning: boolean; stayCount: number }> {
  const now = new Date().toISOString();
  const normName = normalizeVietnamese(input.fullName);
  const normPhone = normalizePhone(input.phone);

  let matched: Guest | undefined;
  if (input.id) {
    matched = existingGuests?.find((g) => g.id === input.id);
  }
  if (!matched && existingGuests && existingGuests.length > 0) {
    const matches = findMatchingGuests(existingGuests, {
      idNumber: input.idNumber,
      phone: input.phone,
      fullName: input.fullName,
    });
    if (
      matches[0] &&
      ((input.idNumber &&
        matches[0].idNumber?.toLowerCase() === input.idNumber.trim().toLowerCase()) ||
        (normPhone.length >= 9 && matches[0].normalizedPhone === normPhone))
    ) {
      matched = matches[0];
    }
  }

  const guestId = matched?.id || input.id || generateId('guest');
  const category = input.guestCategory || matched?.guestCategory || 'vietnamese';
  const prevStays = matched?.totalStays || 0;
  const nextStays = incrementStay ? prevStays + 1 : Math.max(prevStays, 0);

  const payload: Guest = {
    id: guestId,
    guestCategory: category,
    fullName: input.fullName.trim(),
    normalizedName: normName,
    phone: input.phone?.trim() || matched?.phone || '',
    normalizedPhone: normPhone || matched?.normalizedPhone || '',
    gender: input.gender || matched?.gender || '',
    dob: input.dob || matched?.dob || '',
    nationality:
      normalizeCountryCode(input.nationality || matched?.nationality) ||
      (category === 'vietnamese' ? 'VN' : ''),
    idType: input.idType || (category === 'vietnamese' ? 'cccd' : 'visa_passport'),
    idNumber: input.idNumber?.trim() || matched?.idNumber || '',
    visaNumber: input.visaNumber?.trim() || matched?.visaNumber || '',
    idIssueDate: input.idIssueDate || matched?.idIssueDate || '',
    address: input.address || matched?.address || '',
    entryDate: input.entryDate || matched?.entryDate || '',
    stayPermitExpiryDate: input.stayPermitExpiryDate || matched?.stayPermitExpiryDate || '',
    latestDocumentId: input.latestDocumentId ?? matched?.latestDocumentId ?? null,
    preferences: input.preferences ?? matched?.preferences ?? '',
    totalStays: nextStays,
    totalSpent: matched?.totalSpent || 0,
    lastVisitDate: todayISO(),
    createdAt: matched?.createdAt || now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'guests', guestId), payload, { merge: true });
  return {
    guestId,
    isReturning: Boolean(matched),
    stayCount: matched ? prevStays + 1 : 1,
  };
}

export async function saveGuestDocumentImages(params: {
  documentId?: string | null;
  guestId: string;
  bookingId: string;
  occupantId: string;
  guestName: string;
  guestCategory: 'vietnamese' | 'foreigner';
  frontImageBase64?: string | null;
  backImageBase64?: string | null;
  entryStampImageBase64?: string | null;
  actor: ActorInfo;
}): Promise<GuestDocument> {
  const id = params.documentId || generateId('gdoc');
  const totalSizeBytes =
    estimateBase64Bytes(params.frontImageBase64) +
    estimateBase64Bytes(params.backImageBase64) +
    estimateBase64Bytes(params.entryStampImageBase64);

  if (totalSizeBytes > 850 * 1024) {
    throw new Error(
      'Tổng dung lượng ảnh trong 1 hồ sơ vượt ngưỡng an toàn (850KB). Vui lòng tải lại ảnh đã nén.'
    );
  }

  const docPayload: GuestDocument = {
    id,
    guestId: params.guestId,
    bookingId: params.bookingId,
    occupantId: params.occupantId,
    guestName: params.guestName,
    guestCategory: params.guestCategory,
    frontImageBase64: params.frontImageBase64 ?? null,
    backImageBase64: params.backImageBase64 ?? null,
    entryStampImageBase64: params.entryStampImageBase64 ?? null,
    totalSizeBytes,
    uploadedAt: new Date().toISOString(),
    uploadedBy: params.actor.name,
    isCleaned: false,
    cleanedAt: null,
    cleanedBy: null,
  };

  await setDoc(doc(db, 'guest_documents', id), docPayload, { merge: true });
  await updateDoc(doc(db, 'guests', params.guestId), {
    latestDocumentId: id,
    updatedAt: new Date().toISOString(),
  }).catch(() => { });

  return docPayload;
}

export async function getGuestDocument(documentId: string): Promise<GuestDocument | null> {
  const snap = await getDoc(doc(db, 'guest_documents', documentId));
  return snap.exists() ? (snap.data() as GuestDocument) : null;
}

export interface CreateBookingPayload {
  room: Room;
  bookingMode: BookingMode;
  hourlyHours?: number;
  hourlyRoomTotal?: number;
  checkInTime?: string;
  checkOutTime?: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestPhone: string;
  guestCategory: 'vietnamese' | 'foreigner';
  guestIdNumber?: string;
  guestNationality?: string;
  guestGender?: string;
  guestAddress?: string;
  guestDob?: string;
  guestIdIssueDate?: string;
  existingGuestId?: string;
  source: Booking['source'];
  sourceLabel?: string;
  otaChannel?: string | null;
  otaBookingRef?: string | null;
  selectedPriceTierId?: string | null;
  dailyRates: DailyRate[];
  paymentMethod: PaymentMethod;
  depositPaid: number;
  depositMethod: PaymentMethod;
  note?: string;
  groupId?: string | null;
  groupName?: string | null;
  checkInImmediately?: boolean;
  accountingLockDate?: string | null;
}

export async function createBooking(
  payload: CreateBookingPayload,
  existingGuests: Guest[],
  actor: ActorInfo
): Promise<Booking> {
  const now = new Date().toISOString();
  const { guestId, isReturning, stayCount } = await upsertGuestProfile(
    {
      id: payload.existingGuestId,
      fullName: payload.guestName,
      phone: payload.guestPhone,
      guestCategory: payload.guestCategory,
      idNumber: payload.guestIdNumber,
      nationality: payload.guestNationality,
      gender: payload.guestGender,
      address: payload.guestAddress,
      dob: payload.guestDob,
      idIssueDate: payload.guestIdIssueDate,
    },
    existingGuests,
    false
  );

  const isHourly = payload.bookingMode === 'hourly';
  const nights = isHourly ? 0 : Math.max(1, diffDays(payload.checkIn, payload.checkOut));
  const roomTotal = isHourly
    ? Math.max(0, Math.round(payload.hourlyRoomTotal || 0))
    : sumDailyRates(payload.dailyRates);

  // v1.1.0: Simplified OTA pricing — receptionist enters direct net receivable amount; no commission math
  const grossRoomTotal = roomTotal;
  const otaCommissionAmount = 0;
  const netRoomTotal = roomTotal;

  const primaryOccupant: Occupant = {
    occupantId: generateId('occ'),
    guestId,
    guestCategory: payload.guestCategory,
    fullName: payload.guestName.trim(),
    phone: payload.guestPhone.trim(),
    gender: payload.guestGender || '',
    dob: payload.guestDob || '',
    nationality:
      normalizeCountryCode(payload.guestNationality) ||
      (payload.guestCategory === 'vietnamese' ? 'VN' : ''),
    idType: payload.guestCategory === 'vietnamese' ? 'cccd' : 'visa_passport',
    idNumber: payload.guestIdNumber?.trim() || '',
    idIssueDate: payload.guestIdIssueDate || '',
    address: payload.guestAddress || '',
    asmStatus: payload.guestCategory === 'foreigner' ? 'pending_asm' : 'not_applicable',
    isPrimary: true,
  };

  const flags = computeOccupantFlags([primaryOccupant], payload.checkOut);
  const bookingId = generateId('bkg');
  const bookingCode = generateCode(isHourly ? 'HR' : 'LF');
  const initialStatus: Booking['status'] = payload.checkInImmediately ? 'in_house' : 'reserved';
  const isOtaDebt = payload.source === 'ota' || payload.paymentMethod === 'ota_debt';

  const booking: Booking = {
    id: bookingId,
    bookingCode,
    bookingMode: payload.bookingMode,
    hourlyHours: isHourly ? Math.max(1, payload.hourlyHours || 1) : undefined,
    checkInTime: isHourly ? payload.checkInTime || '14:00' : undefined,
    checkOutTime: isHourly ? payload.checkOutTime || '16:00' : undefined,
    bookingChainId: null,
    chainSequence: 1,
    mergedIntoBookingId: null,
    mergedFromBookingIds: [],
    groupId: payload.groupId || null,
    groupName: payload.groupName || null,
    checkIn: payload.checkIn,
    checkOut: isHourly ? payload.checkIn : payload.checkOut,
    actualCheckInAt: payload.checkInImmediately ? now : null,
    actualCheckOutAt: null,
    primaryGuestId: guestId,
    primaryGuestName: payload.guestName.trim(),
    primaryGuestNormalizedName: normalizeVietnamese(payload.guestName),
    primaryGuestPhone: payload.guestPhone.trim(),
    primaryGuestIdNumber: payload.guestIdNumber?.trim() || '',
    occupants: [primaryOccupant],
    ...flags,
    isReturningGuest: isReturning || stayCount >= 2,
    guestStayCount: stayCount,
    source: payload.source,
    sourceLabel: payload.sourceLabel || undefined,
    otaChannel: payload.source === 'ota' ? payload.otaChannel || payload.sourceLabel || 'OTA' : null,
    otaBookingRef: payload.source === 'ota' ? payload.otaBookingRef || '' : null,
    roomId: payload.room.id,
    roomNumber: payload.room.roomNumber,
    floor: payload.room.floor,
    roomTypeId: payload.room.roomTypeId,
    roomTypeName: payload.room.roomTypeName,
    selectedPriceTierId: payload.selectedPriceTierId || null,
    dailyRates: isHourly ? [{ date: payload.checkIn, rate: roomTotal }] : payload.dailyRates,
    nights,
    grossRoomTotal,
    otaCommissionAmount,
    netRoomTotal,
    serviceTotal: 0,
    services: [],
    hourlySurcharge: 0,
    hourlySurchargeNote: '',
    depositPaid: Math.max(0, Math.round(payload.depositPaid || 0)),
    guestPaid: 0,
    paymentMethod: payload.paymentMethod,
    otaSettlementStatus: isOtaDebt ? 'unsettled' : 'not_applicable',
    payoutBatchId: null,
    status: initialStatus,
    note: payload.note?.trim() || '',
    lastActionSnapshot: null,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.name,
  };

  if (booking.depositPaid > 0 && payload.depositMethod !== 'ota_debt') {
    assertPeriodOpen(todayISO(), payload.accountingLockDate);
  }

  // v2.2.2 BUG-02: Atomic room_occupancy reservation inside runTransaction() (Phương án A + 5-min cleaning buffer)
  const occInterval = buildBookingOccupancyInterval(
    booking,
    '14:00',
    '12:00',
    DEFAULT_CLEANING_BUFFER_MINUTES,
    now
  );

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      reserve: [{ roomId: payload.room.id, roomNumber: payload.room.roomNumber, interval: occInterval }],
    });

    applyOccupancyPlanInTransaction(tx, db, occPlan);
    tx.set(doc(db, 'bookings', bookingId), stripUndefined(booking));

    if (payload.checkInImmediately) {
      tx.update(doc(db, 'rooms', payload.room.id), { currentBookingId: bookingId });
    }

    if (booking.depositPaid > 0 && payload.depositMethod !== 'ota_debt') {
      const depDate = todayISO();
      const txId = generateId('tx');
      const depTx: Transaction = {
        id: txId,
        bookingId,
        bookingCode,
        roomNumber: payload.room.roomNumber,
        groupId: payload.groupId || null,
        type: 'deposit',
        direction: 'in',
        category: 'Tiền đặt cọc phòng',
        amount: booking.depositPaid,
        method: payload.depositMethod,
        date: depDate,
        status: 'active',
        createdAt: now,
        createdByUid: actor.uid,
        createdByName: actor.name,
        note: `Đặt cọc đơn ${bookingCode} - P.${payload.room.roomNumber}`,
      };
      tx.set(doc(db, 'transactions', txId), depTx);
    }
  });
  await writeAuditLog({
    actionType: payload.checkInImmediately ? 'create_and_check_in' : 'create_booking',
    targetId: bookingId,
    targetLabel: `${bookingCode} (P.${payload.room.roomNumber}${isHourly ? ` - ${booking.hourlyHours}h` : ''})`,
    newState: {
      bookingMode: payload.bookingMode,
      status: initialStatus,
      grossRoomTotal,
      depositPaid: booking.depositPaid,
      paymentMethod: payload.paymentMethod,
    },
    reason: isHourly ? 'Tạo đặt phòng theo giờ' : 'Tạo đặt phòng mới',
    actor,
  });

  return booking;
}

export interface CreateGroupBookingPayload {
  groupName: string;
  leaderName: string;
  leaderPhone: string;
  guestCategory: 'vietnamese' | 'foreigner';
  source?: Booking['source'];
  sourceLabel?: string;
  otaChannel?: string | null;
  billingMode: 'master' | 'split';
  depositAmount: number;
  depositMethod: PaymentMethod;
  accountingLockDate?: string | null;
  note?: string;
  roomItems: Array<{
    room: Room;
    checkIn: string;
    checkOut: string;
    dailyRates: DailyRate[];
    selectedPriceTierId?: string | null;
  }>;
}

export async function createGroupBooking(
  payload: CreateGroupBookingPayload,
  existingGuests: Guest[],
  actor: ActorInfo
): Promise<{ group: BookingGroup; bookings: Booking[] }> {
  const now = new Date().toISOString();
  const { guestId } = await upsertGuestProfile(
    {
      fullName: payload.leaderName,
      phone: payload.leaderPhone,
      guestCategory: payload.guestCategory,
    },
    existingGuests,
    false
  );

  const groupId = generateId('grp');
  const groupCode = generateCode('GRP');
  const group: BookingGroup = {
    id: groupId,
    groupCode,
    groupName: payload.groupName.trim() || `Đoàn ${payload.leaderName.trim()}`,
    leaderGuestId: guestId,
    leaderName: payload.leaderName.trim(),
    leaderPhone: payload.leaderPhone.trim(),
    depositAmount: Math.max(0, Math.round(payload.depositAmount || 0)),
    billingMode: payload.billingMode,
    status: 'active',
    note: payload.note?.trim() || '',
    createdAt: now,
    createdBy: actor.name,
  };

  if (group.depositAmount > 0 && payload.depositMethod !== 'ota_debt') {
    assertPeriodOpen(todayISO(), payload.accountingLockDate);
  }

  // v2.2.2 BUG-02: Atomic all-or-nothing group reservation inside ONE runTransaction()
  const createdBookings: Booking[] = [];
  const reserveReqs: OccupancyReservationRequest[] = [];
  const isOtaDebt = payload.source === 'ota' || payload.depositMethod === 'ota_debt';

  for (let i = 0; i < payload.roomItems.length; i++) {
    const item = payload.roomItems[i];
    const roomDeposit = i === 0 ? group.depositAmount : 0;
    const bookingId = generateId('bkg');
    const bookingCode = generateCode('LF');
    const nights = Math.max(1, diffDays(item.checkIn, item.checkOut));
    const roomTotal = sumDailyRates(item.dailyRates);
    const primaryOccupant: Occupant = {
      occupantId: generateId('occ'),
      guestId,
      guestCategory: payload.guestCategory,
      fullName: payload.leaderName.trim(),
      phone: payload.leaderPhone.trim(),
      gender: '',
      dob: '',
      nationality: payload.guestCategory === 'vietnamese' ? 'VN' : '',
      idType: payload.guestCategory === 'vietnamese' ? 'cccd' : 'visa_passport',
      idNumber: '',
      idIssueDate: '',
      address: '',
      asmStatus: payload.guestCategory === 'foreigner' ? 'pending_asm' : 'not_applicable',
      isPrimary: true,
    };
    const flags = computeOccupantFlags([primaryOccupant], item.checkOut);
    const b: Booking = {
      id: bookingId,
      bookingCode,
      bookingMode: 'daily',
      bookingChainId: null,
      chainSequence: 1,
      mergedIntoBookingId: null,
      mergedFromBookingIds: [],
      groupId,
      groupName: group.groupName,
      checkIn: item.checkIn,
      checkOut: item.checkOut,
      actualCheckInAt: null,
      actualCheckOutAt: null,
      primaryGuestId: guestId,
      primaryGuestName: payload.leaderName.trim(),
      primaryGuestNormalizedName: normalizeVietnamese(payload.leaderName),
      primaryGuestPhone: payload.leaderPhone.trim(),
      primaryGuestIdNumber: '',
      occupants: [primaryOccupant],
      ...flags,
      isReturningGuest: false,
      guestStayCount: 1,
      source: payload.source || 'group',
      sourceLabel: payload.sourceLabel || 'Khách đoàn',
      otaChannel: payload.source === 'ota' ? payload.otaChannel || payload.sourceLabel || 'OTA' : null,
      otaBookingRef: payload.source === 'ota' ? '' : null,
      roomId: item.room.id,
      roomNumber: item.room.roomNumber,
      floor: item.room.floor,
      roomTypeId: item.room.roomTypeId,
      roomTypeName: item.room.roomTypeName,
      selectedPriceTierId: item.selectedPriceTierId || null,
      dailyRates: item.dailyRates,
      nights,
      grossRoomTotal: roomTotal,
      otaCommissionAmount: 0,
      netRoomTotal: roomTotal,
      serviceTotal: 0,
      services: [],
      hourlySurcharge: 0,
      hourlySurchargeNote: '',
      depositPaid: roomDeposit,
      guestPaid: 0,
      paymentMethod: payload.source === 'ota' ? 'ota_debt' : payload.depositMethod,
      otaSettlementStatus: isOtaDebt ? 'unsettled' : 'not_applicable',
      payoutBatchId: null,
      status: 'reserved',
      note: payload.note?.trim() || '',
      lastActionSnapshot: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.name,
    };
    createdBookings.push(b);
    reserveReqs.push({
      roomId: item.room.id,
      roomNumber: item.room.roomNumber,
      interval: buildBookingOccupancyInterval(b, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now),
    });
  }

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, { reserve: reserveReqs });
    applyOccupancyPlanInTransaction(tx, db, occPlan);
    tx.set(doc(db, 'booking_groups', groupId), stripUndefined(group));
    for (const b of createdBookings) {
      tx.set(doc(db, 'bookings', b.id), stripUndefined(b));
      if (b.depositPaid > 0 && payload.depositMethod !== 'ota_debt') {
        const txId = generateId('tx');
        const depTx: Transaction = {
          id: txId,
          bookingId: b.id,
          bookingCode: b.bookingCode,
          roomNumber: b.roomNumber,
          groupId,
          type: 'deposit',
          direction: 'in',
          category: 'Tiền đặt cọc khách đoàn',
          amount: b.depositPaid,
          method: payload.depositMethod,
          date: todayISO(),
          status: 'active',
          createdAt: now,
          createdByUid: actor.uid,
          createdByName: actor.name,
          note: `Đặt cọc đoàn ${groupCode} - P.${b.roomNumber}`,
        };
        tx.set(doc(db, 'transactions', txId), depTx);
      }
    }
  });

  await writeAuditLog({
    actionType: 'create_group_booking',
    targetId: groupId,
    targetLabel: `${groupCode} — ${group.groupName} (${createdBookings.length} phòng)`,
    newState: { roomCount: createdBookings.length, depositAmount: group.depositAmount },
    reason: 'Tạo đặt phòng khách đoàn',
    actor,
  });

  return { group, bookings: createdBookings };
}

export async function checkInBooking(
  booking: Booking,
  actor: ActorInfo
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const prevState = {
    status: booking.status,
    actualCheckInAt: booking.actualCheckInAt || null,
    roomId: booking.roomId,
  };

  const batch = writeBatch(db);
  batch.update(doc(db, 'bookings', booking.id), {
    status: 'in_house',
    actualCheckInAt: now,
    lastActionSnapshot: { action: 'check_in', prevState },
    updatedAt: now,
  });
  batch.update(doc(db, 'rooms', booking.roomId), {
    currentBookingId: booking.id,
  });
  await batch.commit();

  await writeAuditLog({
    actionType: 'check_in',
    targetId: booking.id,
    targetLabel: `${booking.bookingCode} (P.${booking.roomNumber})`,
    previousState: prevState,
    newState: { status: 'in_house', actualCheckInAt: now },
    reason: 'Nhận phòng (Check-in)',
    actor,
  });
  return prevState;
}

export async function bulkCheckInGroup(bookings: Booking[], actor: ActorInfo): Promise<number> {
  let count = 0;
  for (const b of bookings) {
    if (b.status === 'reserved') {
      await checkInBooking(b, actor);
      count++;
    }
  }
  return count;
}

export async function checkOutBooking(
  booking: Booking,
  actor: ActorInfo,
  opts?: { earlyCheckOut?: boolean; refundAmount?: number; refundMethod?: PaymentMethod }
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const today = todayISO();

  const prevState = {
    status: booking.status,
    checkOut: booking.checkOut,
    dailyRates: booking.dailyRates,
    nights: booking.nights,
    grossRoomTotal: booking.grossRoomTotal,
    netRoomTotal: booking.netRoomTotal,
    actualCheckOutAt: booking.actualCheckOutAt || null,
    roomId: booking.roomId,
  };

  let nextCheckOut = booking.checkOut;
  let nextDailyRates = booking.dailyRates;
  let nextNights = booking.nights;
  let nextGross = booking.grossRoomTotal;

  if (booking.bookingMode !== 'hourly' && opts?.earlyCheckOut && today < booking.checkOut) {
    nextCheckOut = today <= booking.checkIn ? booking.checkIn : today;
    const stayedNights = Math.max(1, diffDays(booking.checkIn, today));
    nextDailyRates = booking.dailyRates.slice(0, stayedNights);
    if (nextDailyRates.length === 0 && booking.dailyRates.length > 0) {
      nextDailyRates = [booking.dailyRates[0]];
    }
    nextNights = nextDailyRates.length;
    nextGross = sumDailyRates(nextDailyRates);
  }

  // v2.2.2 BUG-02: Release freed future occupancy dates when earlyCheckOut shortens stay
  const oldOccInterval = buildBookingOccupancyInterval(booking, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);
  const oldOccDates = getAffectedOccupancyDates(oldOccInterval.startAt, oldOccInterval.endAt, oldOccInterval.bufferMinutes);

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      release: [{ roomId: booking.roomId, id: booking.id, dates: oldOccDates }],
    });
    applyOccupancyPlanInTransaction(tx, db, occPlan);

    tx.update(doc(db, 'bookings', booking.id), {
      status: 'checked_out',
      checkOut: nextCheckOut,
      dailyRates: nextDailyRates,
      nights: nextNights,
      grossRoomTotal: nextGross,
      otaCommissionAmount: 0,
      netRoomTotal: nextGross,
      actualCheckOutAt: now,
      lastActionSnapshot: {
        action: opts?.earlyCheckOut ? 'early_checkout' : 'check_out',
        prevState,
      },
      updatedAt: now,
    });
    tx.update(doc(db, 'rooms', booking.roomId), {
      currentBookingId: null,
      hkStatus: 'dirty',
    });

    if (opts?.refundAmount && opts.refundAmount > 0) {
      const txId = generateId('tx');
      const refTx: Transaction = {
        id: txId,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        roomNumber: booking.roomNumber,
        groupId: booking.groupId || null,
        type: 'refund',
        direction: 'out',
        category: 'Hoàn tiền trả phòng sớm',
        amount: Math.round(opts.refundAmount),
        method: opts.refundMethod || 'cash',
        date: today,
        status: 'active',
        createdAt: now,
        createdByUid: actor.uid,
        createdByName: actor.name,
        note: `Hoàn tiền trả phòng sớm đơn ${booking.bookingCode}`,
      };
      tx.set(doc(db, 'transactions', txId), refTx);
    }
  });

  // Increment completed stay count for primary guest so >= 2 stays auto-earn "Khách hàng thân quen"
  if (booking.primaryGuestId) {
    try {
      const gRef = doc(db, 'guests', booking.primaryGuestId);
      const gSnap = await getDoc(gRef);
      if (gSnap.exists()) {
        const g = gSnap.data() as Guest;
        const completedStays = (g.totalStays || 0) + 1;
        await updateDoc(gRef, {
          totalStays: completedStays,
          totalSpent: (g.totalSpent || 0) + nextGross + (booking.serviceTotal || 0),
          lastVisitDate: today,
          updatedAt: now,
        });
      }
    } catch {
      // non-fatal
    }
  }

  await writeAuditLog({
    actionType: opts?.earlyCheckOut ? 'early_checkout' : 'check_out',
    targetId: booking.id,
    targetLabel: `${booking.bookingCode} (P.${booking.roomNumber})`,
    previousState: prevState,
    newState: {
      status: 'checked_out',
      checkOut: nextCheckOut,
      grossRoomTotal: nextGross,
      refundAmount: opts?.refundAmount || 0,
    },
    reason: opts?.earlyCheckOut ? 'Chốt trả phòng sớm (Early Check-out)' : 'Trả phòng (Check-out)',
    actor,
  });

  return prevState;
}

export async function cancelBooking(
  booking: Booking,
  reason: string,
  actor: ActorInfo
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const prevState = { status: booking.status, roomId: booking.roomId };
  const oldOcc = buildBookingOccupancyInterval(booking, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);
  const oldDates = getAffectedOccupancyDates(oldOcc.startAt, oldOcc.endAt, oldOcc.bufferMinutes);

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      release: [{ roomId: booking.roomId, id: booking.id, dates: oldDates }],
    });
    applyOccupancyPlanInTransaction(tx, db, occPlan);
    tx.update(doc(db, 'bookings', booking.id), {
      status: 'cancelled',
      lastActionSnapshot: { action: 'cancel_booking', prevState },
      updatedAt: now,
    });
    if (booking.status === 'in_house') {
      tx.update(doc(db, 'rooms', booking.roomId), { currentBookingId: null });
    }
  });

  await writeAuditLog({
    actionType: 'cancel_booking',
    targetId: booking.id,
    targetLabel: `${booking.bookingCode} (P.${booking.roomNumber})`,
    previousState: prevState,
    newState: { status: 'cancelled' },
    reason: reason || 'Hủy đặt phòng',
    actor,
  });
  return prevState;
}

export async function updateBookingPricing(
  booking: Booking,
  params: {
    dailyRates?: DailyRate[];
    hourlyHours?: number;
    hourlyRoomTotal?: number;
    selectedPriceTierId?: string | null;
    checkIn?: string;
    checkOut?: string;
    reason?: string;
  },
  actor: ActorInfo
): Promise<void> {
  const now = new Date().toISOString();
  const isHourly = booking.bookingMode === 'hourly';
  const nextCheckIn = params.checkIn || booking.checkIn;
  const nextCheckOut = params.checkOut || booking.checkOut;

  const nextDailyRates = isHourly
    ? [{ date: nextCheckIn, rate: Math.max(0, Math.round(params.hourlyRoomTotal ?? booking.grossRoomTotal)) }]
    : params.dailyRates || booking.dailyRates;

  const grossRoomTotal = isHourly
    ? Math.max(0, Math.round(params.hourlyRoomTotal ?? booking.grossRoomTotal))
    : sumDailyRates(nextDailyRates);

  const prevState = {
    dailyRates: booking.dailyRates,
    grossRoomTotal: booking.grossRoomTotal,
    hourlyHours: booking.hourlyHours || null,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
  };

  const nextHourlyHours = isHourly ? params.hourlyHours ?? booking.hourlyHours ?? 1 : undefined;
  const scheduleChanged =
    nextCheckIn !== booking.checkIn ||
    nextCheckOut !== booking.checkOut ||
    (isHourly && nextHourlyHours !== (booking.hourlyHours ?? 1));
  if (scheduleChanged && (booking.status === 'reserved' || booking.status === 'in_house')) {
    const oldIv = buildBookingOccupancyInterval(booking, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);
    const oldDates = getAffectedOccupancyDates(oldIv.startAt, oldIv.endAt, oldIv.bufferMinutes);
    const newIv = buildBookingOccupancyInterval(
      { ...booking, checkIn: nextCheckIn, checkOut: nextCheckOut, hourlyHours: nextHourlyHours },
      '14:00',
      '12:00',
      DEFAULT_CLEANING_BUFFER_MINUTES,
      now
    );
    await runTransaction(db, async (tx) => {
      const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
        release: [{ roomId: booking.roomId, id: booking.id, dates: oldDates }],
        reserve: [{ roomId: booking.roomId, roomNumber: booking.roomNumber, interval: newIv }],
      });
      applyOccupancyPlanInTransaction(tx, db, occPlan);
      tx.update(doc(db, 'bookings', booking.id), {
        checkIn: nextCheckIn,
        checkOut: nextCheckOut,
        nights: isHourly ? 0 : nextDailyRates.length,
        hourlyHours: isHourly ? params.hourlyHours ?? booking.hourlyHours ?? 1 : null,
        dailyRates: nextDailyRates,
        selectedPriceTierId: params.selectedPriceTierId ?? booking.selectedPriceTierId ?? null,
        grossRoomTotal,
        otaCommissionAmount: 0,
        netRoomTotal: grossRoomTotal,
        updatedAt: now,
      });
    });
  } else {
    await updateDoc(doc(db, 'bookings', booking.id), {
      checkIn: nextCheckIn,
      checkOut: nextCheckOut,
      nights: isHourly ? 0 : nextDailyRates.length,
      hourlyHours: isHourly ? params.hourlyHours ?? booking.hourlyHours ?? 1 : null,
      dailyRates: nextDailyRates,
      selectedPriceTierId: params.selectedPriceTierId ?? booking.selectedPriceTierId ?? null,
      grossRoomTotal,
      otaCommissionAmount: 0,
      netRoomTotal: grossRoomTotal,
      updatedAt: now,
    });
  }

  await writeAuditLog({
    actionType: 'price_override',
    targetId: booking.id,
    targetLabel: `${booking.bookingCode} (P.${booking.roomNumber})`,
    previousState: prevState,
    newState: { grossRoomTotal, checkIn: nextCheckIn, checkOut: nextCheckOut },
    reason: params.reason || 'Điều chỉnh giá phòng / thời gian lưu trú',
    actor,
  });
}

export async function addBookingService(
  booking: Booking,
  item: {
    name: string;
    quantity: number;
    unitPrice: number;
    catalogItemId?: string;
    businessDate?: string;
    category?: BookingServiceItem['category'];
    accountingLockDate?: string | null;
  },
  actor: ActorInfo
): Promise<void> {
  const now = new Date().toISOString();
  // v2.2.2 BUG-01: Persist immutable businessDate (YYYY-MM-DD, Asia/Ho_Chi_Minh) on every new service line
  const businessDate = toVietnamISODate(item.businessDate) || toVietnamISODate(now) || todayISO();
  assertPeriodOpen(businessDate, item.accountingLockDate);
  const newItem: BookingServiceItem = {
    id: generateId('srv'),
    ...(item.catalogItemId ? { catalogItemId: item.catalogItemId } : {}),
    name: item.name.trim(),
    quantity: Math.max(1, item.quantity),
    unitPrice: Math.max(0, Math.round(item.unitPrice)),
    total: Math.max(1, item.quantity) * Math.max(0, Math.round(item.unitPrice)),
    businessDate,
    category: item.category || 'service',
    occurredAt: now,
    status: 'active',
    addedAt: now,
    addedBy: actor.name,
  };
  const nextServices = [...(booking.services || []), newItem];
  const serviceTotal = nextServices
    .filter((i) => i.status !== 'voided')
    .reduce((s, i) => s + i.total, 0);
  await updateDoc(doc(db, 'bookings', booking.id), {
    services: nextServices,
    serviceTotal,
    updatedAt: now,
  });
}

export async function removeBookingService(
  booking: Booking,
  serviceId: string,
  accountingLockDate?: string | null
): Promise<void> {
  const target = (booking.services || []).find((s) => s.id === serviceId);
  if (target) {
    const itemDate = toVietnamISODate(target.businessDate || target.occurredAt || target.addedAt) || booking.checkIn;
    assertPeriodOpen(itemDate, accountingLockDate);
  }
  const nextServices = (booking.services || []).filter((s) => s.id !== serviceId);
  const serviceTotal = nextServices
    .filter((i) => i.status !== 'voided')
    .reduce((s, i) => s + i.total, 0);
  await updateDoc(doc(db, 'bookings', booking.id), {
    services: nextServices,
    serviceTotal,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * v2.2.2 Accounting-safe service voiding across periods & accountingLockDate:
 * - If target item's businessDate is in an OPEN period (`> accountingLockDate`): marks `status: 'voided'`.
 * - If target item's businessDate is in a LOCKED period (`<= accountingLockDate`):
 *   - Rejects any retroactive void dated `<= accountingLockDate` via `assertPeriodOpen()`.
 *   - When `voidDate > accountingLockDate`, keeps the locked-period line frozen and posts an immutable
 *     contra-reversal line (`total: -item.total`, `businessDate: voidDate`) in the open period so
 *     historical P&L remains intact and multi-period totals balance to 0đ variance.
 */
export async function voidBookingService(params: {
  booking: Booking;
  serviceId: string;
  voidDate?: string;
  reason: string;
  accountingLockDate?: string | null;
  actor: ActorInfo;
}): Promise<{ mode: 'marked_voided' | 'contra_open_period'; effectiveDate: string; delta: number }> {
  const { booking, serviceId, reason, accountingLockDate, actor } = params;
  if (!reason.trim()) throw new Error('Bắt buộc nhập lý do hủy dịch vụ.');
  const target = (booking.services || []).find((s) => s.id === serviceId);
  if (!target) throw new Error('Không tìm thấy dòng dịch vụ cần hủy.');
  if (target.status === 'voided') throw new Error('Dòng dịch vụ này đã được hủy trước đó.');

  const now = new Date().toISOString();
  const itemDate = toVietnamISODate(target.businessDate || target.occurredAt || target.addedAt) || booking.checkIn;
  const effectiveVoidDate = toVietnamISODate(params.voidDate) || toVietnamISODate(now) || todayISO();

  // Always enforce period lock on the effective void date
  assertPeriodOpen(effectiveVoidDate, accountingLockDate);

  const isOriginalLocked = Boolean(accountingLockDate && itemDate <= accountingLockDate);
  let nextServices: BookingServiceItem[];
  let mode: 'marked_voided' | 'contra_open_period';

  if (isOriginalLocked) {
    // Locked original period -> preserve historical line and post negative contra line in open period
    mode = 'contra_open_period';
    const contraLine: BookingServiceItem = {
      id: generateId('srvvoid'),
      name: `[Hủy dịch vụ kỳ trước ${formatDateVN(itemDate)}] ${target.name}`,
      quantity: target.quantity,
      unitPrice: -Math.abs(target.unitPrice),
      total: -Math.abs(target.total),
      businessDate: effectiveVoidDate,
      category: 'Hủy dịch vụ kỳ trước',
      occurredAt: now,
      status: 'active',
      addedAt: now,
      addedBy: actor.name,
    };
    nextServices = [...(booking.services || []), contraLine];
  } else {
    // Open period -> mark voided directly
    mode = 'marked_voided';
    nextServices = (booking.services || []).map((s) =>
      s.id === serviceId ? { ...s, status: 'voided' as const } : s
    );
  }

  const serviceTotal = nextServices
    .filter((i) => i.status !== 'voided')
    .reduce((s, i) => s + i.total, 0);

  await updateDoc(doc(db, 'bookings', booking.id), {
    services: nextServices,
    serviceTotal,
    updatedAt: now,
  });

  await writeAuditLog({
    actionType: 'void_booking_service',
    targetId: booking.id,
    targetLabel: `Hủy dịch vụ ${target.name} (${booking.bookingCode})`,
    previousState: { serviceId, itemDate, amount: target.total },
    newState: { mode, effectiveVoidDate, serviceTotal },
    reason: reason.trim(),
    actor,
  });

  return { mode, effectiveDate: effectiveVoidDate, delta: -Math.abs(target.total) };
}

export async function updateHourlySurcharge(
  booking: Booking,
  amount: number,
  note: string,
  actor: ActorInfo
): Promise<void> {
  const clean = Math.max(0, Math.round(amount));
  await updateDoc(doc(db, 'bookings', booking.id), {
    hourlySurcharge: clean,
    hourlySurchargeNote: note.trim(),
    updatedAt: new Date().toISOString(),
  });
  await writeAuditLog({
    actionType: 'hourly_surcharge',
    targetId: booking.id,
    targetLabel: `${booking.bookingCode} (P.${booking.roomNumber})`,
    previousState: { hourlySurcharge: booking.hourlySurcharge },
    newState: { hourlySurcharge: clean, note },
    reason: note || 'Cập nhật phụ thu nhận sớm / trả muộn',
    actor,
  });
}

export async function saveBookingOccupants(
  booking: Booking,
  occupants: Occupant[],
  actor: ActorInfo
): Promise<void> {
  const flags = computeOccupantFlags(occupants, booking.checkOut);
  const primary = occupants.find((o) => o.isPrimary) || occupants[0];
  await updateDoc(doc(db, 'bookings', booking.id), {
    occupants,
    primaryGuestName: primary?.fullName || booking.primaryGuestName,
    primaryGuestNormalizedName: normalizeVietnamese(primary?.fullName || booking.primaryGuestName),
    primaryGuestPhone: primary?.phone || booking.primaryGuestPhone,
    primaryGuestIdNumber: primary?.idNumber || booking.primaryGuestIdNumber,
    ...flags,
    updatedAt: new Date().toISOString(),
  });

  await writeAuditLog({
    actionType: 'update_occupants',
    targetId: booking.id,
    targetLabel: `${booking.bookingCode} (P.${booking.roomNumber})`,
    newState: { occupantCount: flags.occupantCount, hasForeigner: flags.hasForeigner },
    reason: 'Cập nhật danh sách khách lưu trú / giấy tờ',
    actor,
  });
}

export async function markOccupantAsmDeclared(
  booking: Booking,
  occupantId: string,
  declared: boolean,
  actor: ActorInfo
): Promise<void> {
  const now = new Date().toISOString();
  const nextOccupants = booking.occupants.map((occ) => {
    if (occ.occupantId !== occupantId) return occ;
    return {
      ...occ,
      asmStatus: declared ? ('declared_asm' as const) : ('pending_asm' as const),
      asmDeclaredAt: declared ? now : null,
      asmDeclaredBy: declared ? actor.name : null,
    };
  });
  const flags = computeOccupantFlags(nextOccupants, booking.checkOut);
  await updateDoc(doc(db, 'bookings', booking.id), {
    occupants: nextOccupants,
    ...flags,
    updatedAt: now,
  });

  const occ = nextOccupants.find((o) => o.occupantId === occupantId);
  await writeAuditLog({
    actionType: 'declare_asm',
    targetId: booking.id,
    targetLabel: `${booking.bookingCode} — ${occ?.fullName || 'Khách nước ngoài'}`,
    newState: { asmStatus: declared ? 'declared_asm' : 'pending_asm' },
    reason: declared
      ? 'Đã khai báo tạm trú trên cổng ASM'
      : 'Chuyển lại trạng thái chờ khai báo ASM',
    actor,
  });
}

export async function transferBookingRoom(params: {
  booking: Booking;
  targetRoom: Room;
  transferDate: string;
  pricingMode: 'new_room_rate' | 'keep_old_rate' | 'custom_rate';
  targetRoomRate: number;
  actor: ActorInfo;
}): Promise<{ newBooking: Booking; prevState: Record<string, unknown> }> {
  const { booking, targetRoom, transferDate, targetRoomRate, actor } = params;
  const now = new Date().toISOString();
  const prevState = {
    oldBookingId: booking.id,
    oldStatus: booking.status,
    oldRoomId: booking.roomId,
    oldRoomNumber: booking.roomNumber,
    oldCheckOut: booking.checkOut,
    oldDailyRates: booking.dailyRates,
  };

  if (booking.status === 'reserved' || transferDate <= booking.checkIn || booking.bookingMode === 'hourly') {
    const newDailyRates =
      booking.bookingMode === 'hourly'
        ? [{ date: booking.checkIn, rate: targetRoomRate }]
        : buildDailyRates(booking.checkIn, booking.checkOut, targetRoomRate);
    const gross = sumDailyRates(newDailyRates);

    const updated: Booking = {
      ...booking,
      roomId: targetRoom.id,
      roomNumber: targetRoom.roomNumber,
      floor: targetRoom.floor,
      roomTypeId: targetRoom.roomTypeId,
      roomTypeName: targetRoom.roomTypeName,
      dailyRates: newDailyRates,
      grossRoomTotal: gross,
      otaCommissionAmount: 0,
      netRoomTotal: gross,
      updatedAt: now,
    };

    // v2.2.2 BUG-02: Reserve target room BEFORE releasing old room atomically inside runTransaction()
    const oldIv = buildBookingOccupancyInterval(booking, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);
    const oldDates = getAffectedOccupancyDates(oldIv.startAt, oldIv.endAt, oldIv.bufferMinutes);
    const newIv = buildBookingOccupancyInterval(updated, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);

    await runTransaction(db, async (tx) => {
      const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
        release: [{ roomId: booking.roomId, id: booking.id, dates: oldDates }],
        reserve: [{ roomId: targetRoom.id, roomNumber: targetRoom.roomNumber, interval: newIv }],
      });
      applyOccupancyPlanInTransaction(tx, db, occPlan);
      tx.update(doc(db, 'bookings', booking.id), {
        roomId: targetRoom.id,
        roomNumber: targetRoom.roomNumber,
        floor: targetRoom.floor,
        roomTypeId: targetRoom.roomTypeId,
        roomTypeName: targetRoom.roomTypeName,
        dailyRates: newDailyRates,
        grossRoomTotal: gross,
        otaCommissionAmount: 0,
        netRoomTotal: gross,
        lastActionSnapshot: { action: 'room_transfer_simple', prevState },
        updatedAt: now,
      });
      if (booking.status === 'in_house') {
        tx.update(doc(db, 'rooms', booking.roomId), { currentBookingId: null, hkStatus: 'dirty' });
        tx.update(doc(db, 'rooms', targetRoom.id), { currentBookingId: booking.id });
      }
    });

    await writeAuditLog({
      actionType: 'room_transfer',
      targetId: booking.id,
      targetLabel: `${booking.bookingCode}: P.${booking.roomNumber} -> P.${targetRoom.roomNumber}`,
      previousState: prevState,
      newState: { roomNumber: targetRoom.roomNumber, grossRoomTotal: gross },
      reason: `Đổi phòng (${params.pricingMode})`,
      actor,
    });

    return { newBooking: updated, prevState };
  }

  const chainId = booking.bookingChainId || generateId('chain');
  const stayedNights = Math.max(1, diffDays(booking.checkIn, transferDate));
  const oldLegRates = booking.dailyRates.slice(0, stayedNights);
  const oldLegGross = sumDailyRates(oldLegRates);

  const effectiveNewCheckOut =
    booking.checkOut > transferDate
      ? booking.checkOut
      : new Date(new Date(transferDate).getTime() + 86400000).toISOString().slice(0, 10);

  const newLegRates = buildDailyRates(transferDate, effectiveNewCheckOut, targetRoomRate);
  const newLegGross = sumDailyRates(newLegRates);

  const newBookingId = generateId('bkg');
  const newBooking: Booking = {
    ...booking,
    id: newBookingId,
    bookingCode: `${booking.bookingCode}-T${(booking.chainSequence || 1) + 1}`,
    bookingChainId: chainId,
    chainSequence: (booking.chainSequence || 1) + 1,
    checkIn: transferDate,
    checkOut: effectiveNewCheckOut,
    actualCheckInAt: now,
    actualCheckOutAt: null,
    roomId: targetRoom.id,
    roomNumber: targetRoom.roomNumber,
    floor: targetRoom.floor,
    roomTypeId: targetRoom.roomTypeId,
    roomTypeName: targetRoom.roomTypeName,
    dailyRates: newLegRates,
    nights: newLegRates.length,
    grossRoomTotal: newLegGross,
    otaCommissionAmount: 0,
    netRoomTotal: newLegGross,
    services: [],
    serviceTotal: 0,
    hourlySurcharge: 0,
    depositPaid: 0,
    guestPaid: 0,
    status: 'in_house',
    note: `Chuyển từ P.${booking.roomNumber} (${booking.bookingCode}). ${booking.note || ''}`.trim(),
    lastActionSnapshot: { action: 'room_transfer_split', prevState, newBookingId },
    createdAt: now,
    updatedAt: now,
  };

  // v2.2.2 BUG-02: Split-Stay atomic transaction — release old room future dates & reserve leg 2 on targetRoom
  const oldIv = buildBookingOccupancyInterval(booking, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);
  const oldDates = getAffectedOccupancyDates(oldIv.startAt, oldIv.endAt, oldIv.bufferMinutes);
  const newLegIv = buildBookingOccupancyInterval(newBooking, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      release: [{ roomId: booking.roomId, id: booking.id, dates: oldDates }],
      reserve: [{ roomId: targetRoom.id, roomNumber: targetRoom.roomNumber, interval: newLegIv }],
    });
    applyOccupancyPlanInTransaction(tx, db, occPlan);
    tx.update(doc(db, 'bookings', booking.id), {
      bookingChainId: chainId,
      checkOut: transferDate,
      dailyRates: oldLegRates,
      nights: oldLegRates.length,
      grossRoomTotal: oldLegGross,
      otaCommissionAmount: 0,
      netRoomTotal: oldLegGross,
      status: 'transferred',
      actualCheckOutAt: now,
      updatedAt: now,
    });
    tx.set(doc(db, 'bookings', newBookingId), stripUndefined(newBooking));
    tx.update(doc(db, 'rooms', booking.roomId), { currentBookingId: null, hkStatus: 'dirty' });
    tx.update(doc(db, 'rooms', targetRoom.id), { currentBookingId: newBookingId });
  });

  await writeAuditLog({
    actionType: 'room_transfer',
    targetId: newBookingId,
    targetLabel: `Split-Stay P.${booking.roomNumber} -> P.${targetRoom.roomNumber}`,
    previousState: prevState,
    newState: { chainId, newBookingId, newLegGross, oldLegGross },
    reason: `Chuyển phòng khác chặng (${params.pricingMode})`,
    actor,
  });

  return { newBooking, prevState };
}

export async function mergeBookingsIntoGroup(
  bookings: Booking[],
  groupName: string,
  actor: ActorInfo
): Promise<BookingGroup> {
  if (bookings.length < 2) throw new Error('Cần chọn ít nhất 2 phòng để ghép hóa đơn.');
  const now = new Date().toISOString();
  const leader = bookings[0];
  const groupId = generateId('grp');
  const groupCode = generateCode('MRG');
  const group: BookingGroup = {
    id: groupId,
    groupCode,
    groupName:
      groupName.trim() || `Nhóm ghép ${bookings.map((b) => `P.${b.roomNumber}`).join(' + ')}`,
    leaderGuestId: leader.primaryGuestId,
    leaderName: leader.primaryGuestName,
    leaderPhone: leader.primaryGuestPhone,
    depositAmount: bookings.reduce((s, b) => s + (b.depositPaid || 0), 0),
    billingMode: 'master',
    status: 'active',
    note: 'Gộp hóa đơn thanh toán chung',
    createdAt: now,
    createdBy: actor.name,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'booking_groups', groupId), group);
  for (const b of bookings) {
    batch.update(doc(db, 'bookings', b.id), {
      groupId,
      groupName: group.groupName,
      updatedAt: now,
    });
  }
  await batch.commit();

  await writeAuditLog({
    actionType: 'room_merge_billing',
    targetId: groupId,
    targetLabel: group.groupName,
    newState: { bookingIds: bookings.map((b) => b.id) },
    reason: 'Gộp hóa đơn thanh toán chung nhiều phòng',
    actor,
  });
  return group;
}

/**
 * Bug #11a: Enforce Accounting Period Lock across ALL money-writing paths (`src/lib/*`).
 * Compares ISO `YYYY-MM-DD` strings cleanly.
 */
export function assertPeriodOpen(
  transactionDateISO: string,
  accountingLockDate?: string | null
): void {
  if (!accountingLockDate) return;
  if (transactionDateISO <= accountingLockDate) {
    throw new Error(
      `Kỳ kế toán đã khóa sổ đến hết ngày ${formatDateVN(
        accountingLockDate
      )}. Không thể ghi giao dịch cho ngày ${formatDateVN(transactionDateISO)}.`
    );
  }
}

/**
 * Bug #4 & #5: SINGLE SOURCE OF TRUTH for updating `depositPaid` and `guestPaid` on a Booking.
 * Guarantees refunds / early-checkout refunds / deposit transfers ALWAYS deduct cleanly
 * without ever going negative.
 */
export function applyPaymentDelta(
  booking: Pick<Booking, 'depositPaid' | 'guestPaid'>,
  type: 'deposit' | 'payment' | 'refund' | 'refund_deposit' | 'transfer_out' | 'transfer_in',
  rawAmount: number
): { depositPaid: number; guestPaid: number } {
  const amount = Math.max(0, Math.round(rawAmount));
  let depositPaid = Math.max(0, Math.round(booking.depositPaid || 0));
  let guestPaid = Math.max(0, Math.round(booking.guestPaid || 0));

  if (amount === 0) return { depositPaid, guestPaid };

  if (type === 'deposit' || type === 'transfer_in') {
    depositPaid += amount;
    return { depositPaid, guestPaid };
  }

  if (type === 'payment') {
    guestPaid += amount;
    return { depositPaid, guestPaid };
  }

  // Refund / transfer_out: validate total paid >= amount (no negative paid totals!)
  const totalPaid = depositPaid + guestPaid;
  if (amount > totalPaid) {
    throw new Error(
      `Số tiền hoàn / chuyển (${amount.toLocaleString('vi-VN')}đ) vượt quá tổng tiền khách đã trả (${totalPaid.toLocaleString('vi-VN')}đ).`
    );
  }

  if (type === 'refund_deposit') {
    const fromDep = Math.min(depositPaid, amount);
    depositPaid -= fromDep;
    guestPaid -= amount - fromDep;
  } else {
    // Default refund / transfer_out deducts guestPaid first, then remaining from depositPaid
    const fromGuest = Math.min(guestPaid, amount);
    guestPaid -= fromGuest;
    depositPaid -= amount - fromGuest;
  }

  return { depositPaid, guestPaid };
}

/**
 * Bug #2: Room Consolidation WITHOUT Double-Counting Revenue!
 * - Source Room A keeps its real stay revenue, sets `consolidatedInto` + `balanceTransferredOut` (guest balance -> 0đ).
 * - Target Room B adds `carriedBalance` to `transferredBalance` (payable by guest, EXCLUDED from P&L revenue!).
 */
export async function consolidateRoomIntoTarget(
  sourceBooking: Booking,
  targetBooking: Booking,
  actor: ActorInfo
): Promise<void> {
  const now = new Date().toISOString();
  const carriedBalance = Math.max(
    0,
    (sourceBooking.grossRoomTotal || 0) +
    (sourceBooking.serviceTotal || 0) +
    (sourceBooking.hourlySurcharge || 0) +
    (sourceBooking.transferredBalance || 0) -
    (sourceBooking.depositPaid || 0) -
    (sourceBooking.guestPaid || 0) -
    (sourceBooking.balanceTransferredOut || 0)
  );

  const mergedOccupants: Occupant[] = [
    ...targetBooking.occupants,
    ...sourceBooking.occupants.map((o) => ({ ...o, isPrimary: false })),
  ];
  const flags = computeOccupantFlags(mergedOccupants, targetBooking.checkOut);
  const nextTransferredBalance = (targetBooking.transferredBalance || 0) + carriedBalance;

  const srcOcc = buildBookingOccupancyInterval(sourceBooking, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);
  const srcDates = getAffectedOccupancyDates(srcOcc.startAt, srcOcc.endAt, srcOcc.bufferMinutes);

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      release: [{ roomId: sourceBooking.roomId, id: sourceBooking.id, dates: srcDates }],
    });
    applyOccupancyPlanInTransaction(tx, db, occPlan);
    tx.update(doc(db, 'bookings', sourceBooking.id), {
      status: 'checked_out',
      mergedIntoBookingId: targetBooking.id,
      consolidatedInto: targetBooking.id,
      balanceTransferredOut: (sourceBooking.balanceTransferredOut || 0) + carriedBalance,
      actualCheckOutAt: now,
      note: `Đã dồn khách & kết chuyển công nợ ${carriedBalance.toLocaleString('vi-VN')}đ sang P.${targetBooking.roomNumber} (${targetBooking.bookingCode}).`,
      updatedAt: now,
    });
    tx.update(doc(db, 'rooms', sourceBooking.roomId), {
      currentBookingId: null,
      hkStatus: 'dirty',
    });
    tx.update(doc(db, 'bookings', targetBooking.id), {
      occupants: mergedOccupants,
      ...flags,
      transferredBalance: nextTransferredBalance,
      mergedFromBookingIds: [...(targetBooking.mergedFromBookingIds || []), sourceBooking.id],
      note: `${targetBooking.note ? `${targetBooking.note} | ` : ''}Nhận kết chuyển công nợ ${carriedBalance.toLocaleString('vi-VN')}đ từ P.${sourceBooking.roomNumber} (${sourceBooking.bookingCode})`.trim(),
      updatedAt: now,
    });
  });

  await writeAuditLog({
    actionType: 'room_merge_consolidate',
    targetId: targetBooking.id,
    targetLabel: `Dồn P.${sourceBooking.roomNumber} -> P.${targetBooking.roomNumber} (Chuyển công nợ ${carriedBalance.toLocaleString('vi-VN')}đ, không tăng doanh thu ảo)`,
    previousState: {
      sourceBookingId: sourceBooking.id,
      sourceBalance: carriedBalance,
      targetTransferredBalance: targetBooking.transferredBalance || 0,
    },
    newState: {
      targetBookingId: targetBooking.id,
      targetTransferredBalance: nextTransferredBalance,
      occupantCount: flags.occupantCount,
    },
    reason: 'Ghép phòng dồn khách & kết chuyển công nợ sang trường transferredBalance riêng',
    actor,
  });
}

export async function recordTransaction(params: {
  booking?: Booking | null;
  groupId?: string | null;
  type: TransactionType;
  direction: 'in' | 'out';
  category: string;
  amount: number;
  method: PaymentMethod;
  date?: string;
  accountingLockDate?: string | null;
  note?: string;
  actor: ActorInfo;
}): Promise<Transaction> {
  const now = new Date().toISOString();
  const txDate = params.date || todayISO();
  assertPeriodOpen(txDate, params.accountingLockDate);

  const txId = generateId('tx');
  const amount = Math.max(0, Math.round(params.amount));
  const tx: Transaction = {
    id: txId,
    bookingId: params.booking?.id || null,
    bookingCode: params.booking?.bookingCode || null,
    roomNumber: params.booking?.roomNumber || null,
    groupId: params.groupId || params.booking?.groupId || null,
    type: params.type,
    direction: params.direction,
    category: params.category,
    amount,
    method: params.method,
    date: txDate,
    status: 'active',
    createdAt: now,
    createdByUid: params.actor.uid,
    createdByName: params.actor.name,
    note: params.note?.trim() || '',
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'transactions', txId), tx);

  if (params.booking) {
    if (params.method === 'ota_debt') {
      batch.update(doc(db, 'bookings', params.booking.id), {
        paymentMethod: 'ota_debt',
        otaSettlementStatus: 'unsettled',
        updatedAt: now,
      });
    } else if (params.type === 'deposit' || params.type === 'payment' || params.type === 'refund') {
      const nextPaid = applyPaymentDelta(params.booking, params.type, amount);
      batch.update(doc(db, 'bookings', params.booking.id), {
        depositPaid: nextPaid.depositPaid,
        guestPaid: nextPaid.guestPaid,
        updatedAt: now,
      });
    }
  }
  await batch.commit();

  await writeAuditLog({
    actionType: `tx_${params.type}`,
    targetId: txId,
    targetLabel: `${params.category} — ${amount.toLocaleString('vi-VN')}đ`,
    newState: { amount, method: params.method, date: txDate, bookingCode: params.booking?.bookingCode || null },
    relatedTransactionIds: [txId],
    reason: params.note || params.category,
    actor: params.actor,
  });

  return tx;
}

export async function undoBookingAction(params: {
  booking: Booking;
  reason: string;
  actor: ActorInfo;
  overridePrevState?: Record<string, unknown>;
}): Promise<void> {
  // Bug #6: Permanently block quick-undo bypass for check_in / check_out / early_checkout
  const snapAction = (params.booking.lastActionSnapshot as { action?: string } | null)?.action;
  if (snapAction === 'check_in' || snapAction === 'check_out' || snapAction === 'early_checkout') {
    throw new Error(
      'Không được hoàn tác nhanh Nhận/Trả phòng. Vui lòng dùng đúng luồng "Đảo Check-in nhầm" (chọn phòng Sạch/Bẩn) hoặc "Mở lại đơn đã Check-out" (quyền Chủ KS/Quản lý).'
    );
  }
  const snapshot =
    params.overridePrevState ||
    ((params.booking.lastActionSnapshot as { prevState?: Record<string, unknown> } | null)
      ?.prevState as Record<string, unknown> | undefined);

  if (!snapshot) {
    throw new Error('Không tìm thấy trạng thái trước đó để hoàn tác.');
  }

  const now = new Date().toISOString();
  const prevStatus = (snapshot.status || snapshot.oldStatus) as Booking['status'] | undefined;
  if (
    (params.booking.status === 'in_house' && prevStatus === 'reserved') ||
    (params.booking.status === 'checked_out' && prevStatus === 'in_house')
  ) {
    throw new Error(
      'Thao tác Đảo Check-in hoặc Mở lại đơn Đã trả phòng bắt buộc thực hiện qua quy trình kiểm soát kế toán.'
    );
  }
  const updatePayload: Record<string, unknown> = {
    updatedAt: now,
    lastActionSnapshot: null,
  };
  if (prevStatus) updatePayload.status = prevStatus;
  if ('checkOut' in snapshot) updatePayload.checkOut = snapshot.checkOut;
  if ('dailyRates' in snapshot) updatePayload.dailyRates = snapshot.dailyRates;
  if ('nights' in snapshot) updatePayload.nights = snapshot.nights;
  if ('grossRoomTotal' in snapshot) updatePayload.grossRoomTotal = snapshot.grossRoomTotal;
  if ('netRoomTotal' in snapshot) updatePayload.netRoomTotal = snapshot.netRoomTotal;
  if ('actualCheckInAt' in snapshot) updatePayload.actualCheckInAt = snapshot.actualCheckInAt;
  if ('actualCheckOutAt' in snapshot) updatePayload.actualCheckOutAt = snapshot.actualCheckOutAt;
  if ('oldRoomId' in snapshot && snapshot.oldRoomId) {
    updatePayload.roomId = snapshot.oldRoomId;
    updatePayload.roomNumber = snapshot.oldRoomNumber;
  }

  // v2.2.2 BUG-02: Seal undoBookingAction through atomic runTransaction() + room_occupancy
  const targetRoomId = String(updatePayload.roomId || params.booking.roomId);
  const targetRoomNumber = String(updatePayload.roomNumber || params.booking.roomNumber);
  const nextStatus = (prevStatus || params.booking.status) as Booking['status'];
  const nextCheckOut = String(updatePayload.checkOut || params.booking.checkOut);
  const curBlocking = params.booking.status === 'reserved' || params.booking.status === 'in_house';
  const nextBlocking = nextStatus === 'reserved' || nextStatus === 'in_house';

  const curIv = buildBookingOccupancyInterval(params.booking, '14:00', '12:00', DEFAULT_CLEANING_BUFFER_MINUTES, now);
  const curDates = getAffectedOccupancyDates(curIv.startAt, curIv.endAt, curIv.bufferMinutes);
  const nextIv = buildBookingOccupancyInterval(
    {
      id: params.booking.id,
      bookingMode: params.booking.bookingMode,
      checkIn: params.booking.checkIn,
      checkOut: nextCheckOut,
      checkInTime: params.booking.checkInTime,
      checkOutTime: params.booking.checkOutTime,
      hourlyHours: params.booking.hourlyHours,
    },
    '14:00',
    '12:00',
    DEFAULT_CLEANING_BUFFER_MINUTES,
    now
  );

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      release: curBlocking ? [{ roomId: params.booking.roomId, id: params.booking.id, dates: curDates }] : [],
      reserve: nextBlocking ? [{ roomId: targetRoomId, roomNumber: targetRoomNumber, interval: nextIv }] : [],
    });
    applyOccupancyPlanInTransaction(tx, db, occPlan);

    tx.update(
      doc(db, 'bookings', params.booking.id),
      updatePayload as UpdateData<DocumentData>
    );

    if (prevStatus === 'in_house') {
      tx.update(doc(db, 'rooms', targetRoomId), {
        currentBookingId: params.booking.id,
        hkStatus: 'clean',
      });
    } else if (prevStatus === 'reserved') {
      tx.update(doc(db, 'rooms', targetRoomId), {
        currentBookingId: null,
      });
    }
  });

  await writeAuditLog({
    actionType: 'undo_action',
    targetId: params.booking.id,
    targetLabel: `Hoàn tác ${params.booking.bookingCode} (P.${params.booking.roomNumber})`,
    previousState: { status: params.booking.status },
    newState: snapshot,
    reason: params.reason.trim() || 'Hoàn tác thao tác lễ tân',
    actor: params.actor,
  });
}

/**
 * Immutable Accounting Reversal (v2.0.0):
 * Original transaction documents are NEVER edited or deleted (enforced by firestore.rules).
 * Instead, creates a brand-new offsetting reversal transaction with opposite direction
 * and updates booking paid totals + writes `audit_logs`.
 */
export async function voidTransactionWithUndo(params: {
  tx: Transaction;
  booking?: Booking | null;
  reason: string;
  actor: ActorInfo;
}): Promise<void> {
  if (params.tx.type === 'reversal') {
    throw new Error('Không thể đảo ngược một bút toán đối ứng.');
  }
  const now = new Date().toISOString();
  const revId = generateId('txrev');
  const reversalTx: Transaction = {
    id: revId,
    bookingId: params.tx.bookingId || null,
    bookingCode: params.tx.bookingCode || null,
    roomNumber: params.tx.roomNumber || null,
    groupId: params.tx.groupId || null,
    payoutBatchId: params.tx.payoutBatchId || null,
    roomMaintenanceId: params.tx.roomMaintenanceId || null,
    reversalOfTxId: params.tx.id,
    type: 'reversal',
    direction: params.tx.direction === 'in' ? 'out' : 'in',
    category: `Bút toán đối ứng (Hủy: ${params.tx.category})`,
    amount: params.tx.amount,
    method: params.tx.method,
    date: todayISO(),
    status: 'active',
    voidReason: params.reason.trim() || 'Hoàn tác giao dịch bằng bút toán đối ứng',
    createdAt: now,
    createdByUid: params.actor.uid,
    createdByName: params.actor.name,
    note: `Đối ứng giao dịch #${params.tx.id.slice(-6)} — Lý do: ${params.reason.trim()}`,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'transactions', revId), reversalTx);

  if (params.booking && params.tx.method !== 'ota_debt') {
    if (params.tx.type === 'deposit') {
      batch.update(doc(db, 'bookings', params.booking.id), {
        depositPaid: Math.max(0, (params.booking.depositPaid || 0) - params.tx.amount),
        updatedAt: now,
      });
    } else if (params.tx.type === 'payment') {
      batch.update(doc(db, 'bookings', params.booking.id), {
        guestPaid: Math.max(0, (params.booking.guestPaid || 0) - params.tx.amount),
        updatedAt: now,
      });
    }
  }

  await batch.commit();

  await writeAuditLog({
    actionType: 'void_transaction',
    targetId: params.tx.id,
    targetLabel: `Bút toán đối ứng ${params.tx.category} (${params.tx.amount.toLocaleString('vi-VN')}đ)`,
    previousState: { originalTxId: params.tx.id, amount: params.tx.amount, direction: params.tx.direction },
    newState: { reversalTxId: revId, direction: reversalTx.direction },
    reason: params.reason.trim() || 'Lập bút toán đối ứng hoàn tác giao dịch',
    actor: params.actor,
  });
}

export async function createOtaPayoutBatch(params: {
  otaChannel: string;
  payoutDate: string;
  bookings: Booking[];
  appliedAdjustments?: OtaAdjustment[];
  actualReceivedAmount: number;
  accountingLockDate?: string | null;
  note?: string;
  actor: ActorInfo;
}): Promise<OtaPayoutBatch> {
  if (params.bookings.length === 0) throw new Error('Chưa chọn đơn OTA nào để gạch nợ.');
  assertPeriodOpen(params.payoutDate, params.accountingLockDate);

  const now = new Date().toISOString();
  const batchId = generateId('otabatch');
  const batchCode = generateCode('OTA');
  const rawBookingsTotal = params.bookings.reduce((s, b) => s + (b.grossRoomTotal || 0), 0);
  const adjustments = params.appliedAdjustments || [];
  const adjTotal = adjustments.reduce((s, a) => s + (a.adjustmentAmount || 0), 0);
  const expectedNetTotal = Math.max(0, rawBookingsTotal + adjTotal);
  const actual = Math.max(0, Math.round(params.actualReceivedAmount));
  const bankFeeDiff = expectedNetTotal - actual;

  const payoutBatch: OtaPayoutBatch = {
    id: batchId,
    batchCode,
    otaChannel: params.otaChannel,
    payoutDate: params.payoutDate,
    bookingIds: params.bookings.map((b) => b.id),
    bookingCodes: params.bookings.map((b) => b.bookingCode),
    expectedNetTotal,
    actualReceivedAmount: actual,
    bankFeeDiff,
    note: params.note?.trim() || '',
    createdAt: now,
    createdBy: params.actor.name,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'ota_payout_batches', batchId), payoutBatch);
  for (const b of params.bookings) {
    batch.update(doc(db, 'bookings', b.id), {
      otaSettlementStatus: 'settled',
      payoutBatchId: batchId,
      updatedAt: now,
    });
  }
  // Bug #11b: Atomically settle all selected pending OTA adjustments in the SAME writeBatch
  for (const adj of adjustments) {
    batch.update(doc(db, 'ota_adjustments', adj.id), {
      status: 'settled',
      appliedBatchId: batchCode,
    });
  }

  const txId = generateId('tx');
  const tx: Transaction = {
    id: txId,
    payoutBatchId: batchId,
    type: 'ota_payout',
    direction: 'in',
    category: `OTA thanh toán công nợ (${params.otaChannel})`,
    amount: actual,
    method: 'bank_transfer',
    date: params.payoutDate,
    status: 'active',
    createdAt: now,
    createdByUid: params.actor.uid,
    createdByName: params.actor.name,
    note: `Lô ${batchCode} (${params.bookings.length} đơn${adjustments.length > 0 ? `, cấn trừ ${adjustments.length} điều chỉnh ${adjTotal.toLocaleString('vi-VN')}đ` : ''
      })${bankFeeDiff !== 0 ? ` — Chênh lệch: ${bankFeeDiff.toLocaleString('vi-VN')}đ` : ''}`,
  };
  batch.set(doc(db, 'transactions', txId), tx);

  await batch.commit();

  await writeAuditLog({
    actionType: 'ota_payout_batch',
    targetId: batchId,
    targetLabel: `${batchCode} — ${params.otaChannel} (${params.bookings.length} đơn)`,
    newState: {
      expectedNetTotal,
      appliedAdjustmentIds: adjustments.map((a) => a.id),
      adjTotal,
      actualReceivedAmount: actual,
      bankFeeDiff,
    },
    relatedTransactionIds: [txId],
    reason: 'Gạch nợ đối soát chuyển khoản OTA theo lô',
    actor: params.actor,
  });

  return payoutBatch;
}

export async function updateRoomHkStatus(
  room: Room,
  hkStatus: HousekeepingStatus,
  actor: ActorInfo,
  note?: string
): Promise<void> {
  await updateDoc(doc(db, 'rooms', room.id), {
    hkStatus,
    ...(note !== undefined ? { note } : {}),
  });
  await writeAuditLog({
    actionType: 'housekeeping_update',
    targetId: room.id,
    targetLabel: `P.${room.roomNumber} -> ${hkStatus}`,
    previousState: { hkStatus: room.hkStatus },
    newState: { hkStatus },
    reason: note || 'Cập nhật trạng thái buồng phòng',
    actor,
  });
}

export async function createRoomMaintenance(params: {
  room: Room;
  issueTitle: string;
  description: string;
  cost: number;
  maintenanceFrom?: string;
  maintenanceTo?: string;
  markRoomAsMaintenance: boolean;
  isCompletedNow: boolean;
  paymentMethod: PaymentMethod;
  accountingLockDate?: string | null;
  actor: ActorInfo;
}): Promise<RoomMaintenance> {
  const now = new Date().toISOString();
  const today = todayISO();
  const id = generateId('mnt');
  const cleanCost = Math.max(0, Math.round(params.cost || 0));
  const mFrom = params.maintenanceFrom || today;
  const mTo = params.maintenanceTo && params.maintenanceTo >= mFrom ? params.maintenanceTo : mFrom;
  let txId: string | null = null;

  if (cleanCost > 0) {
    assertPeriodOpen(today, params.accountingLockDate);
  }

  const maint: RoomMaintenance = {
    id,
    roomId: params.room.id,
    roomNumber: params.room.roomNumber,
    issueTitle: params.issueTitle.trim(),
    description: params.description.trim(),
    cost: cleanCost,
    transactionId: txId,
    status: params.isCompletedNow ? 'completed' : 'pending',
    maintenanceFrom: mFrom,
    maintenanceTo: mTo,
    reportedAt: now,
    completedAt: params.isCompletedNow ? now : null,
    performedBy: params.actor.name,
  };

  if (cleanCost > 0) {
    txId = generateId('tx');
    maint.transactionId = txId;
  }

  // v2.2.2 BUG-02: Reserve room_occupancy atomically when maintenance is active (!isCompletedNow)
  await runTransaction(db, async (tx) => {
    if (!params.isCompletedNow) {
      const mIv = buildMaintenanceOccupancyInterval(maint, now);
      const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
        reserve: [{ roomId: params.room.id, roomNumber: params.room.roomNumber, interval: mIv }],
      });
      applyOccupancyPlanInTransaction(tx, db, occPlan);
    }

    if (cleanCost > 0 && txId) {
      const expTx: Transaction = {
        id: txId,
        roomNumber: params.room.roomNumber,
        roomMaintenanceId: id,
        type: 'expense',
        direction: 'out',
        category: 'Sửa chữa & Bảo trì',
        amount: cleanCost,
        method: params.paymentMethod,
        date: today,
        status: 'active',
        createdAt: now,
        createdByUid: params.actor.uid,
        createdByName: params.actor.name,
        note: `Bảo trì P.${params.room.roomNumber}: ${params.issueTitle}`,
      };
      tx.set(doc(db, 'transactions', txId), expTx);
    }

    tx.set(doc(db, 'room_maintenances', id), stripUndefined(maint));

    if (params.markRoomAsMaintenance && !params.isCompletedNow) {
      tx.update(doc(db, 'rooms', params.room.id), { hkStatus: 'maintenance' });
    } else if (params.isCompletedNow && params.room.hkStatus === 'maintenance') {
      tx.update(doc(db, 'rooms', params.room.id), { hkStatus: 'clean' });
    }
  });

  await writeAuditLog({
    actionType: 'room_maintenance',
    targetId: id,
    targetLabel: `Bảo trì P.${params.room.roomNumber}: ${params.issueTitle}`,
    newState: { cost: cleanCost, status: maint.status },
    reason: params.description || params.issueTitle,
    actor: params.actor,
  });

  return maint;
}

export async function completeRoomMaintenance(
  maint: RoomMaintenance,
  room: Room | undefined,
  actor: ActorInfo
): Promise<void> {
  const now = new Date().toISOString();
  const mIv = buildMaintenanceOccupancyInterval(maint, now);
  const mDates = getAffectedOccupancyDates(mIv.startAt, mIv.endAt, 0);

  await runTransaction(db, async (tx) => {
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      release: [{ roomId: maint.roomId, id: maint.id, dates: mDates }],
    });
    applyOccupancyPlanInTransaction(tx, db, occPlan);
    tx.update(doc(db, 'room_maintenances', maint.id), {
      status: 'completed',
      completedAt: now,
    });
    if (room && room.hkStatus === 'maintenance') {
      tx.update(doc(db, 'rooms', room.id), { hkStatus: 'clean' });
    }
  });

  await writeAuditLog({
    actionType: 'complete_maintenance',
    targetId: maint.id,
    targetLabel: `Hoàn tất bảo trì P.${maint.roomNumber}`,
    newState: { status: 'completed' },
    reason: maint.issueTitle,
    actor,
  });
}

export async function scanOldGuestDocumentPhotos(
  bookings: Booking[],
  cutoffDateISO: string
): Promise<{ docs: GuestDocument[]; totalBytes: number; imageCount: number }> {
  const eligibleBookingIds = new Set(
    bookings
      .filter((b) => b.status === 'checked_out' && b.checkOut <= cutoffDateISO)
      .map((b) => b.id)
  );
  if (eligibleBookingIds.size === 0) {
    return { docs: [], totalBytes: 0, imageCount: 0 };
  }

  const snap = await getDocs(
    query(collection(db, 'guest_documents'), where('isCleaned', '==', false))
  );
  const docs: GuestDocument[] = [];
  let totalBytes = 0;
  let imageCount = 0;

  snap.forEach((d) => {
    const data = d.data() as GuestDocument;
    if (!eligibleBookingIds.has(data.bookingId)) return;
    const count =
      (data.frontImageBase64 ? 1 : 0) +
      (data.backImageBase64 ? 1 : 0) +
      (data.entryStampImageBase64 ? 1 : 0);
    if (count > 0) {
      docs.push(data);
      totalBytes += data.totalSizeBytes || 0;
      imageCount += count;
    }
  });

  return { docs, totalBytes, imageCount };
}

export async function cleanupOldGuestDocumentPhotos(
  docsToClean: GuestDocument[],
  cutoffDateISO: string,
  actor: ActorInfo
): Promise<{ cleanedDocs: number; freedBytes: number }> {
  const now = new Date().toISOString();
  let freedBytes = 0;

  for (let i = 0; i < docsToClean.length; i += 400) {
    const chunk = docsToClean.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const gd of chunk) {
      freedBytes += gd.totalSizeBytes || 0;
      batch.update(doc(db, 'guest_documents', gd.id), {
        frontImageBase64: null,
        backImageBase64: null,
        entryStampImageBase64: null,
        totalSizeBytes: 0,
        isCleaned: true,
        cleanedAt: now,
        cleanedBy: actor.name,
      });
    }
    await batch.commit();
  }

  await writeAuditLog({
    actionType: 'cleanup_id_photos',
    targetId: `cleanup_${cutoffDateISO}`,
    targetLabel: `Dọn ${docsToClean.length} hồ sơ ảnh trước ${formatDateVN(cutoffDateISO)}`,
    newState: { cleanedDocs: docsToClean.length, freedBytes },
    reason: `SuperAdmin dọn dẹp thủ công ảnh Base64 đã check-out trước ${formatDateVN(cutoffDateISO)}`,
    actor,
  });

  return { cleanedDocs: docsToClean.length, freedBytes };
}

// ==========================================
// Bug #8: Staff CRUD via Firebase Auth Email/Password + Secondary App (0 VND, ZERO passwordHash)
// ==========================================

export async function createStaffAccount(params: {
  username: string;
  password: string;
  fullName: string;
  phone: string;
  role: Exclude<StaffRole, 'superadmin'>;
  permissions?: StaffPermissions;
  actor: ActorInfo;
}): Promise<StaffUser> {
  const cleanUser = params.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (cleanUser.length < 3) {
    throw new Error('Tên đăng nhập cần tối thiểu 3 ký tự (chữ thường, số, không dấu/khoảng trắng).');
  }
  if (params.password.length < 6) {
    throw new Error('Mật khẩu Firebase Auth cần tối thiểu 6 ký tự.');
  }

  const dup = await getDocs(
    query(collection(db, 'staff_users'), where('username', '==', cleanUser))
  );
  if (!dup.empty) {
    throw new Error(`Tên đăng nhập "${cleanUser}" đã tồn tại.`);
  }

  const internalEmail = usernameToInternalEmail(cleanUser);
  const secondaryAuth = getStaffCreatorAuth();
  let newUid: string;
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, internalEmail, params.password);
    newUid = cred.user.uid;
    await firebaseSignOut(secondaryAuth);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/email-already-in-use') {
      throw new Error(
        `Tên đăng nhập "${cleanUser}" đã được đăng ký trong Firebase Auth. Vui lòng chọn tên đăng nhập khác (VD: ${cleanUser}2).`
      );
    }
    if (code === 'auth/weak-password') {
      throw new Error('Mật khẩu quá yếu (tối thiểu 6 ký tự).');
    }
    throw err;
  }

  const now = new Date().toISOString();
  const staff: StaffUser = {
    uid: newUid,
    username: cleanUser,
    fullName: params.fullName.trim(),
    phone: params.phone.trim(),
    email: internalEmail,
    role: params.role,
    authSource: 'firebase_staff',
    mustChangePassword: true,
    permissions: params.permissions || getDefaultPermissionsForRole(params.role),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'staff_users', newUid), staff);
  await writeAuditLog({
    actionType: 'create_staff',
    targetId: newUid,
    targetLabel: `Tạo tài khoản ${staff.fullName} (@${staff.username} — ${staff.role})`,
    reason: 'Quản lý tạo mới tài khoản nhân viên Firebase Auth (bắt buộc đổi MK lần đầu)',
    actor: params.actor,
  });
  return staff;
}

export async function updateStaffMember(staff: StaffUser, actor: ActorInfo): Promise<void> {
  const { ...cleanStaff } = staff;
  // Never persist passwordHash field
  delete (cleanStaff as Record<string, unknown>).passwordHash;
  await setDoc(
    doc(db, 'staff_users', staff.uid),
    { ...cleanStaff, updatedAt: new Date().toISOString() },
    { merge: true }
  );
  await writeAuditLog({
    actionType: 'manage_staff',
    targetId: staff.uid,
    targetLabel: `${staff.fullName} (@${staff.username}, ${staff.role}, ${staff.isActive ? 'Đang hoạt động' : 'Đã khóa'
      })`,
    newState: { role: staff.role, isActive: staff.isActive, permissions: staff.permissions },
    reason: 'Cập nhật hồ sơ & phân quyền nhân viên',
    actor,
  });
}

/**
 * Bug #8 (0 VND Zero-Cloud-Function replacement for forgotten password):
 * Locks the old staff account (`isActive: false`) and creates a fresh Firebase Auth account
 * with `mustChangePassword: true` via Secondary App in 5 seconds.
 */
export async function replaceForgottenStaffAccount(params: {
  oldStaff: StaffUser;
  newUsername: string;
  tempPassword: string;
  actor: ActorInfo;
}): Promise<StaffUser> {
  const { oldStaff, newUsername, tempPassword, actor } = params;
  if (oldStaff.role === 'superadmin' || oldStaff.authSource === 'firebase_superadmin') {
    throw new Error('Không áp dụng cho SuperAdmin gốc.');
  }
  const created = await createStaffAccount({
    username: newUsername,
    password: tempPassword,
    fullName: oldStaff.fullName,
    phone: oldStaff.phone,
    role: oldStaff.role,
    permissions: oldStaff.permissions,
    actor,
  });
  await updateDoc(doc(db, 'staff_users', oldStaff.uid), {
    isActive: false,
    updatedAt: new Date().toISOString(),
  });
  await writeAuditLog({
    actionType: 'replace_staff_account',
    targetId: oldStaff.uid,
    targetLabel: `Khóa @${oldStaff.username} & cấp mới @${created.username} (${oldStaff.fullName})`,
    reason: 'Cấp lại tài khoản mới do nhân viên quên mật khẩu',
    actor,
  });
  return created;
}

export async function deleteStaffAccount(staff: StaffUser, actor: ActorInfo): Promise<void> {
  if (staff.role === 'superadmin' || staff.authSource === 'firebase_superadmin') {
    throw new Error('Không thể xóa tài khoản SuperAdmin gốc.');
  }
  await deleteDoc(doc(db, 'staff_users', staff.uid));
  await writeAuditLog({
    actionType: 'delete_staff',
    targetId: staff.uid,
    targetLabel: `Xóa tài khoản ${staff.fullName} (@${staff.username})`,
    reason: 'Quản lý xóa tài khoản nhân viên',
    actor,
  });
}

export async function updateOwnProfileAndPassword(params: {
  staff: StaffUser;
  fullName: string;
  phone: string;
  currentPassword?: string;
  newPassword?: string;
  actor: ActorInfo;
}): Promise<void> {
  const updates: Record<string, unknown> = {
    fullName: params.fullName.trim() || params.staff.fullName,
    phone: params.phone.trim(),
    updatedAt: new Date().toISOString(),
  };

  if (params.newPassword && params.newPassword.length > 0) {
    if (params.newPassword.length < 6) {
      throw new Error('Mật khẩu mới cần tối thiểu 6 ký tự.');
    }
    if (!auth.currentUser || !auth.currentUser.email) {
      throw new Error('Phiên đăng nhập Firebase Auth không hợp lệ.');
    }
    if (!params.currentPassword) {
      throw new Error('Vui lòng nhập mật khẩu hiện tại để xác nhận đổi mật khẩu.');
    }
    const cred = EmailAuthProvider.credential(auth.currentUser.email, params.currentPassword);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, params.newPassword);
    updates.mustChangePassword = false;
  }

  await updateDoc(
    doc(db, 'staff_users', params.staff.uid),
    updates as UpdateData<DocumentData>
  );
  await writeAuditLog({
    actionType: 'self_update_profile',
    targetId: params.staff.uid,
    targetLabel: `${params.staff.fullName} tự cập nhật thông tin cá nhân`,
    reason: params.newPassword ? 'Cập nhật hồ sơ & đổi mật khẩu cá nhân (Firebase Auth)' : 'Cập nhật hồ sơ cá nhân',
    actor: params.actor,
  });
}

/**
 * v2.2.2 BUG-02 (Flow #15): Update maintenance date window atomically in `room_occupancy`.
 */
export async function updateRoomMaintenanceSchedule(params: {
  maint: RoomMaintenance;
  nextFrom: string;
  nextTo: string;
  actor: ActorInfo;
}): Promise<void> {
  const { maint, nextFrom, nextTo, actor } = params;
  const safeTo = nextTo >= nextFrom ? nextTo : nextFrom;
  const now = new Date().toISOString();
  const oldIv = buildMaintenanceOccupancyInterval(maint, now);
  const oldDates = getAffectedOccupancyDates(oldIv.startAt, oldIv.endAt, 0);
  const newIv = buildMaintenanceOccupancyInterval(
    { ...maint, maintenanceFrom: nextFrom, maintenanceTo: safeTo },
    now
  );

  await runTransaction(db, async (tx) => {
    const isCompleted = maint.status === 'completed' || maint.status === 'done';
    const occPlan = await prepareOccupancyPlanInTransaction(tx, db, {
      release: [{ roomId: maint.roomId, id: maint.id, dates: oldDates }],
      reserve: isCompleted
        ? []
        : [{ roomId: maint.roomId, roomNumber: maint.roomNumber, interval: newIv }],
    });
    applyOccupancyPlanInTransaction(tx, db, occPlan);
    tx.update(doc(db, 'room_maintenances', maint.id), {
      maintenanceFrom: nextFrom,
      maintenanceTo: safeTo,
    });
  });

  await writeAuditLog({
    actionType: 'room_maintenance_update',
    targetId: maint.id,
    targetLabel: `Cập nhật lịch bảo trì P.${maint.roomNumber} (${nextFrom} -> ${safeTo})`,
    reason: 'Cập nhật ngày bảo trì đồng bộ room_occupancy',
    actor,
  });
}

/**
 * v2.2.2 BUG-03: Idempotent migration for `hotel_config/main.bookingSources`.
 * - Reads `hotel_config/main` inside `runTransaction()`.
 * - If `bookingSources` already exists and is a non-empty array -> NO WRITE (idempotent!).
 * - If missing/empty -> persists default direct + existing `otaChannels` (preserving custom OTA channels
 *   and NEVER overwriting `otaChannels` or any other field) with `configMigrationVersion: 1`.
 */
export async function ensureBookingSourcesConfig(actor?: ActorInfo): Promise<{
  migrated: boolean;
  reason: 'already_present' | 'migrated_defaults' | 'config_missing';
  sourceCount: number;
}> {
  const cfgRef = doc(db, 'hotel_config', 'main');
  const now = new Date().toISOString();
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(cfgRef);
    if (!snap.exists()) {
      return { migrated: false, reason: 'config_missing' as const, sourceCount: 0 };
    }
    const data = snap.data() as {
      bookingSources?: unknown;
      otaChannels?: Array<{ id: string; name: string; color?: string; isActive?: boolean }>;
      configMigrationVersion?: number;
    };
    if (Array.isArray(data.bookingSources) && data.bookingSources.length > 0) {
      return {
        migrated: false,
        reason: 'already_present' as const,
        sourceCount: data.bookingSources.length,
      };
    }

    const directs = DEFAULT_HOTEL_CONFIG.bookingSources
      .filter((s) => s.kind === 'direct')
      .map((s, idx) => ({ ...s, order: idx + 1 }));
    const existingOtas =
      Array.isArray(data.otaChannels) && data.otaChannels.length > 0
        ? data.otaChannels.map((c, idx) => ({
          id: c.id,
          name: c.name,
          kind: 'ota' as const,
          color: c.color,
          isActive: c.isActive !== false,
          order: directs.length + idx + 1,
        }))
        : DEFAULT_HOTEL_CONFIG.bookingSources
          .filter((s) => s.kind === 'ota')
          .map((s, idx) => ({ ...s, order: directs.length + idx + 1 }));

    const mergedSources = [...directs, ...existingOtas];
    tx.update(cfgRef, {
      bookingSources: mergedSources,
      configMigrationVersion: Math.max(1, data.configMigrationVersion || 0),
      updatedAt: now,
    });
    return {
      migrated: true,
      reason: 'migrated_defaults' as const,
      sourceCount: mergedSources.length,
    };
  });

  if (result.migrated && actor) {
    await writeAuditLog({
      actionType: 'config_migration_booking_sources',
      targetId: 'hotel_config/main',
      targetLabel: `Khởi tạo danh mục bookingSources (${result.sourceCount} nguồn)`,
      newState: { configMigrationVersion: 1, sourceCount: result.sourceCount },
      reason: 'Migration idempotent bổ sung trường bookingSources chuẩn v2.2.2',
      actor,
    });
  }
  return result;
}

/**
 * v2.2.2 BUG-03: Merge-only restore for standard booking sources.
 * Appends missing standard `DEFAULT_HOTEL_CONFIG.bookingSources` by `id` WITHOUT deleting
 * or overwriting custom hotel sources or changing inactive flags on existing sources.
 */
export async function restoreMissingDefaultBookingSources(actor: ActorInfo): Promise<{
  addedCount: number;
  totalCount: number;
}> {
  const cfgRef = doc(db, 'hotel_config', 'main');
  const now = new Date().toISOString();
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(cfgRef);
    const data = snap.exists()
      ? (snap.data() as { bookingSources?: Array<{ id: string; name: string; kind: 'direct' | 'ota'; color?: string; isActive: boolean; order?: number }>; configMigrationVersion?: number })
      : {};
    const existing = Array.isArray(data.bookingSources) ? [...data.bookingSources] : [];
    const existingIds = new Set(existing.map((s) => s.id));
    let addedCount = 0;
    for (const def of DEFAULT_HOTEL_CONFIG.bookingSources) {
      if (!existingIds.has(def.id)) {
        existing.push({ ...def, isActive: true, order: existing.length + 1 });
        addedCount++;
      }
    }
    if (addedCount > 0 || !Array.isArray(data.bookingSources)) {
      tx.update(cfgRef, {
        bookingSources: existing,
        configMigrationVersion: Math.max(1, data.configMigrationVersion || 0),
        updatedAt: now,
      });
    }
    return { addedCount, totalCount: existing.length };
  });

  if (res.addedCount > 0) {
    await writeAuditLog({
      actionType: 'restore_default_booking_sources',
      targetId: 'hotel_config/main',
      targetLabel: `Bổ sung ${res.addedCount} nguồn mặc định còn thiếu (tổng ${res.totalCount})`,
      reason: 'Khôi phục danh mục nguồn mặc định (không xóa nguồn tùy chỉnh)',
      actor,
    });
  }
  return res;
}

/**
 * Idempotently initializes `hotel_config/main.serviceCatalog` with standard hotel items
 * ONLY when the field is missing (never overwrites existing configured service prices).
 */
export async function ensureServiceCatalogConfig(actor?: ActorInfo): Promise<{
  migrated: boolean;
  itemCount: number;
}> {
  const cfgRef = doc(db, 'hotel_config', 'main');
  const now = new Date().toISOString();
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(cfgRef);
    if (!snap.exists()) {
      return { migrated: false, itemCount: 0 };
    }
    const data = snap.data() as { serviceCatalog?: unknown };
    if (Array.isArray(data.serviceCatalog)) {
      return { migrated: false, itemCount: data.serviceCatalog.length };
    }
    const defaults = DEFAULT_HOTEL_CONFIG.serviceCatalog || [];
    tx.update(cfgRef, {
      serviceCatalog: defaults,
      updatedAt: now,
    });
    return { migrated: true, itemCount: defaults.length };
  });

  if (res.migrated && actor) {
    await writeAuditLog({
      actionType: 'init_default_service_catalog',
      targetId: 'hotel_config/main',
      targetLabel: `Khởi tạo danh mục dịch vụ & bảng giá mặc định (${res.itemCount} mục)`,
      reason: 'Tự động khởi tạo serviceCatalog mặc định (idempotent)',
      actor,
    }).catch(() => { });
  }
  return res;
}
