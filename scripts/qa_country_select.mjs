import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/COUNTRY_SELECT_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const pwMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);
const { chromium } = pwMod;

// 1. Seed Firebase Local Emulator (ZERO touch on live production!)
const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'CountryQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'CountryQaOwn');
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
const checkout = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);

async function seedQiuTinggen() {
  await fsMod.setDoc(fsMod.doc(dbSa, 'guests', 'guest_qiu_404'), {
    id: 'guest_qiu_404',
    guestCategory: 'foreigner',
    fullName: 'QIU TINGGEN',
    normalizedName: 'qiu tinggen',
    phone: '',
    normalizedPhone: '',
    gender: 'Nam',
    dob: '1988-08-15',
    nationality: 'CN',
    idType: 'visa_passport',
    idNumber: 'EJ1234567',
    visaNumber: 'EVN2026001',
    entryDate: today,
    stayPermitExpiryDate: checkout,
    totalStays: 1,
    totalSpent: 1650000,
    lastVisitDate: today,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await fsMod.setDoc(fsMod.doc(dbSa, 'guests', 'guest_rus_303'), {
    id: 'guest_rus_303',
    guestCategory: 'foreigner',
    fullName: 'SOLGALOVA VERONIKA',
    normalizedName: 'solgalova veronika',
    phone: '',
    normalizedPhone: '',
    gender: 'Nữ',
    dob: '1991-03-22',
    nationality: 'RUS',
    idType: 'visa_passport',
    idNumber: '761122334',
    totalStays: 2,
    totalSpent: 10000000,
    lastVisitDate: today,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', 'bkg_lik00847'), {
    id: 'bkg_lik00847',
    bookingCode: 'LIK00847',
    roomId: 'room_404',
    roomNumber: '404',
    roomTypeId: 'rt_family',
    roomTypeName: 'Phòng Gia Đình',
    bookingMode: 'daily',
    status: 'in_house',
    source: 'ota',
    otaChannel: 'Trip.com',
    sourceLabel: 'Trip.com',
    checkIn: today,
    checkOut: checkout,
    nights: 3,
    primaryGuestId: 'guest_qiu_404',
    primaryGuestName: 'QIU TINGGEN',
    primaryGuestNormalizedName: 'qiu tinggen',
    primaryGuestPhone: '',
    primaryGuestIdNumber: 'EJ1234567',
    grossRoomTotal: 1650000,
    serviceTotal: 0,
    hourlySurcharge: 0,
    depositPaid: 0,
    guestPaid: 1650000,
    paymentMethod: 'ota_debt',
    otaSettlementStatus: 'settled',
    dailyRates: [{ date: today, price: 550000 }],
    services: [],
    occupantCount: 1,
    hasPendingAsm: true,
    hasStayPermitAlert: false,
    occupants: [
      {
        occupantId: 'occ_qiu_404',
        guestId: 'guest_qiu_404',
        guestCategory: 'foreigner',
        fullName: 'QIU TINGGEN',
        phone: '',
        gender: 'Nam',
        dob: '1988-08-15',
        nationality: 'CN',
        idType: 'visa_passport',
        idNumber: 'EJ1234567',
        visaNumber: 'EVN2026001',
        entryDate: today,
        stayPermitExpiryDate: checkout,
        asmStatus: 'pending_asm',
        isPrimary: true,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

await seedQiuTinggen();

// 2. Start Vite dev server against Local Emulator
const PORT = 4178;
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
  await seedQiuTinggen(); // Reset to CN before each viewport run
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

  // 1. Open LIK00847 (P.404 — QIU TINGGEN) -> Khách lưu trú & AI OCR
  await navigateTo('Đơn, Đoàn & ASM');
  await page.waitForSelector('text=LIK00847', { timeout: 15000 });
  await page.locator('text=LIK00847').first().click();
  await page.waitForSelector('text=Khách lưu trú', { timeout: 10000 });
  await page.getByRole('button', { name: /Khách lưu trú/i }).first().click();
  await page.waitForSelector('[data-testid="occupant-nationality-select"]', { timeout: 10000 });

  // Verify CN auto-resolves to "[CN] Trung Quốc (China)"
  const initialTriggerText = (await page.locator('[data-testid="occupant-nationality-select"]').textContent())?.trim();
  if (!initialTriggerText?.includes('[CN] Trung Quốc (China)')) {
    throw new Error(`[${viewportName}] Expected "[CN] Trung Quốc (China)", got "${initialTriggerText}"`);
  }

  // Open CountrySelect and verify top 4 priority countries in exact order: CN, RU, KR, VN
  await page.locator('[data-testid="occupant-nationality-select"]').click();
  await page.waitForSelector('[data-testid="occupant-nationality-select-search"]', { timeout: 5000 });

  const topCodes = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-testid^="occupant-nationality-select-option-"]'));
    return btns.slice(0, 10).map((b) => ({
      code: b.getAttribute('data-testid')?.replace('occupant-nationality-select-option-', ''),
      height: Math.round(b.getBoundingClientRect().height),
    }));
  });
  const expectedTop10 = ['CN', 'RU', 'KR', 'VN', 'KZ', 'US', 'AU', 'JP', 'TW', 'HK'];
  const actualTop10 = topCodes.map((x) => x.code);
  if (JSON.stringify(actualTop10) !== JSON.stringify(expectedTop10)) {
    throw new Error(`[${viewportName}] Priority order mismatch: expected ${expectedTop10.join(',')}, got ${actualTop10.join(',')}`);
  }
  const minOptionHeight = Math.min(...topCodes.map((x) => x.height));
  if (minOptionHeight < 40) {
    throw new Error(`[${viewportName}] Option touch height < 40px: ${minOptionHeight}px`);
  }

  await page.screenshot({ path: path.join(outDir, `${viewportName}_country_dropdown.png`), fullPage: false });

  // Search "Nga" -> verify RU appears
  const searchBox = page.locator('[data-testid="occupant-nationality-select-search"]');
  await searchBox.fill('Nga');
  await page.waitForSelector('[data-testid="occupant-nationality-select-option-RU"]', { timeout: 5000 });

  // Search "KR" -> select South Korea
  await searchBox.fill('KR');
  await page.waitForSelector('[data-testid="occupant-nationality-select-option-KR"]', { timeout: 5000 });
  await page.locator('[data-testid="occupant-nationality-select-option-KR"]').click();

  const updatedTriggerText = (await page.locator('[data-testid="occupant-nationality-select"]').textContent())?.trim();
  if (!updatedTriggerText?.includes('[KR] Hàn Quốc (South Korea)')) {
    throw new Error(`[${viewportName}] Expected "[KR] Hàn Quốc (South Korea)", got "${updatedTriggerText}"`);
  }

  // Save occupant & verify Firestore persisted 'KR'
  await page.getByRole('button', { name: /Lưu hồ sơ & ảnh giấy tờ/i }).click();
  await page.waitForSelector('text=Đã lưu hồ sơ khách lưu trú', { timeout: 10000 });

  const bkgSnap = await fsMod.getDoc(fsMod.doc(dbSa, 'bookings', 'bkg_lik00847'));
  const savedOccNat = bkgSnap.data()?.occupants?.[0]?.nationality;
  if (savedOccNat !== 'KR') {
    throw new Error(`[${viewportName}] Expected saved booking occupant nationality 'KR', got '${savedOccNat}'`);
  }

  // Close BookingDetailModal & check ASM + Guest CRM badges & filter
  await page.locator('div.fixed.inset-0 button:has(svg.lucide-x)').first().click();
  await page.waitForTimeout(350);

  await page.getByRole('button', { name: /Hồ sơ Khách & ASM/i }).first().click();
  await page.waitForSelector('text=KR · Hàn Quốc', { timeout: 10000 });
  await page.waitForSelector('text=RU · Nga', { timeout: 10000 });

  // Test Guest CRM country filter (filter to RU -> shows SOLGALOVA VERONIKA)
  await page.locator('[data-testid="guests-country-filter"]').click();
  await page.locator('[data-testid="guests-country-filter-option-RU"]').click();
  await page.waitForSelector('text=SOLGALOVA VERONIKA', { timeout: 5000 });

  await page.screenshot({ path: path.join(outDir, `${viewportName}_asm_guests.png`), fullPage: false });

  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await context.close();

  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`[${viewportName}] Console/Page errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }

  results.push({
    viewport: `${viewportName} (${viewport.width}x${viewport.height})`,
    initialTriggerText,
    top10PriorityVerified: true,
    minOptionHeightPx: minOptionHeight,
    searchNgaVerified: true,
    searchKrAndSaved: savedOccNat,
    asmBadgeVerified: 'KR · Hàn Quốc & RU · Nga',
    guestsFilterVerified: true,
    horizontalOverflowPx: overflowPx,
    consoleErrors: 0,
    pageErrors: 0,
    status: 'PASS',
  });
}

try {
  await runScenario('desktop', { width: 1440, height: 900 });
  await runScenario('mobile', { width: 390, height: 844 });
  console.log('QA_COUNTRY_SELECT_RESULTS:', JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);
