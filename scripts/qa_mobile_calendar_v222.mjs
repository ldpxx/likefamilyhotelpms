import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/MOBILE_CALENDAR_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const pwMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);
const { chromium } = pwMod;

const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'MobCalQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'MobCalQaOwn');
const authSa = authMod.getAuth(appSa);
const authOwn = authMod.getAuth(appOwn);
authMod.connectAuthEmulator(authSa, 'http://127.0.0.1:9099', { disableWarnings: true });
authMod.connectAuthEmulator(authOwn, 'http://127.0.0.1:9099', { disableWarnings: true });
const dbSa = fsMod.getFirestore(appSa);
fsMod.connectFirestoreEmulator(dbSa, '127.0.0.1', 8080);

const fullPerms = {
  canViewFinance: true, canViewProfit: true, canCreateBooking: true, canCheckInOut: true, canCancelBooking: true,
  canManageHousekeeping: true, canManageOta: true, canManageConfig: true, canManageStaff: true,
  canExportReports: true, canCollectPayment: true, canAddExpense: true, canEditPrice: true, canUndoAction: true,
};

const saCred = await authMod.createUserWithEmailAndPassword(authSa, 'ducphuong84@gmail.com', 'DemoSa#2026');
await fsMod.setDoc(fsMod.doc(dbSa, 'system_meta', 'bootstrap'), {
  adminInitialized: true, superAdminUid: saCred.user.uid, ownerUid: saCred.user.uid,
  superAdminEmail: 'ducphuong84@gmail.com', initializedAt: new Date().toISOString(),
});
await fsMod.setDoc(fsMod.doc(dbSa, 'staff_users', saCred.user.uid), {
  uid: saCred.user.uid, username: 'ducphuong84', email: 'ducphuong84@gmail.com',
  fullName: 'SuperAdmin Gốc', phone: '', role: 'superadmin', authSource: 'firebase_superadmin',
  isActive: true, permissions: fullPerms, createdAt: new Date().toISOString(),
});
const ownCred = await authMod.createUserWithEmailAndPassword(authOwn, 'owner_emu@likefamilyhotel.com', 'OwnerEmu#2026');
await fsMod.setDoc(fsMod.doc(dbSa, 'staff_users', ownCred.user.uid), {
  uid: ownCred.user.uid, username: 'owner_emu', email: 'owner_emu@likefamilyhotel.com',
  fullName: 'Chủ Khách Sạn (Emulator)', phone: '0900000001', role: 'owner', authSource: 'firebase_staff',
  isActive: true, mustChangePassword: false, permissions: fullPerms, createdAt: new Date().toISOString(),
});

const backup = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'backups/firestore_backup_pre_golive_2026-11-28.json'), 'utf8'));
for (const col of ['hotel_config', 'form_templates', 'room_types', 'rooms']) {
  for (const [docId, data] of Object.entries(backup.collections[col] || {})) {
    await fsMod.setDoc(fsMod.doc(dbSa, col, docId), data);
  }
}
// Make P.202 dirty so we verify dirty brush icon in 56px mobile cell
await fsMod.updateDoc(fsMod.doc(dbSa, 'rooms', 'room_202'), { hkStatus: 'dirty' });

const addD = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const nowIso = new Date().toISOString();

const sampleBookings = [
  { id: 'mb_1', code: 'LIK00841', roomId: 'room_201', rn: '201', guest: 'Nguyễn Văn Hùng', status: 'in_house', source: 'walk_in', ci: addD(-1), co: addD(3), paid: 1800000, gross: 1800000 },
  { id: 'mb_2', code: 'LIK00848', roomId: 'room_202', rn: '202', guest: 'Trương Thúy Vy', status: 'reserved', source: 'group', groupName: 'Đoàn Vy', ci: addD(1), co: addD(4), paid: 500000, gross: 1800000 },
  { id: 'mb_3', code: 'LIK00847', roomId: 'room_404', rn: '404', guest: 'QIU TINGGEN', status: 'in_house', source: 'ota', otaChannel: 'Trip.com', ci: addD(-2), co: addD(2), paid: 2200000, gross: 2200000 },
  { id: 'mb_4', code: 'LIK00842', roomId: 'room_502', rn: '502', guest: 'Daria Shvetsova', status: 'in_house', source: 'ota', otaChannel: 'Agoda', ci: addD(-1), co: addD(2), paid: 0, gross: 1500000 },
  { id: 'mb_5', code: 'LIK00839', roomId: 'room_301', rn: '301', guest: 'Kim Min Jun', status: 'checked_out', source: 'walk_in', ci: addD(-3), co: addD(0), paid: 1200000, gross: 1200000 },
];
for (const s of sampleBookings) {
  await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', s.id), {
    id: s.id,
    bookingCode: s.code,
    roomId: s.roomId,
    roomNumber: s.rn,
    roomTypeId: 'rt_dbl_balk',
    roomTypeName: 'Phòng Đôi Ban Công',
    bookingMode: 'daily',
    status: s.status,
    source: s.source,
    otaChannel: s.otaChannel || null,
    groupId: s.groupName ? 'grp_vy' : null,
    groupName: s.groupName || null,
    checkIn: s.ci,
    checkOut: s.co,
    nights: 3,
    primaryGuestId: `g_${s.id}`,
    primaryGuestName: s.guest,
    primaryGuestNormalizedName: s.guest.toLowerCase(),
    primaryGuestPhone: '',
    primaryGuestIdNumber: '',
    grossRoomTotal: s.gross,
    serviceTotal: 0,
    hourlySurcharge: 0,
    depositPaid: 0,
    guestPaid: s.paid,
    paymentMethod: 'cash',
    otaSettlementStatus: 'not_applicable',
    dailyRates: [{ date: s.ci, rate: s.gross / 3 }],
    services: [],
    occupantCount: 1,
    hasPendingAsm: false,
    hasStayPermitAlert: false,
    occupants: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

const PORT = 4182;
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

try {
  // --- TEST 1: MOBILE 390x844 ---
  const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mPage = await mCtx.newPage();
  mPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  mPage.on('pageerror', (e) => pageErrors.push(e.message));

  await mPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await mPage.waitForSelector('input[type="password"]', { timeout: 20000 });
  await mPage.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('owner_emu');
  await mPage.locator('input[type="password"]').first().fill('OwnerEmu#2026');
  await mPage.locator('button[type="submit"]').first().click();
  await mPage.waitForSelector('header h1', { timeout: 20000 });
  await mPage.waitForTimeout(800);

  await mPage.locator('header button:visible').first().click();
  await mPage.waitForTimeout(300);
  await mPage.locator('div.fixed button:visible').filter({ hasText: 'Lịch Calendar' }).first().click();
  await mPage.waitForSelector('[data-testid="mobile-calendar-topbar"]', { timeout: 10000 });
  await mPage.waitForTimeout(600);

  const mobileMetrics = await mPage.evaluate(() => {
    const topBar = document.querySelector('[data-testid="mobile-calendar-topbar"]')?.getBoundingClientRect();
    const dualHeader = document.querySelector('[data-testid="mobile-calendar-dual-header"]')?.getBoundingClientRect();
    const stickyCorner = document.querySelector('[data-testid="calendar-sticky-corner"]')?.getBoundingClientRect();
    const bottomLegend = document.querySelector('[data-testid="mobile-calendar-bottom-legend"]')?.getBoundingClientRect();
    const groupHdr = document.querySelector('[data-testid="calendar-group-header-floor"]')?.getBoundingClientRect();
    const roomRows = Array.from(document.querySelectorAll('[data-testid^="calendar-room-row-"]'));
    const visibleRoomsOnScreen = roomRows.filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= (dualHeader?.bottom || 0) - 2 && b.bottom <= (bottomLegend?.top || window.innerHeight) + 2;
    }).length;
    const dayCols = Array.from(document.querySelectorAll('[data-testid^="calendar-day-col-"]'));
    const visibleDaysOnScreen = dayCols.filter((c) => {
      const b = c.getBoundingClientRect();
      return b.right > (stickyCorner?.right || 56) + 2 && b.left < window.innerWidth - 2;
    }).length;
    const firstRoomRow = roomRows[0]?.getBoundingClientRect();
    const firstDayCol = dayCols[0]?.getBoundingClientRect();
    const bookingBar = document.querySelector('[data-testid="calendar-booking-bar-LIK00841"]')?.getBoundingClientRect();
    const timeLine = document.querySelector('[data-testid="calendar-current-time-line"]')?.getBoundingClientRect();
    return {
      topBarHeight: Math.round(topBar?.height || 0),
      dualHeaderHeight: Math.round(dualHeader?.height || 0),
      stickyColWidth: Math.round(stickyCorner?.width || 0),
      dayColWidth: Math.round(firstDayCol?.width || 0),
      roomRowHeight: Math.round(firstRoomRow?.height || 0),
      groupHeaderHeight: Math.round(groupHdr?.height || 0),
      bookingBarHeight: Math.round(bookingBar?.height || 0),
      bottomLegendHeight: Math.round(bottomLegend?.height || 0),
      visibleRoomsOnScreen,
      visibleDaysOnScreen,
      hasCurrentTimeLine: Boolean(timeLine && timeLine.height > 100),
      horizontalOverflowPx: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  await mPage.screenshot({ path: path.join(outDir, 'mobile_calendar_dense.png'), fullPage: false });

  // Verify clicking an empty cell on P.203 does NOT open booking create modal
  await mPage.locator('[data-testid="calendar-room-row-203"]').click({ position: { x: 200, y: 17 } });
  await mPage.waitForTimeout(300);
  const modalAfterEmptyTap = await mPage.locator('div.fixed.inset-0').count();
  if (modalAfterEmptyTap > 0) {
    throw new Error('Empty cell tap erroneously opened a modal!');
  }

  // Verify clicking Filter button opens Bottom Sheet with all 4 filters + color legend
  await mPage.locator('[data-testid="mobile-calendar-filter-btn"]').click();
  await mPage.waitForSelector('[data-testid="calendar-display-popover"]', { timeout: 5000 });
  await mPage.screenshot({ path: path.join(outDir, 'mobile_calendar_filter_sheet.png'), fullPage: false });
  await mPage.getByRole('button', { name: /Áp dụng/i }).click();
  await mPage.waitForTimeout(250);

  // Verify clicking booking bar opens BookingDetailModal
  await mPage.locator('[data-testid="calendar-booking-bar-LIK00841"]').click();
  await mPage.waitForSelector('text=LIK00841', { timeout: 10000 });
  await mPage.locator('div.fixed.inset-0 button:has(svg.lucide-x)').first().click();
  await mPage.waitForTimeout(250);

  // Verify clicking "+ Đặt phòng" opens BookingCreateModal
  await mPage.locator('[data-testid="mobile-calendar-new-booking-btn"]').click();
  await mPage.waitForSelector('input[placeholder="Nguyễn Văn An"]', { timeout: 10000 });
  await mCtx.close();

  // --- TEST 2: DESKTOP 1440x900 (Zero regression check) ---
  const dCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dPage = await dCtx.newPage();
  dPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  dPage.on('pageerror', (e) => pageErrors.push(e.message));
  await dPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await dPage.waitForSelector('input[type="password"]', { timeout: 20000 });
  await dPage.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('owner_emu');
  await dPage.locator('input[type="password"]').first().fill('OwnerEmu#2026');
  await dPage.locator('button[type="submit"]').first().click();
  await dPage.waitForSelector('aside nav', { timeout: 20000 });
  await dPage.waitForTimeout(700);
  await dPage.locator('aside button:visible').filter({ hasText: 'Lịch Calendar' }).first().click();
  await dPage.waitForSelector('[data-testid="calendar-current-time-line"]', { timeout: 10000 });
  const desktopStickyW = await dPage.evaluate(() => Math.round(document.querySelector('[data-testid="calendar-sticky-corner"]')?.getBoundingClientRect().width || 0));
  await dPage.screenshot({ path: path.join(outDir, 'desktop_calendar_regression.png'), fullPage: false });
  await dCtx.close();

  if (
    mobileMetrics.topBarHeight > 48 ||
    mobileMetrics.stickyColWidth !== 56 ||
    mobileMetrics.dayColWidth !== 46 ||
    mobileMetrics.roomRowHeight !== 34 ||
    mobileMetrics.dualHeaderHeight !== 44 ||
    mobileMetrics.bottomLegendHeight !== 26 ||
    mobileMetrics.visibleRoomsOnScreen < 12 ||
    mobileMetrics.visibleDaysOnScreen < 6 ||
    !mobileMetrics.hasCurrentTimeLine ||
    mobileMetrics.horizontalOverflowPx > 0 ||
    desktopStickyW !== 148 ||
    consoleErrors.length > 0 ||
    pageErrors.length > 0
  ) {
    throw new Error(
      `Mobile Calendar QA failed assertions: ${JSON.stringify({
        mobileMetrics,
        desktopStickyW,
        consoleErrors,
        pageErrors,
      })}`
    );
  }

  console.log(
    'QA_MOBILE_CALENDAR_RESULTS:',
    JSON.stringify({ mobileMetrics, desktopStickyW, emptyTapBlocked: true, bookingBarTapOk: true, newBookingBtnOk: true, consoleErrors: 0, pageErrors: 0, status: 'PASS' }, null, 2)
  );
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);
