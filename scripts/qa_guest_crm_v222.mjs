import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/GUEST_CRM_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const pwMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);
const { chromium } = pwMod;

// 1. Seed Firebase Local Emulator (ZERO touch on live production!)
const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'GuestCrmQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'GuestCrmQaOwn');
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

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const twoDaysAgo = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const nowIso = new Date().toISOString();

async function seedCrmTestData() {
  // Clean guests (skipping WALK_IN_DEFAULT which Firestore Rules permanently protect from deletion!), bookings, room_occupancy, customer_groups
  for (const colName of ['guests', 'bookings', 'room_occupancy', 'customer_groups']) {
    const snap = await fsMod.getDocs(fsMod.collection(dbSa, colName));
    for (const d of snap.docs) {
      if (colName === 'guests' && d.id === 'WALK_IN_DEFAULT') continue;
      await fsMod.deleteDoc(d.ref);
    }
  }

  // 3 anonymous "Khách lẻ" duplicate docs (should ALL merge into WALK_IN_DEFAULT)
  for (const [idx, info] of [
    { id: 'dup_walkin_1', name: 'Khách lẻ', date: twoDaysAgo },
    { id: 'dup_walkin_2', name: 'khách lẻ', date: yesterday },
    { id: 'dup_walkin_3', name: '  ', date: today },
  ].entries()) {
    await fsMod.setDoc(fsMod.doc(dbSa, 'guests', info.id), {
      id: info.id,
      guestCategory: 'vietnamese',
      fullName: info.name,
      normalizedName: info.name.trim() ? 'khach le' : '',
      phone: '',
      normalizedPhone: '',
      gender: '',
      dob: '',
      nationality: 'VN',
      idType: 'cccd',
      idNumber: '',
      totalStays: 1,
      totalSpent: 300000,
      lastVisitDate: info.date,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', `bkg_walkin_${idx + 1}`), {
      id: `bkg_walkin_${idx + 1}`,
      bookingCode: `WLK-00${idx + 1}`,
      roomId: `room_20${idx + 1}`,
      roomNumber: `20${idx + 1}`,
      roomTypeId: 'rt_dbl_balk',
      roomTypeName: 'Phòng Đôi',
      bookingMode: 'daily',
      status: 'checked_out',
      source: 'walk_in',
      checkIn: info.date,
      checkOut: today,
      nights: 1,
      primaryGuestId: info.id,
      primaryGuestName: info.name.trim() || 'Khách lẻ',
      primaryGuestNormalizedName: 'khach le',
      primaryGuestPhone: '',
      primaryGuestIdNumber: '',
      grossRoomTotal: 300000,
      serviceTotal: 0,
      hourlySurcharge: 0,
      depositPaid: 0,
      guestPaid: 300000,
      paymentMethod: 'cash',
      otaSettlementStatus: 'not_applicable',
      dailyRates: [{ date: info.date, rate: 300000 }],
      services: [],
      occupantCount: 1,
      hasPendingAsm: false,
      hasStayPermitAlert: false,
      occupants: [
        {
          occupantId: `occ_w_${idx + 1}`,
          guestId: info.id,
          guestCategory: 'vietnamese',
          fullName: info.name.trim() || 'Khách lẻ',
          phone: '',
          gender: '',
          dob: '',
          nationality: 'VN',
          idType: 'cccd',
          idNumber: '',
          asmStatus: 'not_applicable',
          isPrimary: true,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  // 1 "Khách lẻ" WITH a phone number -> MUST NOT be merged!
  await fsMod.setDoc(fsMod.doc(dbSa, 'guests', 'guest_walkin_with_phone'), {
    id: 'guest_walkin_with_phone',
    guestCategory: 'vietnamese',
    fullName: 'Khách lẻ',
    normalizedName: 'khach le',
    phone: '0905888999',
    normalizedPhone: '0905888999',
    gender: '',
    dob: '',
    nationality: 'VN',
    idType: 'cccd',
    idNumber: '',
    totalStays: 2,
    totalSpent: 700000,
    lastVisitDate: today,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  // 1 real repeat guest with 5 stays (NO manual group yet -> MUST NOT show auto "Khách hàng thân quen"!)
  await fsMod.setDoc(fsMod.doc(dbSa, 'guests', 'guest_nguyen_an'), {
    id: 'guest_nguyen_an',
    guestCategory: 'vietnamese',
    fullName: 'Nguyễn Văn An',
    normalizedName: 'nguyen van an',
    phone: '0912345678',
    normalizedPhone: '0912345678',
    gender: 'Nam',
    dob: '1990-01-01',
    nationality: 'VN',
    idType: 'cccd',
    idNumber: '048090001122',
    totalStays: 5,
    totalSpent: 3500000,
    lastVisitDate: today,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

// 2. Start Vite dev server against Emulator
const PORT = 4179;
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
  await seedCrmTestData();
  const consoleErrors = [];
  const pageErrors = [];
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
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
  await page.waitForTimeout(1200);

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
  await page.getByRole('button', { name: /Hồ sơ Khách & ASM/i }).first().click();
  await page.waitForSelector('[data-testid="guest-row-guest_nguyen_an"]', { timeout: 15000 });

  // 1. Assert ZERO auto "Khách hàng thân quen" badge on 5-stay guest Nguyễn Văn An
  const anRowText = await page.locator('[data-testid="guest-row-guest_nguyen_an"]').textContent();
  if (anRowText?.includes('Khách hàng thân quen')) {
    throw new Error(`[${viewportName}] Auto "Khách hàng thân quen" badge still appeared on unassigned 5-stay guest!`);
  }

  // 2. Merge 3 duplicate anonymous "Khách lẻ" into WALK_IN_DEFAULT
  const mergeBtnText = await page.locator('[data-testid="merge-walkin-btn"]').textContent();
  if (!mergeBtnText?.includes('(3)')) {
    throw new Error(`[${viewportName}] Expected merge button to show (3), got "${mergeBtnText}"`);
  }
  await page.locator('[data-testid="merge-walkin-btn"]').click();
  await page.waitForSelector('[data-testid="guest-row-WALK_IN_DEFAULT"]', { timeout: 10000 });
  await page.waitForTimeout(600);

  // Verify WALK_IN_DEFAULT is pinned as FIRST row in the table with [Hệ thống] badge, and guest_walkin_with_phone survived!
  const firstRowTestId = await page.locator('tbody tr[data-testid^="guest-row-"]').first().getAttribute('data-testid');
  if (firstRowTestId !== 'guest-row-WALK_IN_DEFAULT') {
    throw new Error(`[${viewportName}] WALK_IN_DEFAULT not pinned at top! First row: ${firstRowTestId}`);
  }
  const walkInDoc = (await fsMod.getDoc(fsMod.doc(dbSa, 'guests', 'WALK_IN_DEFAULT'))).data();
  const survivedPhoneDoc = await fsMod.getDoc(fsMod.doc(dbSa, 'guests', 'guest_walkin_with_phone'));
  const deletedDup1 = await fsMod.getDoc(fsMod.doc(dbSa, 'guests', 'dup_walkin_1'));
  const relinkedBkg1 = (await fsMod.getDoc(fsMod.doc(dbSa, 'bookings', 'bkg_walkin_1'))).data();
  if (walkInDoc?.totalStays !== 3 || !walkInDoc?.isSystemDefault || !survivedPhoneDoc.exists() || deletedDup1.exists() || relinkedBkg1?.primaryGuestId !== 'WALK_IN_DEFAULT') {
    throw new Error(
      `[${viewportName}] Merge verification failed: ${JSON.stringify({
        walkInStays: walkInDoc?.totalStays,
        isSys: walkInDoc?.isSystemDefault,
        survivedPhone: survivedPhoneDoc.exists(),
        dup1StillExists: deletedDup1.exists(),
        relinkedBkg1: relinkedBkg1?.primaryGuestId,
      })}`
    );
  }

  // 3. Test "Quản lý nhóm khách" modal: create new group "Khách dài hạn"
  await page.locator('[data-testid="manage-customer-groups-btn"]').click();
  await page.waitForSelector('[data-testid="customer-group-name-input"]', { timeout: 10000 });
  await page.locator('[data-testid="customer-group-name-input"]').fill('Khách dài hạn');
  await page.locator('[data-testid="customer-group-save-btn"]').click();
  await page.waitForSelector('text=Khách dài hạn', { timeout: 10000 });
  await page.locator('div.fixed.inset-0 button:has(svg.lucide-x)').first().click();
  await page.waitForTimeout(300);

  // 4. Test inline manual group assignment on Nguyễn Văn An -> assign "Khách VIP" (cg_vip)
  await page.locator('[data-testid="guest-group-assign-btn-guest_nguyen_an"]').click();
  await page.locator('[data-testid="inline-group-select-guest_nguyen_an"]').selectOption('cg_vip');
  await page.waitForSelector('[data-testid="guest-group-badge-guest_nguyen_an"]', { timeout: 10000 });
  const badgeText = await page.locator('[data-testid="guest-group-badge-guest_nguyen_an"]').textContent();
  if (!badgeText?.includes('Khách VIP')) {
    throw new Error(`[${viewportName}] Expected manual badge "Khách VIP", got "${badgeText}"`);
  }

  // 5. Test "Tất cả nhóm khách" filter dropdown -> select cg_vip -> ONLY Nguyễn Văn An shows!
  await page.locator('[data-testid="guests-group-filter"]').selectOption('cg_vip');
  await page.waitForTimeout(300);
  const filteredRowCount = await page.locator('tbody tr[data-testid^="guest-row-"]').count();
  if (filteredRowCount !== 1) {
    throw new Error(`[${viewportName}] Expected 1 guest after cg_vip filter, got ${filteredRowCount}`);
  }
  await page.locator('[data-testid="guests-group-filter"]').selectOption('all');
  await page.waitForTimeout(300);

  await page.screenshot({ path: path.join(outDir, `${viewportName}_guest_crm.png`), fullPage: false });

  // 6. Create a new booking with anonymous "Khách lẻ" -> must link to WALK_IN_DEFAULT & increment totalStays 3 -> 4 without creating a new guest doc!
  const guestsBefore = (await fsMod.getDocs(fsMod.collection(dbSa, 'guests'))).size;
  await page.getByRole('button', { name: /\+ Đặt phòng mới/i }).first().click();
  await page.waitForSelector('input[placeholder="Nguyễn Văn An"]', { timeout: 10000 });
  await page.locator('input[placeholder="Nguyễn Văn An"]').fill('Khách lẻ');
  await page.locator('div.fixed.inset-0 button[type="submit"]').first().click();
  await page.waitForTimeout(1500);

  const guestsAfter = (await fsMod.getDocs(fsMod.collection(dbSa, 'guests'))).size;
  const walkInAfter = (await fsMod.getDoc(fsMod.doc(dbSa, 'guests', 'WALK_IN_DEFAULT'))).data();
  if (guestsAfter !== guestsBefore || walkInAfter?.totalStays !== 4) {
    throw new Error(
      `[${viewportName}] New anonymous walk-in booking did not consolidate! guestsBefore=${guestsBefore}, guestsAfter=${guestsAfter}, walkInStays=${walkInAfter?.totalStays}`
    );
  }

  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await context.close();

  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`[${viewportName}] Console/Page errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }

  results.push({
    viewport: `${viewportName} (${viewport.width}x${viewport.height})`,
    zeroAutoLoyalBadge: true,
    mergedWalkInDuplicates: 3,
    walkInPinnedFirst: true,
    walkInWithPhonePreserved: true,
    newAnonymousWalkInConsolidated: true,
    walkInTotalStaysAfterNewBooking: walkInAfter?.totalStays,
    customGroupCreated: 'Khách dài hạn',
    manualGroupAssignedAndFiltered: 'Khách VIP (1 row)',
    horizontalOverflowPx: overflowPx,
    consoleErrors: 0,
    pageErrors: 0,
    status: 'PASS',
  });
}

try {
  await runScenario('desktop', { width: 1440, height: 900 });
  await runScenario('mobile', { width: 390, height: 844 });
  console.log('QA_GUEST_CRM_RESULTS:', JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);
