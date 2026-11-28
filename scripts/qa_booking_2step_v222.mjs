import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/BOOKING_2STEP_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const pwMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);
const { chromium } = pwMod;

const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'Bkg2StepSa');
const appOwn = appMod.initializeApp(emuConfig, 'Bkg2StepOwn');
const authSa = authMod.getAuth(appSa);
const authOwn = authMod.getAuth(appOwn);
authMod.connectAuthEmulator(authSa, 'http://127.0.0.1:9099', { disableWarnings: true });
authMod.connectAuthEmulator(authOwn, 'http://127.0.0.1:9099', { disableWarnings: true });
const dbSa = fsMod.getFirestore(appSa);
fsMod.connectFirestoreEmulator(dbSa, '127.0.0.1', 8080);

const fullPerms = {
  canViewProfit: true,
  canEditPrice: true,
  canUndoAction: true,
  canManageStaff: true,
  canCleanupPhotos: true,
  canFullBackup: true,
  canEditFormTemplates: true,
  canManageConfig: true,
};

const saCred = await authMod.createUserWithEmailAndPassword(authSa, 'ducphuong84@gmail.com', 'DemoSa#2026');
await fsMod.setDoc(fsMod.doc(dbSa, 'system_meta', 'bootstrap'), {
  adminInitialized: true,
  superAdminUid: saCred.user.uid,
  ownerUid: saCred.user.uid,
  superAdminEmail: 'ducphuong84@gmail.com',
  initializedAt: new Date().toISOString(),
});
await fsMod.setDoc(fsMod.doc(dbSa, 'staff_users', saCred.user.uid), {
  uid: saCred.user.uid,
  username: 'ducphuong84',
  email: 'ducphuong84@gmail.com',
  fullName: 'SuperAdmin Gốc',
  phone: '',
  role: 'superadmin',
  authSource: 'firebase_superadmin',
  isActive: true,
  permissions: fullPerms,
  createdAt: new Date().toISOString(),
});
const ownCred = await authMod.createUserWithEmailAndPassword(authOwn, 'owner_emu@likefamilyhotel.com', 'OwnerEmu#2026');
await fsMod.setDoc(fsMod.doc(dbSa, 'staff_users', ownCred.user.uid), {
  uid: ownCred.user.uid,
  username: 'owner_emu',
  email: 'owner_emu@likefamilyhotel.com',
  fullName: 'Chủ Khách Sạn (Emulator)',
  phone: '0900000001',
  role: 'owner',
  authSource: 'firebase_staff',
  isActive: true,
  mustChangePassword: false,
  permissions: fullPerms,
  createdAt: new Date().toISOString(),
});

const backup = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'backups/firestore_backup_pre_golive_2026-11-28.json'), 'utf8'));
for (const col of ['hotel_config', 'form_templates', 'room_types', 'rooms']) {
  for (const [docId, data] of Object.entries(backup.collections[col] || {})) {
    await fsMod.setDoc(fsMod.doc(dbSa, col, docId), data);
  }
}

const addD = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const makeDailyRates = (startOffset, nights, rate) =>
  Array.from({ length: nights }, (_, i) => ({ date: addD(startOffset + i), rate }));

const nowIso = new Date().toISOString();

// Seed guests
await fsMod.setDoc(fsMod.doc(dbSa, 'guests', 'g_qiu'), {
  id: 'g_qiu',
  guestCategory: 'foreigner',
  fullName: 'QIU TINGGEN',
  normalizedName: 'qiu tinggen',
  phone: '0912345678',
  normalizedPhone: '0912345678',
  gender: 'Nam',
  dob: '1990-05-12',
  nationality: 'CN',
  idType: 'visa_passport',
  idNumber: 'E12345678',
  totalStays: 1,
  totalSpent: 2200000,
  createdAt: nowIso,
  updatedAt: nowIso,
});

await fsMod.setDoc(fsMod.doc(dbSa, 'guests', 'g_vy'), {
  id: 'g_vy',
  guestCategory: 'vietnamese',
  fullName: 'Trương Thúy Vy',
  normalizedName: 'truong thuy vy',
  phone: '0908889999',
  normalizedPhone: '0908889999',
  gender: 'Nữ',
  dob: '1988-09-20',
  nationality: 'VN',
  idType: 'cccd',
  idNumber: '079188001234',
  totalStays: 1,
  totalSpent: 15000000,
  createdAt: nowIso,
  updatedAt: nowIso,
});

// Seed booking_group for LIK00848
await fsMod.setDoc(fsMod.doc(dbSa, 'booking_groups', 'grp_lik00848'), {
  id: 'grp_lik00848',
  groupCode: 'LIK00848',
  groupName: 'Đoàn Trương Thúy Vy',
  leaderGuestId: 'g_vy',
  leaderName: 'Trương Thúy Vy',
  leaderPhone: '0908889999',
  depositAmount: 1000000,
  billingMode: 'master',
  status: 'active',
  note: 'Khách yêu cầu nhận phòng sớm nếu có phòng trống',
  createdAt: nowIso,
  createdBy: 'owner_emu',
});

// Single room booking LIK00847 (P.404, in_house)
await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', 'bkg_lik00847'), {
  id: 'bkg_lik00847',
  bookingCode: 'LIK00847',
  bookingMode: 'daily',
  checkIn: addD(-1),
  checkOut: addD(3),
  nights: 4,
  primaryGuestId: 'g_qiu',
  primaryGuestName: 'QIU TINGGEN',
  primaryGuestNormalizedName: 'qiu tinggen',
  primaryGuestPhone: '0912345678',
  primaryGuestIdNumber: 'E12345678',
  occupants: [
    {
      occupantId: 'occ_qiu',
      guestId: 'g_qiu',
      guestCategory: 'foreigner',
      fullName: 'QIU TINGGEN',
      phone: '0912345678',
      gender: 'Nam',
      dob: '1990-05-12',
      nationality: 'CN',
      idType: 'visa_passport',
      idNumber: 'E12345678',
      asmStatus: 'pending_asm',
      isPrimary: true,
    },
  ],
  occupantCount: 2,
  hasForeigner: true,
  hasPendingAsm: true,
  hasStayPermitAlert: false,
  isReturningGuest: false,
  source: 'ota',
  otaChannel: 'Trip.com',
  roomId: 'room_404',
  roomNumber: '404',
  floor: '4',
  roomTypeId: 'rt_dbl_balk',
  roomTypeName: 'Phòng Đôi',
  dailyRates: makeDailyRates(-1, 4, 550000),
  grossRoomTotal: 2200000,
  otaCommissionAmount: 0,
  netRoomTotal: 2200000,
  serviceTotal: 0,
  services: [],
  hourlySurcharge: 0,
  depositPaid: 0,
  guestPaid: 1000000,
  paymentMethod: 'bank_transfer',
  otaSettlementStatus: 'not_applicable',
  status: 'in_house',
  note: 'Khách cần hóa đơn VAT',
  createdAt: nowIso,
  updatedAt: nowIso,
  createdBy: 'owner_emu',
});

// Multi-room group LIK00848 (4 rooms: 202, 302, 304, 502)
const groupRooms = [
  { id: 'bkg_lik00848_202', code: 'LIK00848-202', roomId: 'room_202', rn: '202', floor: '2', rtName: 'Phòng Đôi', ciOff: 1, coOff: 5, nights: 4, rate: 500000, dep: 1000000 },
  { id: 'bkg_lik00848_302', code: 'LIK00848-302', roomId: 'room_302', rn: '302', floor: '3', rtName: 'Phòng Đôi', ciOff: 1, coOff: 5, nights: 4, rate: 500000, dep: 0 },
  { id: 'bkg_lik00848_304', code: 'LIK00848-304', roomId: 'room_304', rn: '304', floor: '3', rtName: 'Phòng Đôi', ciOff: 2, coOff: 5, nights: 3, rate: 500000, dep: 0 },
  { id: 'bkg_lik00848_502', code: 'LIK00848-502', roomId: 'room_502', rn: '502', floor: '5', rtName: 'Phòng Đơn', ciOff: 2, coOff: 5, nights: 3, rate: 400000, dep: 0 },
];

for (const r of groupRooms) {
  const gross = r.nights * r.rate;
  await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', r.id), {
    id: r.id,
    bookingCode: r.code,
    bookingMode: 'daily',
    groupId: 'grp_lik00848',
    groupName: 'Đoàn Trương Thúy Vy',
    checkIn: addD(r.ciOff),
    checkOut: addD(r.coOff),
    nights: r.nights,
    primaryGuestId: 'g_vy',
    primaryGuestName: 'Trương Thúy Vy',
    primaryGuestNormalizedName: 'truong thuy vy',
    primaryGuestPhone: '0908889999',
    primaryGuestIdNumber: '079188001234',
    occupants: [
      {
        occupantId: `occ_${r.rn}`,
        guestId: 'g_vy',
        guestCategory: 'vietnamese',
        fullName: 'Trương Thúy Vy',
        phone: '0908889999',
        gender: 'Nữ',
        dob: '1988-09-20',
        nationality: 'VN',
        idType: 'cccd',
        idNumber: '079188001234',
        asmStatus: 'not_applicable',
        isPrimary: true,
      },
    ],
    occupantCount: 2,
    hasForeigner: false,
    hasPendingAsm: false,
    hasStayPermitAlert: false,
    isReturningGuest: false,
    source: 'group',
    otaChannel: null,
    roomId: r.roomId,
    roomNumber: r.rn,
    floor: r.floor,
    roomTypeId: 'rt_dbl_balk',
    roomTypeName: r.rtName,
    dailyRates: makeDailyRates(r.ciOff, r.nights, r.rate),
    grossRoomTotal: gross,
    otaCommissionAmount: 0,
    netRoomTotal: gross,
    serviceTotal: 0,
    services: [],
    hourlySurcharge: 0,
    depositPaid: r.dep,
    guestPaid: 0,
    paymentMethod: 'bank_transfer',
    otaSettlementStatus: 'not_applicable',
    status: 'reserved',
    note: 'Đoàn gia đình 4 phòng, xếp gần nhau',
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: 'owner_emu',
  });
}

const PORT = 4183;
const viteProc = spawn(
  process.execPath,
  [path.resolve(rootDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  {
    cwd: rootDir,
    env: { ...process.env, VITE_USE_FIREBASE_EMULATOR: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let ready = false;
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  viteProc.kill();
  throw new Error('Vite dev server failed to start');
}

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const consoleErrors = [];
const pageErrors = [];
const results = {};

try {
  // === 1. MOBILE 390x844 ===
  const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mPage = await mCtx.newPage();
  mPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[M] ${m.text()}`); });
  mPage.on('pageerror', (e) => pageErrors.push(`[M] ${e.message}`));

  await mPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await mPage.waitForSelector('input[type="password"]', { timeout: 20000 });
  await mPage.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('owner_emu');
  await mPage.locator('input[type="password"]').first().fill('OwnerEmu#2026');
  await mPage.locator('button[type="submit"]').first().click();
  await mPage.waitForSelector('header h1', { timeout: 20000 });
  await mPage.waitForTimeout(800);

  // Navigate to Calendar
  await mPage.locator('header button:visible').first().click();
  await mPage.waitForTimeout(300);
  await mPage.locator('div.fixed button:visible').filter({ hasText: 'Lịch Calendar' }).first().click();
  await mPage.waitForSelector('[data-testid="calendar-booking-bar-LIK00847"]', { timeout: 10000 });
  await mPage.waitForTimeout(500);

  // Step 1A: Single room booking LIK00847
  await mPage.locator('[data-testid="calendar-booking-bar-LIK00847"]').click();
  await mPage.waitForSelector('[data-testid="calendar-quick-preview-sheet"]', { timeout: 8000 });
  await mPage.waitForTimeout(300);
  const singleSheetText = await mPage.locator('[data-testid="calendar-quick-preview-sheet"]').innerText();
  const singleFinCols = await mPage.locator('[data-testid="quick-preview-finance"] > div').count();
  await mPage.screenshot({ path: path.join(outDir, 'mobile_quick_preview_single.png'), fullPage: false });

  // Open Khác menu
  await mPage.locator('[data-testid="quick-preview-more-btn"]').click();
  await mPage.waitForSelector('[data-testid="quick-preview-more-menu"]', { timeout: 5000 });
  await mPage.locator('[data-testid="quick-preview-more-btn"]').click();
  await mPage.waitForTimeout(200);

  // Android Back Layer 1: close Quick Preview Sheet
  await mPage.evaluate(() => window.history.back());
  await mPage.waitForTimeout(400);
  const singleClosedByBack = (await mPage.locator('[data-testid="calendar-quick-preview-sheet"]').count()) === 0;

  // Step 1B: Multi-room group LIK00848 (click room 202 bar)
  await mPage.locator('[data-testid="calendar-booking-bar-LIK00848-202"]').click();
  await mPage.waitForSelector('[data-testid="calendar-quick-preview-sheet"]', { timeout: 8000 });
  await mPage.waitForTimeout(300);
  const groupSheetText = await mPage.locator('[data-testid="calendar-quick-preview-sheet"]').innerText();
  await mPage.screenshot({ path: path.join(outDir, 'mobile_quick_preview_group.png'), fullPage: false });

  // Step 2: Click "Xem chi tiết >" -> open BookingDetailModal
  await mPage.locator('[data-testid="quick-preview-detail-btn"]').click();
  await mPage.waitForSelector('[data-testid="booking-detail-modal"]', { timeout: 8000 });
  await mPage.waitForTimeout(400);

  const mobileDetailMetrics = await mPage.evaluate(() => {
    const modal = document.querySelector('[data-testid="booking-detail-modal"]');
    const hdr = document.querySelector('[data-testid="booking-detail-header"]')?.getBoundingClientRect();
    const tabs = Array.from(document.querySelectorAll('[data-testid="booking-detail-tabs"] button'));
    const tabClipping = tabs.map((t) => ({
      text: t.textContent?.trim(),
      overflowPx: Math.round(t.scrollWidth - t.clientWidth),
    }));
    const roomCards = Array.from(document.querySelectorAll('[data-testid^="room-accordion-card-"]'));
    return {
      headerHeight: Math.round(hdr?.height || 0),
      tabCount: tabs.length,
      tabClipping,
      roomCardCount: roomCards.length,
      modalOverflowPx: modal ? Math.round(modal.scrollWidth - modal.clientWidth) : -1,
      docOverflowPx: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    };
  });

  await mPage.screenshot({ path: path.join(outDir, 'mobile_detail_accordion.png'), fullPage: false });

  // Test "Mở rộng tất cả" / "Thu gọn tất cả"
  await mPage.locator('[data-testid="toggle-all-rooms-btn"]').click();
  await mPage.waitForTimeout(250);
  const allExpandedPricingBtns = await mPage.locator('[data-testid^="room-edit-pricing-btn-"]').count();
  await mPage.locator('[data-testid="toggle-all-rooms-btn"]').click();
  await mPage.waitForTimeout(250);
  const allCollapsedPricingBtns = await mPage.locator('[data-testid^="room-edit-pricing-btn-"]').count();

  // Expand room 202 and test inline Pricing & Services editors
  await mPage.locator('[data-testid="room-accordion-toggle-202"]').click();
  await mPage.waitForTimeout(250);
  await mPage.locator('[data-testid="room-edit-pricing-btn-202"]').click();
  await mPage.waitForSelector('[data-testid="room-save-pricing-btn-202"]', { timeout: 5000 });
  await mPage.screenshot({ path: path.join(outDir, 'mobile_detail_expanded.png'), fullPage: false });
  await mPage.locator('[data-testid="room-save-pricing-btn-202"]').click();
  await mPage.waitForTimeout(400);

  await mPage.locator('[data-testid="room-edit-services-btn-202"]').click();
  await mPage.waitForSelector('[data-testid="room-service-submit-btn-202"]', { timeout: 5000 });
  await mPage.locator('[data-testid="room-services-editor-202"] input[placeholder*="Tên dịch vụ"]').fill('Nước suối QA');
  await mPage.locator('[data-testid="room-services-editor-202"] input[type="number"]').nth(1).fill('20000');
  await mPage.locator('[data-testid="room-service-submit-btn-202"]').click();
  await mPage.waitForTimeout(500);
  const serviceAdded = (await mPage.locator('[data-testid="room-accordion-card-202"]').innerText()).includes('Nước suối QA');

  // Switch through all 4 tabs
  await mPage.locator('[data-testid="booking-detail-tab-occupants"]').click();
  await mPage.waitForSelector('[data-testid="detail-tab-occupants-panel"]', { timeout: 5000 });
  await mPage.locator('[data-testid="booking-detail-tab-payment"]').click();
  await mPage.waitForSelector('[data-testid="detail-tab-payment-panel"]', { timeout: 5000 });
  await mPage.waitForTimeout(300);
  await mPage.screenshot({ path: path.join(outDir, 'mobile_detail_payment.png'), fullPage: false });
  await mPage.locator('[data-testid="booking-detail-tab-history"]').click();
  await mPage.waitForSelector('[data-testid="detail-tab-history-panel"]', { timeout: 5000 });
  await mPage.waitForTimeout(300);

  // Test Layered Android Back:
  // Back #1 -> closes Detail Modal, reveals Quick Preview Sheet
  await mPage.evaluate(() => window.history.back());
  await mPage.waitForTimeout(450);
  const detailClosedAfterBack1 = (await mPage.locator('[data-testid="booking-detail-modal"]').count()) === 0;
  const sheetStillOpenAfterBack1 = (await mPage.locator('[data-testid="calendar-quick-preview-sheet"]').count()) === 1;

  // Back #2 -> closes Quick Preview Sheet back to Calendar
  await mPage.evaluate(() => window.history.back());
  await mPage.waitForTimeout(450);
  const sheetClosedAfterBack2 = (await mPage.locator('[data-testid="calendar-quick-preview-sheet"]').count()) === 0;

  results.mobile = {
    singleHasCode: singleSheetText.includes('LIK00847'),
    singleFinCols,
    singleClosedByBack,
    groupHasCode: groupSheetText.includes('LIK00848'),
    groupHas4RoomsBadge: groupSheetText.includes('4 phòng'),
    mobileDetailMetrics,
    allExpandedPricingBtns,
    allCollapsedPricingBtns,
    serviceAdded,
    detailClosedAfterBack1,
    sheetStillOpenAfterBack1,
    sheetClosedAfterBack2,
  };
  await mCtx.close();

  // === 2. DESKTOP 1440x900 ===
  const dCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dPage = await dCtx.newPage();
  dPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[D] ${m.text()}`); });
  dPage.on('pageerror', (e) => pageErrors.push(`[D] ${e.message}`));

  await dPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await dPage.waitForSelector('input[type="password"]', { timeout: 20000 });
  await dPage.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('owner_emu');
  await dPage.locator('input[type="password"]').first().fill('OwnerEmu#2026');
  await dPage.locator('button[type="submit"]').first().click();
  await dPage.waitForSelector('aside nav', { timeout: 20000 });
  await dPage.waitForTimeout(700);
  await dPage.locator('aside button:visible').filter({ hasText: 'Lịch Calendar' }).first().click();
  await dPage.waitForSelector('[data-testid="calendar-booking-bar-LIK00848-202"]', { timeout: 10000 });
  await dPage.waitForTimeout(400);

  await dPage.locator('[data-testid="calendar-booking-bar-LIK00848-202"]').click();
  await dPage.waitForSelector('[data-testid="calendar-quick-preview-sheet"]', { timeout: 8000 });
  await dPage.waitForTimeout(300);
  await dPage.screenshot({ path: path.join(outDir, 'desktop_quick_preview_group.png'), fullPage: false });

  await dPage.locator('[data-testid="quick-preview-detail-btn"]').click();
  await dPage.waitForSelector('[data-testid="booking-detail-modal"]', { timeout: 8000 });
  await dPage.waitForTimeout(350);
  const desktopRoomCount = await dPage.locator('[data-testid^="room-accordion-card-"]').count();
  await dPage.screenshot({ path: path.join(outDir, 'desktop_detail_accordion.png'), fullPage: false });

  results.desktop = {
    desktopRoomCount,
  };
  await dCtx.close();

  console.log('QA_2STEP_RESULTS:', JSON.stringify(results, null, 2));
  console.log('CONSOLE_ERRORS:', consoleErrors.length, consoleErrors);
  console.log('PAGE_ERRORS:', pageErrors.length, pageErrors);

  const failures = [];
  if (!results.mobile.singleHasCode || results.mobile.singleFinCols !== 3) failures.push('Single quick preview invalid');
  if (!results.mobile.singleClosedByBack) failures.push('Single quick preview did not close on Back');
  if (!results.mobile.groupHasCode || !results.mobile.groupHas4RoomsBadge) failures.push('Group quick preview missing LIK00848 or 4 phòng');
  if (results.mobile.mobileDetailMetrics.headerHeight > 60) failures.push(`Detail header too tall: ${results.mobile.mobileDetailMetrics.headerHeight}`);
  if (results.mobile.mobileDetailMetrics.tabCount !== 4) failures.push('Detail tab count != 4');
  if (results.mobile.mobileDetailMetrics.tabClipping.some((t) => t.overflowPx > 2)) failures.push(`Tab text clipped: ${JSON.stringify(results.mobile.mobileDetailMetrics.tabClipping)}`);
  if (results.mobile.mobileDetailMetrics.roomCardCount !== 4) failures.push(`Expected 4 room cards, got ${results.mobile.mobileDetailMetrics.roomCardCount}`);
  if (results.mobile.mobileDetailMetrics.docOverflowPx > 0 || results.mobile.mobileDetailMetrics.modalOverflowPx > 0) failures.push('Horizontal overflow detected');
  if (results.mobile.allExpandedPricingBtns !== 4 || results.mobile.allCollapsedPricingBtns !== 0) failures.push('Toggle all rooms expand/collapse failed');
  if (!results.mobile.serviceAdded) failures.push('Inline service add failed');
  if (!results.mobile.detailClosedAfterBack1 || !results.mobile.sheetStillOpenAfterBack1 || !results.mobile.sheetClosedAfterBack2) {
    failures.push(`Layered Android Back failed: back1Closed=${results.mobile.detailClosedAfterBack1}, sheetKept=${results.mobile.sheetStillOpenAfterBack1}, back2Closed=${results.mobile.sheetClosedAfterBack2}`);
  }
  if (results.desktop.desktopRoomCount !== 4) failures.push('Desktop detail missing 4 rooms');
  if (consoleErrors.length > 0 || pageErrors.length > 0) failures.push('Runtime console/page errors detected');

  if (failures.length > 0) {
    throw new Error('QA_2STEP_FAILURES:\n- ' + failures.join('\n- '));
  }
  console.log('ALL_2STEP_QA_CHECKS_PASSED');
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);
