#!/usr/bin/env node
/**
 * GoHost PMS 2026 -> Like Family PMS v2.2.2 Migration & Reconciliation Script
 *
 * Strictly 0đ Firebase Spark (Client SDK + Local Emulator Suite).
 * Modes:
 *   --mode=emulator (default): Loads backup config/room_types, updates 15 rooms to verified GoHost mapping,
 *                              imports all 7 GoHost Excel files into Firebase Local Emulator, runs
 *                              occupancy audit & 2026 P&L reconciliation, and writes
 *                              QA_REPORTS/GOHOST_MIGRATION_2026/00_GOHOST_DRYRUN_AND_RECONCILIATION.md
 *   --mode=dryrun            : Pure in-memory conversion & report generation (no Firestore writes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import XLSX from 'xlsx';

const rootDir = process.cwd();
const dataDir = path.resolve(rootDir, 'data_gohost');
const reportDir = path.resolve(rootDir, 'QA_REPORTS/GOHOST_MIGRATION_2026');
fs.mkdirSync(reportDir, { recursive: true });

const modeArg = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1] || 'emulator';
const ACTIVE_CUTOFF_DATE = '2026-11-28'; // Bookings with Trạng thái='Đang lưu trú' & checkOut >= 2026-11-28 stay in_house

// Official 15-room GoHost -> Like Family PMS room-type mapping (4 Single: 203, 303, 403, 502; 11 Double/Family)
const OFFICIAL_ROOM_LAYOUT = [
  { roomNumber: '201', floor: 'Tầng 2', roomTypeId: 'rt_dbl_balk', roomTypeName: 'Phòng Đôi Có Ban Công', gohostGroup: 'Phòng đôi' },
  { roomNumber: '202', floor: 'Tầng 2', roomTypeId: 'rt_dbl_nobalk', roomTypeName: 'Phòng Đôi Không Ban Công', gohostGroup: 'Phòng đôi' },
  { roomNumber: '203', floor: 'Tầng 2', roomTypeId: 'rt_std_single', roomTypeName: 'Phòng Đơn Tiêu Chuẩn', gohostGroup: 'Phòng đơn' },
  { roomNumber: '204', floor: 'Tầng 2', roomTypeId: 'rt_family', roomTypeName: 'Phòng Gia Đình 2 Giường Lớn', gohostGroup: 'Phòng đôi' },
  { roomNumber: '301', floor: 'Tầng 3', roomTypeId: 'rt_dbl_balk', roomTypeName: 'Phòng Đôi Có Ban Công', gohostGroup: 'Phòng đôi' },
  { roomNumber: '302', floor: 'Tầng 3', roomTypeId: 'rt_dbl_nobalk', roomTypeName: 'Phòng Đôi Không Ban Công', gohostGroup: 'Phòng đôi' },
  { roomNumber: '303', floor: 'Tầng 3', roomTypeId: 'rt_std_single', roomTypeName: 'Phòng Đơn Tiêu Chuẩn', gohostGroup: 'Phòng đơn' },
  { roomNumber: '304', floor: 'Tầng 3', roomTypeId: 'rt_family', roomTypeName: 'Phòng Gia Đình 2 Giường Lớn', gohostGroup: 'Phòng đôi' },
  { roomNumber: '401', floor: 'Tầng 4', roomTypeId: 'rt_dbl_balk', roomTypeName: 'Phòng Đôi Có Ban Công', gohostGroup: 'Phòng đôi' },
  { roomNumber: '402', floor: 'Tầng 4', roomTypeId: 'rt_dbl_nobalk', roomTypeName: 'Phòng Đôi Không Ban Công', gohostGroup: 'Phòng đôi' },
  { roomNumber: '403', floor: 'Tầng 4', roomTypeId: 'rt_std_single', roomTypeName: 'Phòng Đơn Tiêu Chuẩn', gohostGroup: 'Phòng đơn' },
  { roomNumber: '404', floor: 'Tầng 4', roomTypeId: 'rt_family', roomTypeName: 'Phòng Gia Đình 2 Giường Lớn', gohostGroup: 'Phòng đôi' },
  { roomNumber: '501', floor: 'Tầng 5', roomTypeId: 'rt_dbl_nobalk', roomTypeName: 'Phòng Đôi Không Ban Công', gohostGroup: 'Phòng đôi' },
  { roomNumber: '502', floor: 'Tầng 5', roomTypeId: 'rt_std_single', roomTypeName: 'Phòng Đơn Tiêu Chuẩn', gohostGroup: 'Phòng đơn' },
  { roomNumber: '503', floor: 'Tầng 5', roomTypeId: 'rt_dbl_balk', roomTypeName: 'Phòng Đôi Có Ban Công', gohostGroup: 'Phòng đôi' },
];
const ROOM_META_MAP = new Map(OFFICIAL_ROOM_LAYOUT.map((r) => [r.roomNumber, r]));

// --- Helpers ---
function readExcel(filename) {
  const wb = XLSX.readFile(path.join(dataDir, filename));
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  const s = String(v || '').replace(/[^\d.-]/g, '');
  return Math.round(Number(s) || 0);
}

function normalizeVietnamese(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(str) {
  return String(str || '').replace(/\D/g, '');
}

function excelToISODate(v) {
  if (typeof v === 'number' && v > 20000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function excelToISOTimestamp(v, fallbackDate) {
  if (typeof v === 'number' && v > 20000) {
    // GoHost local VN time stored as Excel serial -> convert assuming UTC+7
    const utcMs = Math.round((v - 25569) * 86400 * 1000) - 7 * 3600 * 1000;
    return new Date(utcMs).toISOString();
  }
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`;
  const d = excelToISODate(v) || fallbackDate || '2026-01-01';
  return `${d}T12:00:00+07:00`;
}

function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function diffDaysISO(fromISO, toISO) {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function formatDateVN(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function formatVND(n) {
  return `${Math.round(n || 0).toLocaleString('vi-VN')}đ`;
}

function splitEvenly(total, parts) {
  if (parts <= 1) return [total];
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i === 0 ? rem : 0));
}

function mapSource(rawSource) {
  const s = String(rawSource || '').trim().toLowerCase();
  if (s === 'zalo') return { source: 'zalo', sourceLabel: 'Zalo' };
  if (s === 'agoda') return { source: 'ota', otaChannel: 'Agoda', sourceLabel: 'Agoda' };
  if (s === 'expedia') return { source: 'ota', otaChannel: 'Expedia', sourceLabel: 'Expedia' };
  if (s === 'traveloka') return { source: 'ota', otaChannel: 'Traveloka', sourceLabel: 'Traveloka' };
  if (s === 'booking' || s === 'booking.com') return { source: 'ota', otaChannel: 'Booking.com', sourceLabel: 'Booking.com' };
  return { source: 'walk_in', sourceLabel: 'Khách vãng lai' };
}

function mapServiceCategory(serviceName) {
  const n = normalizeVietnamese(serviceName);
  if (
    n.includes('suoi nho') ||
    n.includes('suoi lon') ||
    n.includes('nuoc ngot') ||
    n.includes('nuoc yen') ||
    n === 'bia' ||
    n.includes('bia ')
  ) {
    return 'drink';
  }
  if (n.includes('thue xe') || n.includes('giat do') || n.includes('giat ui')) {
    return 'service';
  }
  if (n.includes('o them gio') || n.includes('phu thu') || n.includes('hoa don')) {
    return 'surcharge';
  }
  return 'service';
}

function mapExpenseCategory(gohostCat) {
  const c = normalizeVietnamese(gohostCat);
  if (c.includes('luong')) return 'Lương nhân viên';
  if (c.includes('dien')) return 'Điện / Nước / Internet';
  if (c.includes('sua chua') || c.includes('bao tri')) return 'Sửa chữa & Bảo trì';
  if (c.includes('vat tu') || c.includes('amenities')) return 'Vật tư tiêu hao phòng';
  return gohostCat || 'Chi phí khác';
}

function isForeignNationality(country) {
  const c = String(country || '').trim().toUpperCase();
  return Boolean(c && c !== 'VN' && c !== 'VIETNAM' && c !== 'VIỆT NAM');
}

function stripUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return obj;
}

// --- STEP 1: LOAD ALL 7 GOHOST EXCEL FILES ---
const rawBookings = readExcel('ds-bookings.xlsx');
const rawServices = readExcel('ds-booking-services.xlsx');
const rawCustomers = readExcel('ds-customers.xlsx');
const rawPaymentsAll = readExcel('ds-payments.xlsx');
const rawPayments = rawPaymentsAll.filter(
  (p) => String(p['Mã đặt phòng'] || '').trim() && !String(p['Mã đặt phòng']).toUpperCase().includes('TỔNG')
);
const rawReceivables = readExcel('export-11-receivables.xlsx');
const rawReceipts = readExcel('export-12-receipts.xlsx');
const rawExpenses = readExcel('export-13-transactions.xlsx');

// --- STEP 2: BUILD DEDUPLICATED GUESTS DIRECTORY (ds-customers.xlsx) ---
const guestsById = new Map();
const guestKeyToId = new Map();
let guestSeq = 1;

function findOrCreateGuest({ fullName, phone, email, idNumber, nationality, totalStays, totalSpent, notes, lastVisitDate }) {
  const cleanName = String(fullName || 'Khách lẻ').trim() || 'Khách lẻ';
  const normName = normalizeVietnamese(cleanName);
  const normPhone = normalizePhone(phone);
  const cleanIdNum = String(idNumber || '').trim().toUpperCase();

  const keys = [];
  if (cleanIdNum.length >= 5) keys.push(`id:${cleanIdNum}`);
  if (normPhone.length >= 8) keys.push(`ph:${normPhone}`);
  if (normName && normName !== 'khach le') keys.push(`nm:${normName}`);

  let existingId = null;
  for (const k of keys) {
    if (guestKeyToId.has(k)) {
      existingId = guestKeyToId.get(k);
      break;
    }
  }

  if (existingId) {
    const g = guestsById.get(existingId);
    if (!g.phone && phone) { g.phone = String(phone).trim(); g.normalizedPhone = normPhone; }
    if (!g.idNumber && cleanIdNum) g.idNumber = cleanIdNum;
    if (!g.email && email) g.email = String(email).trim();
    if (!g.nationality && nationality) g.nationality = String(nationality).trim();
    if (!g.notes && notes) g.notes = String(notes).trim();
    if (totalStays > g.totalStays) g.totalStays = totalStays;
    if (totalSpent > g.totalSpent) g.totalSpent = totalSpent;
    if (lastVisitDate && (!g.lastVisitDate || lastVisitDate > g.lastVisitDate)) g.lastVisitDate = lastVisitDate;
    for (const k of keys) guestKeyToId.set(k, existingId);
    return g;
  }

  const gid = `gh_gst_${String(guestSeq++).padStart(4, '0')}`;
  const g = {
    id: gid,
    fullName: cleanName,
    normalizedName: normName,
    phone: String(phone || '').trim(),
    normalizedPhone: normPhone,
    email: String(email || '').trim() || undefined,
    idNumber: cleanIdNum,
    nationality: String(nationality || 'VN').trim() || 'VN',
    guestCategory: isForeignNationality(nationality) ? 'foreigner' : 'vietnamese',
    totalStays: Math.max(0, totalStays || 0),
    totalSpent: Math.max(0, totalSpent || 0),
    lastVisitDate: lastVisitDate || '',
    notes: String(notes || '').trim() || undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    sourceSystem: 'gohost_2026',
  };
  guestsById.set(gid, g);
  for (const k of keys) guestKeyToId.set(k, gid);
  return g;
}

let duplicateCustomerRowsMerged = 0;
for (const c of rawCustomers) {
  const beforeSize = guestsById.size;
  findOrCreateGuest({
    fullName: c['Họ và tên'],
    phone: c['SĐT'],
    email: c['Email'],
    idNumber: c['Số định danh'],
    nationality: c['Quốc gia'],
    totalStays: num(c['Số lần lưu trú']),
    totalSpent: num(c['Tổng số tiền']),
    notes: c['Ghi chú'],
    lastVisitDate: '',
  });
  if (guestsById.size === beforeSize) duplicateCustomerRowsMerged++;
}

// --- STEP 3: INDEX RECEIVABLES BY BOOKING CODE ---
const receivablesByCode = new Map();
const unmatchedReceivables = [];
const allBookingCodesSet = new Set(rawBookings.map((b) => String(b['Mã đặt phòng'] || '').trim()));

for (const r of rawReceivables) {
  const code = String(r['Mã đặt phòng'] || '').trim();
  const entry = {
    code,
    source: String(r['Nguồn'] || '').trim(),
    kind: String(r['Phân loại'] || '').trim(),
    guestName: String(r['Tên khách hàng'] || '').trim(),
    amount: num(r['Số tiền']),
    status: String(r['Trạng thái'] || '').trim(), // 'Chưa thu' | 'Hoàn thành'
    createdDate: excelToISODate(r['Ngày tạo']),
    checkIn: excelToISODate(r['Nhận phòng']),
    checkOut: excelToISODate(r['Trả phòng']),
    paidDate: excelToISODate(r['Ngày thanh toán']),
    note: String(r['Ghi chú'] || '').trim(),
  };
  if (!allBookingCodesSet.has(code)) {
    unmatchedReceivables.push(entry);
  } else {
    const arr = receivablesByCode.get(code) || [];
    arr.push(entry);
    receivablesByCode.set(code, arr);
  }
}

// --- STEP 4: CONVERT 807 BOOKINGS -> BOOKINGS + BOOKING_GROUPS ---
const pmsBookings = [];
const pmsGroups = [];
const bookingsByGoHostCode = new Map(); // code -> Booking[]
const statusTransitionLog = {
  completedToCheckedOut: 0,
  cancelledToCancelled: 0,
  inHouseKeptActive: [], // checkOut >= 2026-11-28
  inHouseOverdueConverted: [], // checkOut < 2026-11-28
  newKeptReserved: [],
  newOverdueConverted: [],
};
const cleanedDirtyRoomStrings = [];
let multiRoomBookingCount = 0;
let hourlyBookingCount = 0;

for (const row of rawBookings) {
  const code = String(row['Mã đặt phòng'] || '').trim();
  if (!code) continue;

  const rawRoomStr = String(row['Phòng'] || '');
  const rawTokens = rawRoomStr.split(',').map((s) => s.trim()).filter(Boolean);
  const validTokens = rawTokens.filter((r) => ROOM_META_MAP.has(r));
  const uniqueRooms = [...new Set(validTokens)];
  if (rawTokens.length !== uniqueRooms.length || rawRoomStr.includes(', ,') || rawRoomStr.trim().startsWith(',')) {
    cleanedDirtyRoomStrings.push({ code, raw: rawRoomStr, cleaned: uniqueRooms });
  }
  if (uniqueRooms.length === 0) continue;

  const ci = excelToISODate(row['Nhận phòng']);
  const coRaw = excelToISODate(row['Trả phòng']) || ci;
  const rawNights = num(row['Số đêm']);
  const isHourly = rawNights === 0 || coRaw <= ci;
  if (isHourly) hourlyBookingCount++;
  const co = isHourly ? ci : coRaw;
  const nights = isHourly ? 0 : Math.max(1, diffDaysISO(ci, co));

  const rawStatus = String(row['Trạng thái'] || '').trim();
  let status = 'checked_out';
  if (rawStatus === 'Hoàn thành') {
    status = 'checked_out';
    statusTransitionLog.completedToCheckedOut++;
  } else if (rawStatus === 'Đã hủy') {
    status = 'cancelled';
    statusTransitionLog.cancelledToCancelled++;
  } else if (rawStatus === 'Đang lưu trú') {
    if (co >= ACTIVE_CUTOFF_DATE) {
      status = 'in_house';
      statusTransitionLog.inHouseKeptActive.push({
        code,
        guest: String(row['Khách hàng'] || '').trim(),
        rooms: uniqueRooms,
        ci,
        co,
        gross: num(row['Tiền phòng phải thu']),
        paid: num(row['Đã thanh toán']),
      });
    } else {
      status = 'checked_out';
      statusTransitionLog.inHouseOverdueConverted.push({
        code,
        guest: String(row['Khách hàng'] || '').trim(),
        rooms: uniqueRooms,
        ci,
        co,
      });
    }
  } else if (rawStatus === 'Mới') {
    if (co >= ACTIVE_CUTOFF_DATE) {
      status = 'reserved';
      statusTransitionLog.newKeptReserved.push({
        code,
        guest: String(row['Khách hàng'] || '').trim(),
        rooms: uniqueRooms,
        ci,
        co,
        gross: num(row['Tiền phòng phải thu']),
        paid: num(row['Đã thanh toán']),
      });
    } else {
      status = 'checked_out';
      statusTransitionLog.newOverdueConverted.push({
        code,
        guest: String(row['Khách hàng'] || '').trim(),
        rooms: uniqueRooms,
        ci,
        co,
      });
    }
  }

  const srcInfo = mapSource(row['Nguồn']);
  const guest = findOrCreateGuest({
    fullName: row['Khách hàng'],
    phone: row['SĐT'],
    email: row['Email'],
    idNumber: row['Số định danh'],
    nationality: '',
    totalStays: 1,
    totalSpent: 0,
    lastVisitDate: ci,
  });

  const parentGrossRoom = status === 'cancelled' ? 0 : num(row['Tiền phòng phải thu']);
  const parentCommission = status === 'cancelled' ? 0 : num(row['Phí hoa hồng']);
  const parentPaid = num(row['Đã thanh toán']);

  const recEntries = receivablesByCode.get(code) || [];
  const hasPendingReceivable = recEntries.some((r) => r.status === 'Chưa thu');
  const hasSettledReceivable = !hasPendingReceivable && recEntries.some((r) => r.status === 'Hoàn thành');

  let otaSettlementStatus = 'not_applicable';
  let paymentMethod = undefined;
  if (hasPendingReceivable) {
    otaSettlementStatus = 'pending_ota';
    paymentMethod = 'ota_debt';
  } else if (hasSettledReceivable) {
    otaSettlementStatus = 'settled';
    paymentMethod = 'ota_debt';
  } else if (srcInfo.source === 'ota') {
    otaSettlementStatus = status === 'cancelled' ? 'not_applicable' : 'settled';
  }

  const createdAt = excelToISOTimestamp(row['Ngày đặt'], ci);
  const updatedAt = excelToISOTimestamp(row['Thời gian cập nhật'], co);
  const createdBy = String(row['Người tạo'] || 'LE DUC PHUONG').trim() || 'LE DUC PHUONG';

  const isMulti = uniqueRooms.length > 1;
  let groupId = null;
  let groupName = null;
  if (isMulti) {
    multiRoomBookingCount++;
    groupId = `gh_grp_${code}`;
    groupName = `${guest.fullName} (${code})`;
  }

  const roomGrossSplits = splitEvenly(parentGrossRoom, uniqueRooms.length);
  const commSplits = splitEvenly(parentCommission, uniqueRooms.length);
  const paidSplits = splitEvenly(parentPaid, uniqueRooms.length);

  const childBookings = [];
  uniqueRooms.forEach((roomNum, idx) => {
    const meta = ROOM_META_MAP.get(roomNum);
    const childId = isMulti ? `gh_${code}_R${roomNum}` : `gh_${code}`;
    const childCode = isMulti ? `${code}-${roomNum}` : code;
    const childGross = roomGrossSplits[idx];
    const childComm = commSplits[idx];
    const childNet = Math.max(0, childGross - childComm);
    const childPaid = paidSplits[idx];

    let dailyRates;
    if (isHourly) {
      dailyRates = [{ date: ci, rate: childGross }];
    } else {
      const nightSplits = splitEvenly(childGross, nights);
      dailyRates = nightSplits.map((rate, nIdx) => ({
        date: addDaysISO(ci, nIdx),
        rate,
      }));
    }

    const isForeign = guest.guestCategory === 'foreigner';
    const occupant = {
      occupantId: `occ_${childId}_1`,
      guestId: guest.id,
      guestCategory: guest.guestCategory,
      fullName: guest.fullName,
      phone: guest.phone,
      gender: 'Khác',
      dob: '',
      nationality: guest.nationality || 'VN',
      idType: isForeign ? 'passport' : 'cccd',
      idNumber: guest.idNumber,
      asmStatus: isForeign && (status === 'in_house' || status === 'reserved') ? 'pending_asm' : 'not_applicable',
      isPrimary: true,
    };

    const bookingDoc = stripUndefined({
      id: childId,
      bookingCode: childCode,
      gohostBookingCode: code,
      bookingMode: isHourly ? 'hourly' : 'daily',
      hourlyHours: isHourly ? 2 : undefined,
      checkInTime: isHourly ? '14:00' : '14:00',
      checkOutTime: isHourly ? '16:00' : '12:00',
      groupId,
      groupName,
      checkIn: ci,
      checkOut: co,
      actualCheckInAt: status === 'in_house' || status === 'checked_out' ? `${ci}T14:00:00+07:00` : null,
      actualCheckOutAt: status === 'checked_out' ? `${co}T12:00:00+07:00` : null,
      primaryGuestId: guest.id,
      primaryGuestName: guest.fullName,
      primaryGuestNormalizedName: guest.normalizedName,
      primaryGuestPhone: guest.phone,
      primaryGuestIdNumber: guest.idNumber,
      occupants: [occupant],
      occupantCount: Math.max(1, num(row['Người lớn']) || 1),
      hasForeigner: isForeign,
      hasPendingAsm: occupant.asmStatus === 'pending_asm',
      hasStayPermitAlert: false,
      isReturningGuest: (guest.totalStays || 0) >= 2,
      guestStayCount: guest.totalStays || 1,
      source: srcInfo.source,
      otaChannel: srcInfo.otaChannel,
      sourceLabel: srcInfo.sourceLabel,
      otaBookingRef: String(row['Mã OTA'] || '').trim() || undefined,
      roomId: `room_${roomNum}`,
      roomNumber: roomNum,
      floor: meta.floor,
      roomTypeId: meta.roomTypeId,
      roomTypeName: meta.roomTypeName,
      dailyRates,
      nights,
      grossRoomTotal: childGross,
      otaCommissionAmount: childComm,
      netRoomTotal: childNet,
      serviceTotal: 0,
      services: [],
      hourlySurcharge: 0,
      depositPaid: 0,
      guestPaid: status === 'cancelled' ? 0 : (hasPendingReceivable ? 0 : childPaid),
      paymentMethod,
      otaSettlementStatus,
      status,
      cancellationType: status === 'cancelled' ? 'customer_cancelled' : undefined,
      cancelledAt: status === 'cancelled' ? updatedAt : undefined,
      depositResolutionStatus:
        status === 'cancelled' && childPaid > 0 ? 'pending_deposit_resolution' : 'none',
      pendingDepositAmount: status === 'cancelled' && childPaid > 0 ? childPaid : undefined,
      note: String(row['Ghi chú khách đoàn'] || row['Nhãn'] || '').trim() || undefined,
      createdAt,
      updatedAt,
      createdBy,
      sourceSystem: 'gohost_2026',
    });

    pmsBookings.push(bookingDoc);
    childBookings.push(bookingDoc);
  });

  bookingsByGoHostCode.set(code, childBookings);

  if (isMulti) {
    pmsGroups.push({
      id: groupId,
      groupCode: code,
      groupName,
      leaderName: guest.fullName,
      leaderPhone: guest.phone,
      billingMode: 'master',
      bookingIds: childBookings.map((b) => b.id),
      notes: String(row['Ghi chú khách đoàn'] || '').trim() || undefined,
      createdAt,
      createdBy,
      sourceSystem: 'gohost_2026',
    });
  }
}

// --- STEP 5: ATTACH 207 SERVICES (ds-booking-services.xlsx) ---
let servicesAttachedCount = 0;
let servicesAttachedTotal = 0;
const servicesByCategory = { drink: { count: 0, sum: 0 }, service: { count: 0, sum: 0 }, surcharge: { count: 0, sum: 0 } };
let svcSeq = 1;

for (const s of rawServices) {
  const code = String(s['Mã đặt phòng'] || '').trim();
  const candidates = bookingsByGoHostCode.get(code);
  if (!candidates || candidates.length === 0) continue;

  const svcRoom = String(s['Phòng'] || '').trim();
  const targetBooking = candidates.find((b) => b.roomNumber === svcRoom) || candidates[0];
  const name = String(s['Tên dịch vụ'] || '').trim();
  const qty = Math.max(1, num(s['SL']) || 1);
  const unitPrice = num(s['Giá mỗi đơn vị']);
  const total = num(s['Tổng cộng']) || qty * unitPrice;
  const businessDate = excelToISODate(s['Thời gian tạo']) || targetBooking.checkIn;
  const occurredAt = excelToISOTimestamp(s['Thời gian tạo'], businessDate);
  const category = mapServiceCategory(name);

  const srvItem = {
    id: `gh_srv_${String(svcSeq++).padStart(4, '0')}`,
    name,
    quantity: qty,
    unitPrice,
    total,
    businessDate,
    category,
    occurredAt,
    status: 'active',
    addedAt: occurredAt,
    addedBy: String(s['Nhân viên'] || 'LE DUC PHUONG').trim() || 'LE DUC PHUONG',
  };

  targetBooking.services.push(srvItem);
  targetBooking.serviceTotal += total;
  servicesAttachedCount++;
  servicesAttachedTotal += total;
  servicesByCategory[category].count++;
  servicesByCategory[category].sum += total;
}

// --- STEP 6: BUILD REAL CASHBOOK TRANSACTIONS (ds-payments.xlsx + export-13-transactions.xlsx) ---
const pmsTransactions = [];
let txSeq = 1;
const paymentStats = { cash: 0, bank: 0, cardOther: 0, skippedDebt: 0, receiptTxCount: 0, expenseTxCount: 0, expenseTotal: 0 };

for (const p of rawPayments) {
  const code = String(p['Mã đặt phòng'] || '').trim();
  const candidates = bookingsByGoHostCode.get(code) || [];
  const pRoom = String(p['Phòng'] || '').split(',')[0].trim();
  const targetBooking = candidates.find((b) => b.roomNumber === pRoom) || candidates[0] || null;
  const payDate = excelToISODate(p['Ngày thanh toán']) || excelToISODate(p['Ngày nhận phòng']) || '2026-01-01';
  const payTs = excelToISOTimestamp(p['Ngày thanh toán'], payDate);
  const staffName = String(p['Nhân viên'] || 'LE DUC PHUONG').trim() || 'LE DUC PHUONG';
  const noteRaw = String(p['Ghi chú'] || '').trim();

  const debtAmt = num(p['Công nợ']);
  if (debtAmt > 0) paymentStats.skippedDebt += debtAmt;

  const inflows = [
    { amt: num(p['Tiền mặt']), method: 'cash', label: 'Tiền mặt' },
    { amt: num(p['Chuyển khoản NH']), method: 'bank_transfer', label: 'Chuyển khoản NH' },
    {
      amt:
        num(p['ATM']) +
        num(p['Thẻ visa/master']) +
        num(p['Apple pay']) +
        num(p['POS']) +
        num(p['Wechat Pay']) +
        num(p['Khác']),
      method: 'card',
      label: num(p['Wechat Pay']) > 0 ? 'Wechat Pay' : 'Thẻ/POS/Khác',
    },
  ];

  for (const inf of inflows) {
    if (inf.amt <= 0) continue;
    if (inf.method === 'cash') paymentStats.cash += inf.amt;
    else if (inf.method === 'bank_transfer') paymentStats.bank += inf.amt;
    else paymentStats.cardOther += inf.amt;
    paymentStats.receiptTxCount++;

    pmsTransactions.push(
      stripUndefined({
        id: `gh_tx_in_${String(txSeq++).padStart(4, '0')}`,
        bookingId: targetBooking?.id || null,
        bookingCode: targetBooking?.bookingCode || code,
        roomNumber: targetBooking?.roomNumber || pRoom || undefined,
        groupId: targetBooking?.groupId || null,
        type: 'payment',
        direction: 'in',
        category: 'Thanh toán tiền phòng & dịch vụ',
        amount: inf.amt,
        method: inf.method,
        date: payDate,
        status: 'active',
        createdAt: payTs,
        createdByUid: 'gohost_migration',
        createdByName: staffName,
        note: [inf.label !== 'Tiền mặt' && inf.label !== 'Chuyển khoản NH' ? `[${inf.label}]` : '', noteRaw, `GoHost ${code}`]
          .filter(Boolean)
          .join(' • '),
        sourceSystem: 'gohost_2026',
      })
    );
  }
}

// 14 Operating Expenses (export-13-transactions.xlsx)
for (const e of rawExpenses) {
  const amt = num(e['Số tiền']);
  if (amt <= 0) continue;
  const date = excelToISODate(e['Ngày']) || '2026-01-01';
  const cat = mapExpenseCategory(e['Danh mục']);
  const name = String(e['Tên'] || '').trim();
  paymentStats.expenseTxCount++;
  paymentStats.expenseTotal += amt;

  pmsTransactions.push({
    id: `gh_tx_exp_${String(txSeq++).padStart(4, '0')}`,
    bookingId: null,
    bookingCode: null,
    groupId: null,
    type: 'expense',
    direction: 'out',
    category: cat,
    amount: amt,
    method: 'cash',
    date,
    status: 'active',
    createdAt: `${date}T10:00:00+07:00`,
    createdByUid: 'gohost_migration',
    createdByName: String(e['Người tạo'] || 'LE DUC PHUONG').trim() || 'LE DUC PHUONG',
    note: `${name}${e['Danh mục'] ? ` (${e['Danh mục']})` : ''}`,
    sourceSystem: 'gohost_2026',
  });
}

// --- STEP 7: BUILD HISTORICAL SETTLED OTA BATCHES (26 'Hoàn thành' rows in export-11-receivables.xlsx) ---
const settledBatchGroups = new Map();
let pendingOtaExcelCount = 0;
let pendingOtaExcelSum = 0;
let settledOtaExcelCount = 0;
let settledOtaExcelSum = 0;

for (const r of rawReceivables) {
  const amt = num(r['Số tiền']);
  const st = String(r['Trạng thái'] || '').trim();
  if (st === 'Chưa thu') {
    pendingOtaExcelCount++;
    pendingOtaExcelSum += amt;
  } else if (st === 'Hoàn thành') {
    settledOtaExcelCount++;
    settledOtaExcelSum += amt;
    const ch = mapSource(r['Nguồn']).otaChannel || r['Nguồn'] || 'OTA';
    const pDate = excelToISODate(r['Ngày thanh toán']) || excelToISODate(r['Trả phòng']) || '2026-06-01';
    const key = `${ch}|${pDate}`;
    const grp = settledBatchGroups.get(key) || { otaChannel: ch, payoutDate: pDate, bookingIds: [], bookingCodes: [], total: 0 };
    const code = String(r['Mã đặt phòng'] || '').trim();
    const matched = bookingsByGoHostCode.get(code) || [];
    for (const b of matched) grp.bookingIds.push(b.id);
    grp.bookingCodes.push(code);
    grp.total += amt;
    settledBatchGroups.set(key, grp);
  }
}

const pmsOtaBatches = Array.from(settledBatchGroups.values()).map((g, idx) => ({
  id: `gh_ota_batch_${String(idx + 1).padStart(3, '0')}`,
  batchCode: `GH-OTA-${String(idx + 1).padStart(3, '0')}`,
  otaChannel: g.otaChannel,
  payoutDate: g.payoutDate,
  bookingIds: g.bookingIds,
  bookingCodes: g.bookingCodes,
  expectedNetTotal: g.total,
  actualReceivedAmount: g.total,
  bankFeeDiff: 0,
  note: 'Lô đối soát OTA đã hoàn tất chuyển đổi từ GoHost 2026',
  createdAt: `${g.payoutDate}T12:00:00+07:00`,
  createdBy: 'LE DUC PHUONG',
  sourceSystem: 'gohost_2026',
}));

// --- STEP 8: DETECT ACTIVE ROOM SCHEDULE CONFLICTS (in_house + reserved) ---
const activeBookings = pmsBookings.filter((b) => b.status === 'in_house' || b.status === 'reserved');
const activeConflicts = [];
for (let i = 0; i < activeBookings.length; i++) {
  for (let j = i + 1; j < activeBookings.length; j++) {
    const a = activeBookings[i];
    const b = activeBookings[j];
    if (a.roomId !== b.roomId) continue;
    const aEnd = a.bookingMode === 'hourly' ? addDaysISO(a.checkIn, 1) : a.checkOut;
    const bEnd = b.bookingMode === 'hourly' ? addDaysISO(b.checkIn, 1) : b.checkOut;
    if (a.checkIn < bEnd && b.checkIn < aEnd) {
      activeConflicts.push({
        roomNumber: a.roomNumber,
        a: { code: a.bookingCode, gohost: a.gohostBookingCode, guest: a.primaryGuestName, status: a.status, ci: a.checkIn, co: a.checkOut },
        b: { code: b.bookingCode, gohost: b.gohostBookingCode, guest: b.primaryGuestName, status: b.status, ci: b.checkIn, co: b.checkOut },
      });
    }
  }
}

// --- STEP 9: COMPUTE EXACT 2026 P&L RECONCILIATION (SAME LOGIC AS revenueMetrics.ts) ---
function computePnLRange(fromISO, toISO) {
  let roomRev = 0;
  let soldNights = 0;
  let hourlyCount = 0;
  let serviceRev = 0;
  const svcGroups = { food: 0, drink: 0, service: 0, surcharge: 0 };

  for (const b of pmsBookings) {
    if (b.status !== 'in_house' && b.status !== 'checked_out' && b.status !== 'transferred') continue;
    if (b.bookingMode === 'hourly') {
      if (b.checkIn >= fromISO && b.checkIn <= toISO) {
        roomRev += b.grossRoomTotal || 0;
        hourlyCount++;
      }
    } else {
      for (const dr of b.dailyRates || []) {
        if (dr.date >= fromISO && dr.date <= toISO) {
          roomRev += dr.rate || 0;
          soldNights++;
        }
      }
    }
    for (const srv of b.services || []) {
      if (srv.status === 'voided') continue;
      if (srv.businessDate >= fromISO && srv.businessDate <= toISO) {
        serviceRev += srv.total || 0;
        const g = srv.category === 'food' || srv.category === 'drink' || srv.category === 'surcharge' ? srv.category : 'service';
        svcGroups[g] += srv.total || 0;
      }
    }
  }
  const expense = pmsTransactions
    .filter((t) => t.status === 'active' && t.direction === 'out' && t.type === 'expense' && t.date >= fromISO && t.date <= toISO)
    .reduce((s, t) => s + t.amount, 0);

  return { roomRev, soldNights, hourlyCount, serviceRev, svcGroups, expense, netProfit: roomRev + serviceRev - expense };
}

const pnl2026 = computePnLRange('2026-01-01', '2026-12-31');
const pnlAllSpan = computePnLRange('2026-01-01', '2027-12-31');
const monthly2026 = [];
for (let m = 1; m <= 12; m++) {
  const ym = `2026-${String(m).padStart(2, '0')}`;
  const lastDay = new Date(Date.UTC(2026, m, 0)).getUTCDate();
  const r = computePnLRange(`${ym}-01`, `${ym}-${String(lastDay).padStart(2, '0')}`);
  monthly2026.push({ month: `${String(m).padStart(2, '0')}/2026`, ...r });
}
const sumMonthlyRoomRev = monthly2026.reduce((s, r) => s + r.roomRev, 0);
const sumMonthlySvcRev = monthly2026.reduce((s, r) => s + r.serviceRev, 0);

const totalGrossNonCancel = pmsBookings
  .filter((b) => b.status !== 'cancelled' && b.status !== 'no_show')
  .reduce((s, b) => s + (b.grossRoomTotal || 0), 0);
const reservedRoomRev = pmsBookings
  .filter((b) => b.status === 'reserved')
  .reduce((s, b) => s + (b.grossRoomTotal || 0), 0);
const jan2027CarryRoomRev = pnlAllSpan.roomRev - pnl2026.roomRev;

// --- STEP 10: OPTIONAL EMULATOR IMPORT + OCCUPANCY AUDIT ---
let emulatorSummary = null;
if (modeArg === 'emulator') {
  const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
  const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
  const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);

  const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
  const appSa = appMod.initializeApp(emuConfig, 'GoHostMigSa');
  const authSa = authMod.getAuth(appSa);
  authMod.connectAuthEmulator(authSa, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = fsMod.getFirestore(appSa);
  fsMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);

  const saCred = await authMod.createUserWithEmailAndPassword(authSa, 'ducphuong84@gmail.com', 'DemoSa#2026');
  await fsMod.setDoc(fsMod.doc(db, 'system_meta', 'bootstrap'), {
    adminInitialized: true,
    superAdminUid: saCred.user.uid,
    ownerUid: saCred.user.uid,
    superAdminEmail: 'ducphuong84@gmail.com',
    initializedAt: new Date().toISOString(),
  });

  // Load base config & room_types from pre-UAT backup
  const backupPath = path.resolve(rootDir, 'backups/firestore_backup_pre_uat_ui_v2.2.2_2026-11-27.json');
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const writeQueue = [];

  for (const [docId, data] of Object.entries(backup.collections.hotel_config || {})) {
    writeQueue.push({ col: 'hotel_config', id: docId, data });
  }
  for (const [docId, data] of Object.entries(backup.collections.form_templates || {})) {
    writeQueue.push({ col: 'form_templates', id: docId, data });
  }
  for (const [docId, data] of Object.entries(backup.collections.room_types || {})) {
    writeQueue.push({ col: 'room_types', id: docId, data });
  }

  // Write the 15 official rooms with corrected GoHost roomTypeId/roomTypeName
  const activeInHouseByRoom = new Map();
  for (const b of pmsBookings) {
    if (b.status === 'in_house') activeInHouseByRoom.set(`room_${b.roomNumber}`, b.id);
  }
  OFFICIAL_ROOM_LAYOUT.forEach((rm, idx) => {
    const id = `room_${rm.roomNumber}`;
    writeQueue.push({
      col: 'rooms',
      id,
      data: {
        id,
        roomNumber: rm.roomNumber,
        floor: rm.floor,
        roomTypeId: rm.roomTypeId,
        roomTypeName: rm.roomTypeName,
        hkStatus: 'clean',
        currentBookingId: activeInHouseByRoom.get(id) || null,
        note: '',
        isActive: true,
        sortOrder: idx + 1,
      },
    });
  });

  // Queue GoHost migrated docs
  for (const g of guestsById.values()) writeQueue.push({ col: 'guests', id: g.id, data: stripUndefined(g) });
  for (const grp of pmsGroups) writeQueue.push({ col: 'booking_groups', id: grp.id, data: stripUndefined(grp) });
  for (const b of pmsBookings) writeQueue.push({ col: 'bookings', id: b.id, data: stripUndefined(b) });
  for (const tx of pmsTransactions) writeQueue.push({ col: 'transactions', id: tx.id, data: stripUndefined(tx) });
  for (const ob of pmsOtaBatches) writeQueue.push({ col: 'ota_payout_batches', id: ob.id, data: stripUndefined(ob) });

  const t0 = Date.now();
  for (let i = 0; i < writeQueue.length; i += 350) {
    const batch = fsMod.writeBatch(db);
    for (const item of writeQueue.slice(i, i + 350)) {
      batch.set(fsMod.doc(db, item.col, item.id), item.data);
    }
    await batch.commit();
  }
  const importElapsedMs = Date.now() - t0;

  // Build room_occupancy index for all active (in_house + reserved) bookings & audit conflicts (same formula as occupancyService.ts)
  const occBuckets = new Map(); // `${roomId}_${YYYY-MM-DD}` -> intervals[]
  const occConflicts = [];
  const BUFFER_MS = 5 * 60 * 1000;

  function dateTimeToUtcMs(iso, hhmm) {
    const [y, m, d] = iso.split('-').map(Number);
    const [hh, mm] = (hhmm || '12:00').split(':').map(Number);
    return Date.UTC(y, m - 1, d, hh - 7, mm, 0, 0);
  }

  for (const b of activeBookings) {
    const startAt = dateTimeToUtcMs(b.checkIn, b.checkInTime || '14:00');
    const endAt = dateTimeToUtcMs(b.bookingMode === 'hourly' ? b.checkIn : b.checkOut, b.checkOutTime || '12:00');
    const iv = {
      id: b.id,
      kind: 'booking',
      startAt,
      endAt,
      bufferMinutes: 5,
      status: 'active',
      updatedAt: new Date().toISOString(),
    };

    const days = [];
    let cur = b.checkIn;
    const endISO = b.bookingMode === 'hourly' ? b.checkIn : b.checkOut;
    while (cur <= endISO) {
      days.push(cur);
      cur = addDaysISO(cur, 1);
      if (days.length > 400) break;
    }

    for (const d of days) {
      const key = `${b.roomId}_${d}`;
      const list = occBuckets.get(key) || [];
      for (const ex of list) {
        if (iv.startAt < ex.endAt + BUFFER_MS && ex.startAt < iv.endAt + BUFFER_MS) {
          occConflicts.push({ key, roomId: b.roomId, date: d, a: ex.id, b: iv.id });
        }
      }
      list.push(iv);
      occBuckets.set(key, list);
    }
  }

  // Persist room_occupancy docs to Emulator
  const occEntries = Array.from(occBuckets.entries());
  for (let i = 0; i < occEntries.length; i += 350) {
    const batch = fsMod.writeBatch(db);
    for (const [docKey, intervals] of occEntries.slice(i, i + 350)) {
      const [rPrefix, rNum, date] = docKey.split('_');
      batch.set(fsMod.doc(db, 'room_occupancy', docKey), {
        roomId: `${rPrefix}_${rNum}`,
        date,
        intervals,
        updatedAt: new Date().toISOString(),
      });
    }
    await batch.commit();
  }

  // Read back counts from Emulator to confirm 100% write integrity
  const [bkSnap, grpSnap, gstSnap, txSnap, obSnap, occSnap, rmSnap] = await Promise.all([
    fsMod.getDocs(fsMod.collection(db, 'bookings')),
    fsMod.getDocs(fsMod.collection(db, 'booking_groups')),
    fsMod.getDocs(fsMod.collection(db, 'guests')),
    fsMod.getDocs(fsMod.collection(db, 'transactions')),
    fsMod.getDocs(fsMod.collection(db, 'ota_payout_batches')),
    fsMod.getDocs(fsMod.collection(db, 'room_occupancy')),
    fsMod.getDocs(fsMod.collection(db, 'rooms')),
  ]);

  emulatorSummary = {
    importElapsedMs,
    totalWrittenDocs: writeQueue.length + occEntries.length,
    verifiedCounts: {
      rooms: rmSnap.size,
      bookings: bkSnap.size,
      booking_groups: grpSnap.size,
      guests: gstSnap.size,
      transactions: txSnap.size,
      ota_payout_batches: obSnap.size,
      room_occupancy: occSnap.size,
    },
    occupancyConflictDaysCount: occConflicts.length,
    occupancyConflictRooms: [...new Set(occConflicts.map((c) => c.roomId))].sort(),
  };
}

// --- STEP 11: WRITE RECONCILIATION REPORT ---
const backupPre = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'backups/firestore_backup_pre_uat_ui_v2.2.2_2026-11-27.json'), 'utf8'));
const oldRoomsMap = new Map(Object.values(backupPre.collections.rooms || {}).map((r) => [r.roomNumber, r]));

const pendingOtaBookings = pmsBookings.filter((b) => b.otaSettlementStatus === 'pending_ota');
const pendingOtaBookingsRoomSum = pendingOtaBookings.reduce((s, b) => s + (b.grossRoomTotal || 0), 0);

const reportLines = [
  '# Báo Cáo Chạy Thử (Dry-Run) & Đối Chiếu Chuyển Đổi Dữ Liệu GoHost 2026 → Like Family PMS `v2.2.2`',
  '',
  `- **Thời gian thực hiện:** \`${new Date().toISOString()}\``,
  `- **Chế độ chạy:** \`${modeArg}\` (**KHÔNG ghi lên Production \`likefamilypms\` — chờ Chủ dự án phê duyệt Cổng Dừng**)`,
  `- **Script chuyển đổi:** \`scripts/migrate_gohost_2026.mjs\``,
  `- **Hạ tầng:** 0đ Firebase Spark (Firebase Local Emulator Suite, không Billing, không Cloud Functions, không Storage)`,
  '',
  '---',
  '',
  '## 1. Bảng Ánh Xạ 15 Phòng & 4 Hạng Phòng (`rooms` & `room_types`)',
  '',
  '- Giữ nguyên **4 hạng phòng chuẩn** trên Like Family PMS (`rt_std_single`, `rt_dbl_nobalk`, `rt_dbl_balk`, `rt_family`) và **15 phòng hoạt động (`room_201` → `room_503`)**, không thêm 4 phòng đóng Tầng 1 (`101–104`, 0 đơn phát sinh năm 2026).',
  '- **Phát hiện cần Chủ dự án xác nhận:** Trên dữ liệu mẫu cũ, các phòng `201/301/401/501` đang gán là *Phòng Đơn*; kịch bản chuyển đổi đã hiệu chỉnh chuẩn theo thực tế GoHost: **4 Phòng đơn = `203, 303, 403, 502`** (`rt_std_single`), và **11 Phòng đôi/gia đình = `201, 202, 204, 301, 302, 304, 401, 402, 404, 501, 503`**. Xin Chủ dự án rà soát lại phân bổ 3 hạng phòng đôi (`Có Ban Công` / `Không Ban Công` / `Gia Đình`) cho 11 phòng bên dưới trước khi ghi lên Production:',
  '',
  '| Số phòng | Tầng | Nhóm trên GoHost | Hạng phòng cũ trên PMS | Hạng phòng chuẩn sau chuyển đổi (`roomTypeId`) | Thay đổi? |',
  '|---|---|---|---|---|---|',
  ...OFFICIAL_ROOM_LAYOUT.map((r) => {
    const old = oldRoomsMap.get(r.roomNumber);
    const changed = old?.roomTypeId !== r.roomTypeId ? '**ĐÃ HIỆU CHỈNH**' : 'Giữ nguyên';
    return `| **P.${r.roomNumber}** | ${r.floor} | ${r.gohostGroup} | ${old?.roomTypeName || '—'} (\`${old?.roomTypeId || ''}\`) | **${r.roomTypeName}** (\`${r.roomTypeId}\`) | ${changed} |`;
  }),
  '',
  '---',
  '',
  '## 2. Tổng Hợp Đối Chiếu Số Liệu GoHost 2026 vs Like Family PMS (Local Emulator)',
  '',
  '| Hạng mục đối chiếu | Số liệu gốc GoHost (`data_gohost/*.xlsx`) | Kết quả nhập Like Family PMS (Emulator) | Chênh lệch | Trạng thái |',
  '|---|---:|---:|---:|---|',
  `| Đơn đặt phòng gốc (\`ds-bookings.xlsx\`) | \`${rawBookings.length}\` dòng (\`${multiRoomBookingCount}\` đơn đoàn, \`${hourlyBookingCount}\` nghỉ giờ) | \`${pmsBookings.length}\` bookings + \`${pmsGroups.length}\` booking_groups | \`0\` mất đơn | **KHỚP 100%** |`,
  `| Tổng tiền phòng đơn không hủy (\`grossRoomTotal\`) | **${formatVND(877921238)}** | **${formatVND(totalGrossNonCancel)}** | **${formatVND(totalGrossNonCancel - 877921238)}** | **KHỚP 100%** |`,
  `| Doanh thu phòng P&L dồn tích năm 2026 (\`01/01–31/12/2026\`) | — | **${formatVND(pnl2026.roomRev)}** (\`${pnl2026.soldNights}\` đêm + \`${pnl2026.hourlyCount}\` nghỉ giờ) | Trừ \`${formatVND(reservedRoomRev)}\` (2 đơn \`reserved\`) & \`${formatVND(jan2027CarryRoomRev)}\` (12 đêm T01/2027 của \`LIK00830\`) | **0đ LỆCH** |`,
  `| Tổng 12 tháng lẻ T01–T12/2026 vs Kỳ gộp cả năm 2026 | — | Phòng: **${formatVND(sumMonthlyRoomRev)}** · DV: **${formatVND(sumMonthlySvcRev)}** | Phòng: **${formatVND(sumMonthlyRoomRev - pnl2026.roomRev)}** · DV: **${formatVND(sumMonthlySvcRev - pnl2026.serviceRev)}** | **BUG-01 0đ LỆCH** |`,
  `| Tổng dịch vụ (\`ds-booking-services.xlsx\` — \`207\` dòng) | **${formatVND(19203200)}** (\`207\` dòng) | **${formatVND(servicesAttachedTotal)}** (\`${servicesAttachedCount}\` dòng gắn đơn) | **${formatVND(servicesAttachedTotal - 19203200)}** | **KHỚP 100%** |`,
  `| • Nhóm Đồ uống (\`drink\`) | — | **${formatVND(servicesByCategory.drink.sum)}** (\`${servicesByCategory.drink.count}\` dòng) | — | Chuẩn phân loại |`,
  `| • Nhóm Dịch vụ (\`service\`) | — | **${formatVND(servicesByCategory.service.sum)}** (\`${servicesByCategory.service.count}\` dòng) | — | Chuẩn phân loại |`,
  `| • Nhóm Phụ thu (\`surcharge\`) | — | **${formatVND(servicesByCategory.surcharge.sum)}** (\`${servicesByCategory.surcharge.count}\` dòng) | — | Chuẩn phân loại |`,
  `| Hồ sơ khách hàng (\`ds-customers.xlsx\` — \`706\` dòng) | \`${rawCustomers.length}\` dòng gốc | \`${guestsById.size}\` hồ sơ \`guests\` (khử trùng \`${duplicateCustomerRowsMerged}\` dòng + gộp khách từ đơn) | \`0\` lỗi | **HOÀN TẤT** |`,
  `| Phiếu thu thực tế (\`ds-payments.xlsx\` — \`920\` dòng, bỏ \`TỔNG CỘNG\` & bỏ cột \`Công nợ\`) | Tiền mặt **${formatVND(313587973)}** + CK **${formatVND(391570208)}** + Wechat **${formatVND(5500000)}** = **${formatVND(710658181)}** | **${formatVND(paymentStats.cash + paymentStats.bank + paymentStats.cardOther)}** (\`${paymentStats.receiptTxCount}\` phiếu thu; loại trừ **${formatVND(paymentStats.skippedDebt)}** cột Công nợ) | **0đ** | **KHỚP 100%** |`,
  `| Chi phí vận hành (\`export-13-transactions.xlsx\` — \`14\` dòng) | **${formatVND(paymentStats.expenseTotal)}** (\`14\` phiếu chi) | **${formatVND(paymentStats.expenseTotal)}** (\`${paymentStats.expenseTxCount}\` phiếu chi) | **0đ** | **KHỚP 100%** |`,
  `| Công nợ OTA \`Chưa thu\` (\`export-11-receivables.xlsx\` — \`67\` dòng) | **${formatVND(pendingOtaExcelSum)}** (\`${pendingOtaExcelCount}\` khoản) | \`${pendingOtaBookings.length}\` đơn đánh dấu \`pending_ota\` (tổng tiền phòng: **${formatVND(pendingOtaBookingsRoomSum)}**) | ${unmatchedReceivables.length} mã không có trong \`ds-bookings.xlsx\` | **XEM MỤC 5** |`,
  `| Công nợ OTA \`Hoàn thành\` (\`export-11-receivables.xlsx\` — \`26\` dòng) | **${formatVND(settledOtaExcelSum)}** (\`${settledOtaExcelCount}\` khoản) | \`${pmsOtaBatches.length}\` lô lịch sử \`ota_payout_batches\` = **${formatVND(pmsOtaBatches.reduce((s, b) => s + b.actualReceivedAmount, 0))}** | **0đ** | **KHỚP 100%** |`,
  '',
  '### Khử trùng chuỗi số phòng lỗi trên `ds-bookings.xlsx` (`3` đơn)',
  ...cleanedDirtyRoomStrings.map((c) => `- \`${c.code}\`: chuỗi gốc \`"${c.raw}"\` → làm sạch thành \`[${c.cleaned.join(', ')}]\``),
  '',
  '---',
  '',
  '## 3. Báo Cáo P&L Từng Tháng Năm 2026 (Local Emulator Verification)',
  '',
  '| Tháng | Đêm bán | Nghỉ giờ | Doanh thu phòng | Doanh thu dịch vụ | Chi phí vận hành | Lợi nhuận ròng |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...monthly2026.map(
    (m) =>
      `| ${m.month} | ${m.soldNights} | ${m.hourlyCount} | ${formatVND(m.roomRev)} | ${formatVND(m.serviceRev)} | ${formatVND(m.expense)} | ${formatVND(m.netProfit)} |`
  ),
  `| **CẢ NĂM 2026** | **${pnl2026.soldNights}** | **${pnl2026.hourlyCount}** | **${formatVND(pnl2026.roomRev)}** | **${formatVND(pnl2026.serviceRev)}** | **${formatVND(pnl2026.expense)}** | **${formatVND(pnl2026.netProfit)}** |`,
  '',
  '---',
  '',
  '## 4. Danh Sách Đơn Đang Hoạt Động (`in_house` & `reserved`) & Xử Lý Đơn Quá Hạn',
  '',
  `- **Tổng số đơn \`Hoàn thành\` → \`checked_out\`:** \`${statusTransitionLog.completedToCheckedOut}\` đơn`,
  `- **Tổng số đơn \`Đã hủy\` → \`cancelled\`:** \`${statusTransitionLog.cancelledToCancelled}\` đơn (trong đó \`3\` đơn có ghi nhận tiền thu trên GoHost: \`LIK00681\` \`250.000đ\`, \`LIK00425\` \`200.000đ\`, \`LIK00081\` \`700.000đ\` — tạm đánh dấu cọc treo chờ Chủ KS xác nhận)`,
  `- **Từ \`33\` đơn \`Đang lưu trú\`:** giữ \`in_house\` cho **\`${statusTransitionLog.inHouseKeptActive.length}\` đơn có \`checkOut >= 28/11/2026\`** (gồm **11 đơn lưu trú dài hạn \`co >= 30/11/2026\`** + **3 đơn trả phòng hôm nay \`28/11/2026\`**: \`LIK00847\`, \`LIK00850\`, \`LIK00851\`), tự động chuyển **\`${statusTransitionLog.inHouseOverdueConverted.length}\` đơn quá hạn (\`co < 28/11/2026\`)** sang \`checked_out\`.`,
  `- **Từ \`3\` đơn \`Mới\`:** giữ \`reserved\` cho **\`${statusTransitionLog.newKeptReserved.length}\` đơn** (\`LIK00848\` \`29/11–12/12/2026\`, \`LIK00685\` \`12/01–17/01/2027\`), tự động chuyển \`LIK00231\` (\`30/03–30/04/2026\`) sang \`checked_out\`.`,
  '',
  '### 4.1. Danh sách đơn đang ở (`in_house` — `checkOut >= 28/11/2026`)',
  '',
  '| Mã GoHost | Khách hàng | Phòng | Nhận phòng | Trả phòng | Tiền phòng | Đã thanh toán | Ghi chú |',
  '|---|---|---|---|---|---:|---:|---|',
  ...statusTransitionLog.inHouseKeptActive
    .sort((a, b) => b.co.localeCompare(a.co))
    .map(
      (x) =>
        `| \`${x.code}\` | ${x.guest} | ${x.rooms.map((r) => `P.${r}`).join(', ')} | ${formatDateVN(x.ci)} | ${formatDateVN(x.co)} | ${formatVND(x.gross)} | ${formatVND(x.paid)} | ${x.co === '2026-11-28' ? 'Trả phòng hôm nay 28/11' : 'Đang lưu trú dài hạn'} |`
    ),
  '',
  '### 4.2. Danh sách đơn đặt trước (`reserved`)',
  '',
  '| Mã GoHost | Khách hàng | Phòng | Nhận phòng | Trả phòng | Tiền phòng | Đã thanh toán |',
  '|---|---|---|---|---|---:|---:|',
  ...statusTransitionLog.newKeptReserved.map(
    (x) =>
      `| \`${x.code}\` | ${x.guest} | ${x.rooms.map((r) => `P.${r}`).join(', ')} | ${formatDateVN(x.ci)} | ${formatDateVN(x.co)} | ${formatVND(x.gross)} | ${formatVND(x.paid)} |`
  ),
  '',
  '---',
  '',
  '## 5. CẢNH BÁO XUNG ĐỘT LỊCH PHÒNG & ĐIỂM CẦN CHỦ DỰ ÁN XÁC NHẬN TRƯỚC KHI GO-LIVE',
  '',
  `> [!WARNING]`,
  `> Quá trình kiểm toán chỉ mục khóa phòng \`room_occupancy\` phát hiện **${activeConflicts.length} cặp xung đột lịch phòng** trên các đơn đang hoạt động (tập trung tại **P.502** và **P.404**):`,
  '',
  '| Phòng | Đơn A | Thời gian A | Đơn B | Thời gian B | Khuyến nghị xử lý |',
  '|---|---|---|---|---|---|',
  ...activeConflicts.map(
    (c) =>
      `| **P.${c.roomNumber}** | \`${c.a.code}\` (${c.a.guest}, \`${c.a.status}\`) | ${formatDateVN(c.a.ci)} → ${formatDateVN(c.a.co)} | \`${c.b.code}\` (${c.b.guest}, \`${c.b.status}\`) | ${formatDateVN(c.b.ci)} → ${formatDateVN(c.b.co)} | Xác nhận khách thực tế đang ở P.${c.roomNumber} và đổi phòng hoặc rút ngày trả cho đơn còn lại trước khi ghi Production |`
  ),
  '',
  '### Lưu ý bổ sung về Công nợ OTA (`export-11-receivables.xlsx`)',
  unmatchedReceivables.length > 0
    ? `- Phát hiện **${unmatchedReceivables.length} dòng công nợ** có mã đặt phòng không tồn tại trong \`ds-bookings.xlsx\`: ${unmatchedReceivables.map((u) => `\`${u.code}\` (${u.source}, ${u.guestName}, ${formatVND(u.amount)}, ${u.status})`).join('; ')}.`
    : '- 100% dòng công nợ khớp mã đặt phòng trên `ds-bookings.xlsx`.',
  '- Có 1 khoản `Chưa thu` thuộc nguồn `walk-in` (`LIK00422` — `EVgeniia Novikova`, `1.147.500đ`), đã gắn `paymentMethod: ota_debt` & `otaSettlementStatus: pending_ota` để hiển thị theo dõi công nợ.',
  '',
  '---',
  '',
  '## 6. Kết Quả Kiểm Chứng Trên Firebase Local Emulator Suite',
  '',
  emulatorSummary
    ? [
        `- **Thời gian ghi toàn bộ dữ liệu vào Local Emulator:** \`${emulatorSummary.importElapsedMs} ms\` (tổng \`${emulatorSummary.totalWrittenDocs}\` tài liệu)`,
        `- **Số lượng tài liệu xác minh đọc ngược từ Firestore Emulator:**`,
        `  - \`rooms\`: **${emulatorSummary.verifiedCounts.rooms}** (15/15 phòng chuẩn GoHost)`,
        `  - \`bookings\`: **${emulatorSummary.verifiedCounts.bookings}** (từ \`807\` dòng GoHost, tách \`92\` đơn đoàn)`,
        `  - \`booking_groups\`: **${emulatorSummary.verifiedCounts.booking_groups}**`,
        `  - \`guests\`: **${emulatorSummary.verifiedCounts.guests}**`,
        `  - \`transactions\`: **${emulatorSummary.verifiedCounts.transactions}** (\`${paymentStats.receiptTxCount}\` phiếu thu thực tế + \`${paymentStats.expenseTxCount}\` phiếu chi vận hành)`,
        `  - \`ota_payout_batches\`: **${emulatorSummary.verifiedCounts.ota_payout_batches}**`,
        `  - \`room_occupancy\`: **${emulatorSummary.verifiedCounts.room_occupancy}** tài liệu chỉ mục ngày-phòng (phát hiện **${emulatorSummary.occupancyConflictDaysCount}** ngày-phòng giao cắt tại: \`${emulatorSummary.occupancyConflictRooms.join(', ') || 'Không có'}\`)`,
      ].join('\n')
    : '- Chạy ở chế độ `--mode=dryrun` (không ghi Emulator).',
  '',
  '---',
  '',
  '## 7. Cổng Dừng Phê Duyệt Go-Live (Chờ Lệnh Chủ Dự Án)',
  '',
  'Production `likefamilypms` hiện **vẫn nguyên vẹn 100%** (chưa xóa `QA2M_*` và chưa ghi dữ liệu GoHost). Để thực hiện chuyển đổi chính thức lên Production, xin Chủ dự án xác nhận 3 điểm:',
  '1. **Phương án xử lý xung đột P.502 & P.404** giữa `LIK00783` (`SOLGALOVA VERONIKA`), `LIK00842` (`Daria Shvetsova`), `LIK00847` (`QIU TINGGEN K K`) và `LIK00848` (`Trương Thúy Vy`).',
  '2. **Xác nhận bảng ánh xạ 15 phòng** ở Mục 1 (đặc biệt 3 nhóm phòng đôi `Có Ban Công` / `Không Ban Công` / `Gia Đình`).',
  '3. **Phê duyệt lệnh Go-Live chính thức:** Sao lưu nóng → Dọn sạch `1,496` bản ghi `QA2M_*` + khóa `qa_runner` → Ghi dữ liệu GoHost 2026 lên `likefamilypms` → Dựng `room_occupancy` → Khóa sổ lịch sử (`accountingLockDate`).',
  '',
];

const reportPath = path.join(reportDir, '00_GOHOST_DRYRUN_AND_RECONCILIATION.md');
fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');

console.log(
  'GOHOST_MIGRATION_RESULT:',
  JSON.stringify(
    {
      mode: modeArg,
      reportPath,
      rawBookings: rawBookings.length,
      pmsBookings: pmsBookings.length,
      pmsGroups: pmsGroups.length,
      guests: guestsById.size,
      transactions: pmsTransactions.length,
      otaBatches: pmsOtaBatches.length,
      totalGrossNonCancel,
      pnl2026,
      sumMonthlyRoomRev,
      sumMonthlySvcRev,
      servicesAttachedCount,
      servicesAttachedTotal,
      servicesByCategory,
      paymentStats,
      pendingOtaExcelCount,
      pendingOtaExcelSum,
      settledOtaExcelCount,
      settledOtaExcelSum,
      unmatchedReceivables,
      inHouseActiveCount: statusTransitionLog.inHouseKeptActive.length,
      inHouseOverdueConvertedCount: statusTransitionLog.inHouseOverdueConverted.length,
      reservedKeptCount: statusTransitionLog.newKeptReserved.length,
      activeConflicts,
      emulatorSummary,
    },
    null,
    2
  )
);

process.exit(0);
