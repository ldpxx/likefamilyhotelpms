import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/BOOKINGS_TAB_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const pwMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);
const { chromium } = pwMod;

const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'BkgTabQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'BkgTabQaOwn');
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

const addD = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const today = addD(0);

// Seed 5 carefully designed bookings covering:
// - LIK00852 (newest via code fallback, NO createdAt? Actually test both createdAt & code fallback!)
// - LIK00851 (hourly, P.202, unpaid 150k, today)
// - LIK00850 (monthly 35 nights, P.303, paid 0 balance, check-in -15d -> +20d -> overlaps today!)
// - LIK00849 (daily, P.404, unpaid 2.5M highest balance, check-in +1d)
// - LIK00848 (daily group, P.202, unpaid 1.0M, check-in +5d)
const seedBookings = [
  {
    id: 'b_850',
    bookingCode: 'LIK00850',
    roomId: 'room_303',
    roomNumber: '303',
    bookingMode: 'daily',
    status: 'in_house',
    source: 'walk_in',
    checkIn: addD(-15),
    checkOut: addD(20),
    nights: 35,
    primaryGuestName: 'SOLGALOVA VERONIKA',
    primaryGuestPhone: '0901111111',
    grossRoomTotal: 10000000,
    guestPaid: 10000000,
    createdAt: '', // missing createdAt -> falls back to code 850
  },
  {
    id: 'b_852',
    bookingCode: 'LIK00852',
    roomId: 'room_201',
    roomNumber: '201',
    bookingMode: 'daily',
    status: 'reserved',
    source: 'zalo',
    checkIn: addD(2),
    checkOut: addD(4),
    nights: 2,
    primaryGuestName: 'Nguyễn Minh Khôi',
    primaryGuestPhone: '0902222222',
    grossRoomTotal: 1200000,
    guestPaid: 1200000,
    createdAt: '', // missing createdAt -> code 852 MUST sort above 850 & older!
  },
  {
    id: 'b_851',
    bookingCode: 'LIK00851',
    roomId: 'room_202',
    roomNumber: '202',
    bookingMode: 'hourly',
    hourlyHours: 2,
    checkInTime: '10:00',
    checkOutTime: '12:00',
    status: 'in_house',
    source: 'walk_in',
    checkIn: today,
    checkOut: today,
    nights: 0,
    primaryGuestName: 'Khách Nghỉ Giờ',
    primaryGuestPhone: '0903333333',
    grossRoomTotal: 250000,
    guestPaid: 100000, // unpaid 150k
    createdAt: '2026-11-28T03:00:00.000Z',
  },
  {
    id: 'b_849',
    bookingCode: 'LIK00849',
    roomId: 'room_404',
    roomNumber: '404',
    bookingMode: 'daily',
    status: 'reserved',
    source: 'ota',
    otaChannel: 'Booking.com',
    checkIn: addD(1),
    checkOut: addD(4),
    nights: 3,
    primaryGuestName: 'QIU TINGGEN',
    primaryGuestPhone: '',
    grossRoomTotal: 2500000,
    guestPaid: 0, // unpaid 2.5M (highest)
    createdAt: '2026-11-26T08:00:00.000Z',
  },
  {
    id: 'b_848',
    bookingCode: 'LIK00848',
    roomId: 'room_202',
    roomNumber: '202',
    bookingMode: 'daily',
    status: 'reserved',
    source: 'group',
    groupName: 'Đoàn Trương Thúy Vy',
    checkIn: addD(5),
    checkOut: addD(8),
    nights: 3,
    primaryGuestName: 'Trương Thúy Vy',
    primaryGuestPhone: '0919888777',
    grossRoomTotal: 2000000,
    guestPaid: 1000000, // unpaid 1M
    createdAt: '2026-11-25T08:00:00.000Z',
  },
];

for (const b of seedBookings) {
  await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', b.id), {
    roomTypeId: 'rt_dbl_balk',
    roomTypeName: 'Phòng Đôi',
    primaryGuestId: `g_${b.id}`,
    primaryGuestNormalizedName: b.primaryGuestName.toLowerCase(),
    primaryGuestIdNumber: '',
    serviceTotal: 0,
    hourlySurcharge: 0,
    depositPaid: 0,
    paymentMethod: 'cash',
    otaSettlementStatus: 'not_applicable',
    dailyRates: [{ date: b.checkIn, rate: b.grossRoomTotal }],
    services: [],
    occupantCount: 1,
    hasPendingAsm: false,
    hasStayPermitAlert: false,
    occupants: [],
    updatedAt: b.createdAt || new Date().toISOString(),
    ...b,
  });
}

const PORT = 4181;
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

const results = [];

async function runScenario(viewportName, viewport) {
  const consoleErrors = [];
  const pageErrors = [];
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[${viewportName} CONSOLE ERROR]`, msg.text());
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    console.error(`[${viewportName} PAGE ERROR]`, err.message);
    pageErrors.push(err.message);
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  await page.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('owner_emu');
  await page.locator('input[type="password"]').first().fill('OwnerEmu#2026');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForSelector('header h1', { timeout: 20000 });
  await page.waitForTimeout(1000);

  async function navigateTo(label) {
    let navBtn = page.locator('aside button:visible').filter({ hasText: label }).first();
    if (!(await navBtn.isVisible().catch(() => false))) {
      await page.locator('header button:visible').first().click();
      await page.waitForTimeout(350);
      navBtn = page.locator('div.fixed button:visible').filter({ hasText: label }).first();
    }
    await navBtn.click();
    await page.waitForTimeout(600);
  }

  await navigateTo('Đơn, Đoàn & ASM');
  await page.waitForSelector('[data-testid="bookings-sort-select"]', { timeout: 10000 });

  // Helper to get rendered booking codes in order
  const getRowCodes = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('tbody tr')).map((tr) => {
        const m = (tr.textContent || '').match(/LIK\d+/);
        return m ? m[0] : '';
      })
    );

  // 1. Default sort = newest (LIK00852 fallback > LIK00851 > LIK00850 fallback > LIK00849 > LIK00848)
  const defaultCodes = await getRowCodes();
  if (defaultCodes[0] !== 'LIK00852' || defaultCodes[defaultCodes.length - 1] !== 'LIK00848') {
    throw new Error(`[${viewportName}] Default newest sort unexpected: ${JSON.stringify(defaultCodes)}`);
  }

  // 2. Test Sort = balance_desc -> LIK00849 (2.5M) must be FIRST!
  await page.locator('[data-testid="bookings-sort-select"]').selectOption('balance_desc');
  await page.waitForTimeout(250);
  const balanceCodes = await getRowCodes();
  if (balanceCodes[0] !== 'LIK00849') {
    throw new Error(`[${viewportName}] Expected LIK00849 first on balance_desc, got ${JSON.stringify(balanceCodes)}`);
  }

  // 3. Test Search by "P.202" -> matches 2 bookings (LIK00851 & LIK00848)
  await page.locator('[data-testid="bookings-search-input"]').fill('P.202');
  await page.waitForTimeout(250);
  const p202Codes = await getRowCodes();
  if (p202Codes.length !== 2) {
    throw new Error(`[${viewportName}] Search P.202 expected 2 bookings, got ${JSON.stringify(p202Codes)}`);
  }

  // 4. Test Reset Filter button
  await page.locator('[data-testid="bookings-reset-filters-btn"]').click();
  await page.waitForTimeout(250);
  const afterResetSummary = (await page.locator('[data-testid="bookings-filter-summary"]').textContent())?.trim();
  if (!afterResetSummary?.includes('5 / 5')) {
    throw new Error(`[${viewportName}] Reset failed, summary: "${afterResetSummary}"`);
  }

  // On Mobile (< 1024px), open "Bộ lọc nâng cao" panel
  if (viewport.width < 1024) {
    await page.locator('[data-testid="bookings-advanced-toggle"]').click();
    await page.waitForTimeout(250);
  }

  // 5. Test Room filter (P.202 -> 2), Rental mode filter (monthly -> 1, hourly -> 1), Payment filter (unpaid -> 3, paid -> 2)
  await page.locator('[data-testid="bookings-room-filter"]').selectOption('202');
  await page.waitForTimeout(200);
  const room202Count = (await getRowCodes()).length;
  await page.locator('[data-testid="bookings-room-filter"]').selectOption('all');

  await page.locator('[data-testid="bookings-mode-filter"]').selectOption('monthly');
  await page.waitForTimeout(200);
  const monthlyCount = (await getRowCodes()).length;
  await page.locator('[data-testid="bookings-mode-filter"]').selectOption('hourly');
  await page.waitForTimeout(200);
  const hourlyCount = (await getRowCodes()).length;
  await page.locator('[data-testid="bookings-mode-filter"]').selectOption('all');

  await page.locator('[data-testid="bookings-payment-filter"]').selectOption('unpaid');
  await page.waitForTimeout(200);
  const unpaidCount = (await getRowCodes()).length;
  await page.locator('[data-testid="bookings-payment-filter"]').selectOption('paid');
  await page.waitForTimeout(200);
  const paidCount = (await getRowCodes()).length;
  await page.locator('[data-testid="bookings-payment-filter"]').selectOption('all');

  if (room202Count !== 2 || monthlyCount !== 1 || hourlyCount !== 1 || unpaidCount !== 3 || paidCount !== 2) {
    throw new Error(`[${viewportName}] Multi-filter mismatch: room202=${room202Count}, monthly=${monthlyCount}, hourly=${hourlyCount}, unpaid=${unpaidCount}, paid=${paidCount}`);
  }

  // 6. Test Date Criteria ("in_house_overlap") + "Hôm nay" chip -> matches LIK00851 (today hourly) & LIK00850 (monthly in-house) = 2!
  await page.locator('[data-testid="bookings-date-field-select"]').selectOption('in_house_overlap');
  await page.locator('[data-testid="bookings-date-chip-today"]').click();
  await page.waitForTimeout(250);
  const inHouseTodayCount = (await getRowCodes()).length;
  if (inHouseTodayCount !== 2) {
    throw new Error(`[${viewportName}] in_house_overlap + Hôm nay expected 2, got ${inHouseTodayCount}`);
  }

  await page.screenshot({ path: path.join(outDir, `${viewportName}_bookings_filters.png`), fullPage: false });

  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await context.close();

  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`[${viewportName}] Console/Page errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }

  results.push({
    viewport: `${viewportName} (${viewport.width}x${viewport.height})`,
    defaultNewestOrder: defaultCodes,
    balanceDescTop: balanceCodes[0],
    searchP202Count: p202Codes.length,
    multiFilterCounts: { room202: room202Count, monthly: monthlyCount, hourly: hourlyCount, unpaid: unpaidCount, paid: paidCount },
    inHouseOverlapTodayCount: inHouseTodayCount,
    horizontalOverflowPx: overflowPx,
    consoleErrors: 0,
    pageErrors: 0,
    status: 'PASS',
  });
}

try {
  await runScenario('desktop', { width: 1440, height: 900 });
  await runScenario('mobile', { width: 390, height: 844 });
  console.log('QA_BOOKINGS_TAB_RESULTS:', JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);
