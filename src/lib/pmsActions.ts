import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type UpdateData,
} from 'firebase/firestore';
import { db } from './firebase';
import { hashPasswordSha256 } from './crypto';
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
      input.nationality || matched?.nationality || (category === 'vietnamese' ? 'Việt Nam' : ''),
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
  }).catch(() => {});

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
      payload.guestNationality || (payload.guestCategory === 'vietnamese' ? 'Việt Nam' : ''),
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
    checkOut: payload.checkOut,
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

  const batch = writeBatch(db);
  batch.set(doc(db, 'bookings', bookingId), booking);

  if (payload.checkInImmediately) {
    batch.update(doc(db, 'rooms', payload.room.id), { currentBookingId: bookingId });
  }

  if (booking.depositPaid > 0 && payload.depositMethod !== 'ota_debt') {
    const txId = generateId('tx');
    const tx: Transaction = {
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
      date: todayISO(),
      status: 'active',
      createdAt: now,
      createdByUid: actor.uid,
      createdByName: actor.name,
      note: `Đặt cọc đơn ${bookingCode} - P.${payload.room.roomNumber}`,
    };
    batch.set(doc(db, 'transactions', txId), tx);
  }

  await batch.commit();
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
  billingMode: 'master' | 'split';
  depositAmount: number;
  depositMethod: PaymentMethod;
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

  await setDoc(doc(db, 'booking_groups', groupId), group);

  const createdBookings: Booking[] = [];
  for (let i = 0; i < payload.roomItems.length; i++) {
    const item = payload.roomItems[i];
    const roomDeposit = i === 0 ? group.depositAmount : 0;
    const b = await createBooking(
      {
        room: item.room,
        bookingMode: 'daily',
        checkIn: item.checkIn,
        checkOut: item.checkOut,
        guestName: payload.leaderName,
        guestPhone: payload.leaderPhone,
        guestCategory: payload.guestCategory,
        existingGuestId: guestId,
        source: 'group',
        sourceLabel: 'Khách đoàn',
        selectedPriceTierId: item.selectedPriceTierId,
        dailyRates: item.dailyRates,
        paymentMethod: payload.depositMethod,
        depositPaid: roomDeposit,
        depositMethod: payload.depositMethod,
        note: payload.note,
        groupId,
        groupName: group.groupName,
      },
      existingGuests,
      actor
    );
    createdBookings.push(b);
  }

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

  const batch = writeBatch(db);
  batch.update(doc(db, 'bookings', booking.id), {
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
  batch.update(doc(db, 'rooms', booking.roomId), {
    currentBookingId: null,
    hkStatus: 'dirty',
  });

  if (opts?.refundAmount && opts.refundAmount > 0) {
    const txId = generateId('tx');
    const tx: Transaction = {
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
    batch.set(doc(db, 'transactions', txId), tx);
  }

  await batch.commit();

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
  const batch = writeBatch(db);
  batch.update(doc(db, 'bookings', booking.id), {
    status: 'cancelled',
    lastActionSnapshot: { action: 'cancel_booking', prevState },
    updatedAt: now,
  });
  if (booking.status === 'in_house') {
    batch.update(doc(db, 'rooms', booking.roomId), { currentBookingId: null });
  }
  await batch.commit();

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
  item: { name: string; quantity: number; unitPrice: number },
  actor: ActorInfo
): Promise<void> {
  const now = new Date().toISOString();
  const newItem: BookingServiceItem = {
    id: generateId('srv'),
    name: item.name.trim(),
    quantity: Math.max(1, item.quantity),
    unitPrice: Math.max(0, Math.round(item.unitPrice)),
    total: Math.max(1, item.quantity) * Math.max(0, Math.round(item.unitPrice)),
    addedAt: now,
    addedBy: actor.name,
  };
  const nextServices = [...(booking.services || []), newItem];
  const serviceTotal = nextServices.reduce((s, i) => s + i.total, 0);
  await updateDoc(doc(db, 'bookings', booking.id), {
    services: nextServices,
    serviceTotal,
    updatedAt: now,
  });
}

export async function removeBookingService(booking: Booking, serviceId: string): Promise<void> {
  const nextServices = (booking.services || []).filter((s) => s.id !== serviceId);
  const serviceTotal = nextServices.reduce((s, i) => s + i.total, 0);
  await updateDoc(doc(db, 'bookings', booking.id), {
    services: nextServices,
    serviceTotal,
    updatedAt: new Date().toISOString(),
  });
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

    const batch = writeBatch(db);
    batch.update(doc(db, 'bookings', booking.id), {
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
      batch.update(doc(db, 'rooms', booking.roomId), { currentBookingId: null, hkStatus: 'dirty' });
      batch.update(doc(db, 'rooms', targetRoom.id), { currentBookingId: booking.id });
    }
    await batch.commit();

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

  const batch = writeBatch(db);
  batch.update(doc(db, 'bookings', booking.id), {
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
  batch.set(doc(db, 'bookings', newBookingId), newBooking);
  batch.update(doc(db, 'rooms', booking.roomId), { currentBookingId: null, hkStatus: 'dirty' });
  batch.update(doc(db, 'rooms', targetRoom.id), { currentBookingId: newBookingId });
  await batch.commit();

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

export async function consolidateRoomIntoTarget(
  sourceBooking: Booking,
  targetBooking: Booking,
  actor: ActorInfo
): Promise<void> {
  const now = new Date().toISOString();
  const carriedBalance = Math.max(
    0,
    sourceBooking.grossRoomTotal +
      sourceBooking.serviceTotal +
      sourceBooking.hourlySurcharge -
      sourceBooking.depositPaid -
      sourceBooking.guestPaid
  );

  const mergedOccupants: Occupant[] = [
    ...targetBooking.occupants,
    ...sourceBooking.occupants.map((o) => ({ ...o, isPrimary: false })),
  ];
  const flags = computeOccupantFlags(mergedOccupants, targetBooking.checkOut);

  const transferredService: BookingServiceItem[] = [...(targetBooking.services || [])];
  if (carriedBalance > 0) {
    transferredService.push({
      id: generateId('srv'),
      name: `Kết chuyển tiền phòng ghép từ P.${sourceBooking.roomNumber} (${sourceBooking.bookingCode})`,
      quantity: 1,
      unitPrice: carriedBalance,
      total: carriedBalance,
      addedAt: now,
      addedBy: actor.name,
    });
  }
  const nextServiceTotal = transferredService.reduce((s, i) => s + i.total, 0);

  const batch = writeBatch(db);
  batch.update(doc(db, 'bookings', sourceBooking.id), {
    status: 'checked_out',
    mergedIntoBookingId: targetBooking.id,
    actualCheckOutAt: now,
    note: `Đã dồn khách & công nợ sang P.${targetBooking.roomNumber} (${targetBooking.bookingCode}).`,
    updatedAt: now,
  });
  batch.update(doc(db, 'rooms', sourceBooking.roomId), {
    currentBookingId: null,
    hkStatus: 'dirty',
  });
  batch.update(doc(db, 'bookings', targetBooking.id), {
    occupants: mergedOccupants,
    ...flags,
    services: transferredService,
    serviceTotal: nextServiceTotal,
    mergedFromBookingIds: [...(targetBooking.mergedFromBookingIds || []), sourceBooking.id],
    updatedAt: now,
  });
  await batch.commit();

  await writeAuditLog({
    actionType: 'room_merge_consolidate',
    targetId: targetBooking.id,
    targetLabel: `Dồn P.${sourceBooking.roomNumber} -> P.${targetBooking.roomNumber}`,
    previousState: { sourceBookingId: sourceBooking.id, carriedBalance },
    newState: { targetBookingId: targetBooking.id, occupantCount: flags.occupantCount },
    reason: 'Ghép phòng dồn khách sang ở chung 1 phòng',
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
  note?: string;
  actor: ActorInfo;
}): Promise<Transaction> {
  const now = new Date().toISOString();
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
    date: params.date || todayISO(),
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
    } else if (params.type === 'deposit') {
      batch.update(doc(db, 'bookings', params.booking.id), {
        depositPaid: (params.booking.depositPaid || 0) + amount,
        updatedAt: now,
      });
    } else if (params.type === 'payment') {
      batch.update(doc(db, 'bookings', params.booking.id), {
        guestPaid: (params.booking.guestPaid || 0) + amount,
        updatedAt: now,
      });
    }
  }
  await batch.commit();

  await writeAuditLog({
    actionType: `tx_${params.type}`,
    targetId: txId,
    targetLabel: `${params.category} — ${amount.toLocaleString('vi-VN')}đ`,
    newState: { amount, method: params.method, bookingCode: params.booking?.bookingCode || null },
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
  const snapshot =
    params.overridePrevState ||
    ((params.booking.lastActionSnapshot as { prevState?: Record<string, unknown> } | null)
      ?.prevState as Record<string, unknown> | undefined);

  if (!snapshot) {
    throw new Error('Không tìm thấy trạng thái trước đó để hoàn tác.');
  }

  const now = new Date().toISOString();
  const prevStatus = (snapshot.status || snapshot.oldStatus) as Booking['status'] | undefined;
  const batch = writeBatch(db);

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

  batch.update(
    doc(db, 'bookings', params.booking.id),
    updatePayload as UpdateData<DocumentData>
  );

  if (prevStatus === 'in_house') {
    batch.update(doc(db, 'rooms', params.booking.roomId), {
      currentBookingId: params.booking.id,
      hkStatus: 'clean',
    });
  } else if (prevStatus === 'reserved') {
    batch.update(doc(db, 'rooms', params.booking.roomId), {
      currentBookingId: null,
    });
  }

  await batch.commit();

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
  actualReceivedAmount: number;
  note?: string;
  actor: ActorInfo;
}): Promise<OtaPayoutBatch> {
  if (params.bookings.length === 0) throw new Error('Chưa chọn đơn OTA nào để gạch nợ.');
  const now = new Date().toISOString();
  const batchId = generateId('otabatch');
  const batchCode = generateCode('OTA');
  const expectedNetTotal = params.bookings.reduce((s, b) => s + (b.grossRoomTotal || 0), 0);
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
    note: `Lô ${batchCode} (${params.bookings.length} đơn)${
      bankFeeDiff !== 0 ? ` — Chênh lệch: ${bankFeeDiff.toLocaleString('vi-VN')}đ` : ''
    }`,
  };
  batch.set(doc(db, 'transactions', txId), tx);

  await batch.commit();

  await writeAuditLog({
    actionType: 'ota_payout_batch',
    targetId: batchId,
    targetLabel: `${batchCode} — ${params.otaChannel} (${params.bookings.length} đơn)`,
    newState: { expectedNetTotal, actualReceivedAmount: actual, bankFeeDiff },
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
  markRoomAsMaintenance: boolean;
  isCompletedNow: boolean;
  paymentMethod: PaymentMethod;
  actor: ActorInfo;
}): Promise<RoomMaintenance> {
  const now = new Date().toISOString();
  const id = generateId('mnt');
  const cleanCost = Math.max(0, Math.round(params.cost || 0));
  let txId: string | null = null;

  const batch = writeBatch(db);

  if (cleanCost > 0) {
    txId = generateId('tx');
    const tx: Transaction = {
      id: txId,
      roomNumber: params.room.roomNumber,
      roomMaintenanceId: id,
      type: 'expense',
      direction: 'out',
      category: 'Sửa chữa & Bảo trì',
      amount: cleanCost,
      method: params.paymentMethod,
      date: todayISO(),
      status: 'active',
      createdAt: now,
      createdByUid: params.actor.uid,
      createdByName: params.actor.name,
      note: `Bảo trì P.${params.room.roomNumber}: ${params.issueTitle}`,
    };
    batch.set(doc(db, 'transactions', txId), tx);
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
    reportedAt: now,
    completedAt: params.isCompletedNow ? now : null,
    performedBy: params.actor.name,
  };
  batch.set(doc(db, 'room_maintenances', id), maint);

  if (params.markRoomAsMaintenance && !params.isCompletedNow) {
    batch.update(doc(db, 'rooms', params.room.id), { hkStatus: 'maintenance' });
  } else if (params.isCompletedNow && params.room.hkStatus === 'maintenance') {
    batch.update(doc(db, 'rooms', params.room.id), { hkStatus: 'clean' });
  }

  await batch.commit();

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
  const batch = writeBatch(db);
  batch.update(doc(db, 'room_maintenances', maint.id), {
    status: 'completed',
    completedAt: now,
  });
  if (room && room.hkStatus === 'maintenance') {
    batch.update(doc(db, 'rooms', room.id), { hkStatus: 'clean' });
  }
  await batch.commit();

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
// Staff CRUD (Firestore `staff_users`, SHA-256 Password)
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
  const cleanUser = params.username.trim().toLowerCase().replace(/\s+/g, '');
  if (cleanUser.length < 3) {
    throw new Error('Tên đăng nhập cần tối thiểu 3 ký tự (không dấu, không khoảng trắng).');
  }
  if (params.password.length < 4) {
    throw new Error('Mật khẩu cần tối thiểu 4 ký tự.');
  }

  const dup = await getDocs(
    query(collection(db, 'staff_users'), where('username', '==', cleanUser))
  );
  if (!dup.empty) {
    throw new Error(`Tên đăng nhập "${cleanUser}" đã tồn tại.`);
  }

  const now = new Date().toISOString();
  const uid = generateId('staff');
  const passwordHash = await hashPasswordSha256(params.password);
  const staff: StaffUser = {
    uid,
    username: cleanUser,
    passwordHash,
    fullName: params.fullName.trim(),
    phone: params.phone.trim(),
    email: '',
    role: params.role,
    authSource: 'firestore_staff',
    permissions: params.permissions || getDefaultPermissionsForRole(params.role),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'staff_users', uid), staff);
  await writeAuditLog({
    actionType: 'create_staff',
    targetId: uid,
    targetLabel: `Tạo tài khoản ${staff.fullName} (@${staff.username} — ${staff.role})`,
    reason: 'Quản lý tạo mới tài khoản nhân viên',
    actor: params.actor,
  });
  return staff;
}

export async function updateStaffMember(staff: StaffUser, actor: ActorInfo): Promise<void> {
  await setDoc(
    doc(db, 'staff_users', staff.uid),
    { ...staff, updatedAt: new Date().toISOString() },
    { merge: true }
  );
  await writeAuditLog({
    actionType: 'manage_staff',
    targetId: staff.uid,
    targetLabel: `${staff.fullName} (@${staff.username}, ${staff.role}, ${
      staff.isActive ? 'Đang hoạt động' : 'Đã khóa'
    })`,
    newState: { role: staff.role, isActive: staff.isActive, permissions: staff.permissions },
    reason: 'Cập nhật hồ sơ & phân quyền nhân viên',
    actor,
  });
}

export async function resetStaffPassword(
  staff: StaffUser,
  newPassword: string,
  actor: ActorInfo
): Promise<void> {
  if (newPassword.length < 4) throw new Error('Mật khẩu mới cần tối thiểu 4 ký tự.');
  const passwordHash = await hashPasswordSha256(newPassword);
  await updateDoc(doc(db, 'staff_users', staff.uid), {
    passwordHash,
    updatedAt: new Date().toISOString(),
  });
  await writeAuditLog({
    actionType: 'reset_staff_password',
    targetId: staff.uid,
    targetLabel: `Đặt lại mật khẩu cho ${staff.fullName} (@${staff.username})`,
    reason: 'Quản lý đặt lại mật khẩu nhân viên',
    actor,
  });
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
    if (params.newPassword.length < 4) {
      throw new Error('Mật khẩu mới cần tối thiểu 4 ký tự.');
    }
    if (params.staff.authSource === 'firestore_staff') {
      const curHash = await hashPasswordSha256(params.currentPassword || '');
      if (params.staff.passwordHash && curHash !== params.staff.passwordHash) {
        throw new Error('Mật khẩu hiện tại không đúng.');
      }
      updates.passwordHash = await hashPasswordSha256(params.newPassword);
    }
  }

  await updateDoc(
    doc(db, 'staff_users', params.staff.uid),
    updates as UpdateData<DocumentData>
  );
  await writeAuditLog({
    actionType: 'self_update_profile',
    targetId: params.staff.uid,
    targetLabel: `${params.staff.fullName} tự cập nhật thông tin cá nhân`,
    reason: params.newPassword ? 'Cập nhật hồ sơ & đổi mật khẩu cá nhân' : 'Cập nhật hồ sơ cá nhân',
    actor: params.actor,
  });
}
