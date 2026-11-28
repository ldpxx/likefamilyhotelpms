import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/GROUPS_TAB_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const pwMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);
const { chromium } = pwMod;

// 1. Seed Firebase Local Emulator (ZERO touch on live production!)
const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'GroupsQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'GroupsQaOwn');
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

const nowIso = new Date().toISOString();
const addD = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function seedGroupRecord({ id, code, name, leader, phone, status, checkIn, checkOut, rooms, grossPerRoom, paidPerRoom }) {
  await fsMod.setDoc(fsMod.doc(dbSa, 'booking_groups', id), {
    id,
    groupCode: code,
    groupName: name,
    leaderName: leader,
    leaderPhone: phone,
    billingMode: 'master',
    depositAmount: paidPerRoom * rooms.length,
    createdAt: nowIso,
    createdBy: 'QA',
  });
  for (const rm of rooms) {
    const bId = `bkg_${id}_${rm}`;
    await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', bId), {
      id: bId,
      bookingCode: `${code}-${rm}`,
      groupId: id,
      groupName: name,
      roomId: `room_${rm}`,
      roomNumber: rm,
      roomTypeId: 'rt_dbl_balk',
      roomTypeName: 'Phòng Đôi',
      bookingMode: 'daily',
      status,
      source: 'group',
      checkIn,
      checkOut,
      nights: 2,
      primaryGuestId: `g_${id}`,
      primaryGuestName: leader,
      primaryGuestNormalizedName: leader.toLowerCase(),
      primaryGuestPhone: phone,
      primaryGuestIdNumber: '',
      grossRoomTotal: grossPerRoom,
      serviceTotal: 0,
      hourlySurcharge: 0,
      depositPaid: paidPerRoom,
      guestPaid: 0,
      paymentMethod: 'bank_transfer',
      otaSettlementStatus: 'not_applicable',
      dailyRates: [{ date: checkIn, rate: grossPerRoom / 2 }],
      services: [],
      occupantCount: 1,
      hasPendingAsm: false,
      hasStayPermitAlert: false,
      occupants: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
}

// 1 large IN_HOUSE group with 6 rooms (tests >4 rooms collapse + unpaid + pinned first!)
await seedGroupRecord({
  id: 'grp_inhouse_big',
  code: 'GRP-IN01',
  name: 'Đoàn Công Ty Alpha (6 phòng)',
  leader: 'Trần Minh Hải',
  phone: '0905111222',
  status: 'in_house',
  checkIn: addD(-1),
  checkOut: addD(2),
  rooms: ['201', '202', '203', '204', '301', '302'],
  grossPerRoom: 1000000,
  paidPerRoom: 500000, // unpaid (3M / 6M)
});

// 1 RESERVED group (LIK00848 — Trương Thúy Vy, 4 rooms, unpaid)
await seedGroupRecord({
  id: 'grp_lik00848',
  code: 'LIK00848',
  name: 'Đoàn Trương Thúy Vy',
  leader: 'Trương Thúy Vy',
  phone: '0919888777',
  status: 'reserved',
  checkIn: addD(1),
  checkOut: addD(5),
  rooms: ['202', '302', '304', '502'],
  grossPerRoom: 1200000,
  paidPerRoom: 250000, // unpaid
});

// 1 RESERVED group fully paid
await seedGroupRecord({
  id: 'grp_res_paid',
  code: 'GRP-RS02',
  name: 'Đoàn Gia Đình Đà Lạt',
  leader: 'Lê Thu Hà',
  phone: '0988777666',
  status: 'reserved',
  checkIn: addD(3),
  checkOut: addD(5),
  rooms: ['401', '402'],
  grossPerRoom: 1000000,
  paidPerRoom: 1000000, // paid
});

// 12 CHECKED_OUT historical groups (so total = 15 groups -> verifies default active=3 vs all=15 & pagination 10/page -> 2 pages!)
for (let i = 1; i <= 12; i++) {
  await seedGroupRecord({
    id: `grp_hist_${i}`,
    code: `GRP-H${String(i).padStart(2, '0')}`,
    name: `Đoàn Lịch Sử ${i}`,
    leader: `Khách Đoàn ${i}`,
    phone: `09010000${String(i).padStart(2, '0')}`,
    status: 'checked_out',
    checkIn: addD(-30 - i),
    checkOut: addD(-28 - i),
    rooms: ['501', '503'],
    grossPerRoom: 800000,
    paidPerRoom: 800000,
  });
}

// 2. Start Vite dev server
const PORT = 4180;
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
  await page.getByRole('button', { name: /Khách đoàn/i }).first().click();
  await page.waitForSelector('[data-testid="groups-status-pills"]', { timeout: 10000 });

  // 1. Verify default filter = "Đang ở & Sắp đến" -> shows 3 groups (NOT all 15!) and IN_HOUSE group is first!
  const defaultCardCount = await page.locator('[data-testid^="group-card-"]').count();
  const firstCardId = await page.locator('[data-testid^="group-card-"]').first().getAttribute('data-testid');
  if (defaultCardCount !== 3 || firstCardId !== 'group-card-grp_inhouse_big') {
    throw new Error(`[${viewportName}] Expected 3 active/upcoming groups with grp_inhouse_big first, got count=${defaultCardCount}, first=${firstCardId}`);
  }

  // 2. Verify >4 rooms collapse on 6-room group (shows 4 tiles + "Xem thêm 2 phòng...")
  const collapsedTiles = await page.locator('[data-testid^="group-room-tile-grp_inhouse_big-"]').count();
  const toggleBtnText = await page.locator('[data-testid="group-toggle-rooms-grp_inhouse_big"]').textContent();
  if (collapsedTiles !== 4 || !toggleBtnText?.includes('Xem thêm 2 phòng')) {
    throw new Error(`[${viewportName}] Expected 4 collapsed tiles + "Xem thêm 2 phòng", got tiles=${collapsedTiles}, btn="${toggleBtnText}"`);
  }
  await page.locator('[data-testid="group-toggle-rooms-grp_inhouse_big"]').click();
  const expandedTiles = await page.locator('[data-testid^="group-room-tile-grp_inhouse_big-"]').count();
  if (expandedTiles !== 6) {
    throw new Error(`[${viewportName}] Expected 6 tiles after expand, got ${expandedTiles}`);
  }
  await page.locator('[data-testid="group-toggle-rooms-grp_inhouse_big"]').click(); // collapse back

  await page.screenshot({ path: path.join(outDir, `${viewportName}_groups_default.png`), fullPage: false });

  // 3. Test Search by Group Code (LIK00848) & Room Number (P.502)
  await page.locator('[data-testid="groups-search-input"]').fill('LIK00848');
  await page.waitForTimeout(250);
  if ((await page.locator('[data-testid^="group-card-"]').count()) !== 1) {
    throw new Error(`[${viewportName}] Search LIK00848 did not return 1 group`);
  }
  await page.locator('[data-testid="groups-search-input"]').fill('P.502');
  await page.waitForTimeout(250);
  if ((await page.locator('[data-testid^="group-card-"]').count()) !== 1) {
    throw new Error(`[${viewportName}] Search P.502 did not return 1 group`);
  }

  // 4. Test Reset Filter + Payment Filter (unpaid -> 2, paid -> 1)
  await page.locator('[data-testid="groups-reset-filters-btn"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="groups-payment-filter"]').selectOption('unpaid');
  await page.waitForTimeout(250);
  const unpaidCount = await page.locator('[data-testid^="group-card-"]').count();
  await page.locator('[data-testid="groups-payment-filter"]').selectOption('paid');
  await page.waitForTimeout(250);
  const paidCount = await page.locator('[data-testid^="group-card-"]').count();
  if (unpaidCount !== 2 || paidCount !== 1) {
    throw new Error(`[${viewportName}] Payment filter mismatch: unpaid=${unpaidCount}, paid=${paidCount}`);
  }

  // 5. Switch to "Tất cả" (15 groups) -> verify default 10/page pagination (10 on page 1, 5 on page 2)
  await page.locator('[data-testid="groups-reset-filters-btn"]').click();
  await page.locator('[data-testid="groups-status-pill-all"]').click();
  await page.waitForTimeout(300);
  const page1Count = await page.locator('[data-testid^="group-card-"]').count();
  const pageSizeVal = await page.locator('[data-testid="groups-pagination-pagesize"]').inputValue();
  const summaryPage1 = await page.locator('[data-testid="groups-pagination-summary"]').textContent();
  if (page1Count !== 10 || pageSizeVal !== '10') {
    throw new Error(`[${viewportName}] Expected 10 cards on page 1 with pageSize=10, got cards=${page1Count}, size=${pageSizeVal}`);
  }
  await page.locator('[data-testid="groups-pagination-next"]').click();
  await page.waitForTimeout(250);
  const page2Count = await page.locator('[data-testid^="group-card-"]').count();
  if (page2Count !== 5) {
    throw new Error(`[${viewportName}] Expected 5 cards on page 2, got ${page2Count}`);
  }

  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await context.close();

  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`[${viewportName}] Console/Page errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }

  results.push({
    viewport: `${viewportName} (${viewport.width}x${viewport.height})`,
    defaultActiveUpcomingCount: defaultCardCount,
    inHouseSortedFirst: true,
    collapseOver4RoomsVerified: `${collapsedTiles} -> ${expandedTiles}`,
    searchCodeAndRoomVerified: true,
    paymentFilterVerified: { unpaid: unpaidCount, paid: paidCount },
    pagination10PerPageVerified: { page1: page1Count, page2: page2Count, summary: summaryPage1?.trim() },
    horizontalOverflowPx: overflowPx,
    consoleErrors: 0,
    pageErrors: 0,
    status: 'PASS',
  });
}

try {
  await runScenario('desktop', { width: 1440, height: 900 });
  await runScenario('mobile', { width: 390, height: 844 });
  console.log('QA_GROUPS_TAB_RESULTS:', JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);
