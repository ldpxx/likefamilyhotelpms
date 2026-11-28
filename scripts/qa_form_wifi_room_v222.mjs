import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/FORM_WIFI_ROOM_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const { chromium } = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);

const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'FormQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'FormQaOwn');
const authSa = authMod.getAuth(appSa);
const authOwn = authMod.getAuth(appOwn);
authMod.connectAuthEmulator(authSa, 'http://127.0.0.1:9099', { disableWarnings: true });
authMod.connectAuthEmulator(authOwn, 'http://127.0.0.1:9099', { disableWarnings: true });
const dbSa = fsMod.getFirestore(appSa);
fsMod.connectFirestoreEmulator(dbSa, '127.0.0.1', 8080);

const fullPerms = {
  canViewProfit: true, canEditPrice: true, canUndoAction: true, canManageStaff: true,
  canCleanupPhotos: true, canFullBackup: true, canEditFormTemplates: true, canManageConfig: true,
};

const saCred = await authMod.createUserWithEmailAndPassword(authSa, 'ducphuong84@gmail.com', 'DemoSa#2026');
await fsMod.setDoc(fsMod.doc(dbSa, 'system_meta', 'bootstrap'), {
  adminInitialized: true, superAdminUid: saCred.user.uid, ownerUid: saCred.user.uid,
  superAdminEmail: 'ducphuong84@gmail.com', initializedAt: new Date().toISOString(),
});
await fsMod.setDoc(fsMod.doc(dbSa, 'staff_users', saCred.user.uid), {
  uid: saCred.user.uid, username: 'ducphuong84', email: 'ducphuong84@gmail.com', fullName: 'SuperAdmin Gốc',
  phone: '', role: 'superadmin', authSource: 'firebase_superadmin', isActive: true,
  permissions: fullPerms, createdAt: new Date().toISOString(),
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

const todayIso = new Date().toISOString().slice(0, 10);
const [yy, mm, dd] = todayIso.split('-');
const todayVN = `${dd}/${mm}/${yy}`;
const nowIso = new Date().toISOString();

await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', 'bkg_hourly_202'), {
  id: 'bkg_hourly_202',
  bookingCode: 'LIK00990',
  bookingMode: 'hourly',
  hourlyHours: 2,
  checkIn: todayIso,
  checkOut: todayIso,
  nights: 0,
  primaryGuestId: 'g_h202',
  primaryGuestName: 'Khách Nghỉ Giờ',
  primaryGuestNormalizedName: 'khach nghi gio',
  primaryGuestPhone: '0900111222',
  primaryGuestIdNumber: '',
  occupants: [],
  occupantCount: 1,
  hasForeigner: false,
  hasPendingAsm: false,
  hasStayPermitAlert: false,
  isReturningGuest: false,
  source: 'walk_in',
  roomId: 'room_202',
  roomNumber: '202',
  floor: 'Tầng 2',
  roomTypeId: 'rt_dbl_balk',
  roomTypeName: 'Phòng Đôi',
  dailyRates: [{ date: todayIso, rate: 200000 }],
  grossRoomTotal: 200000,
  otaCommissionAmount: 0,
  netRoomTotal: 200000,
  serviceTotal: 20000,
  services: [
    { id: 'sv1', name: 'P.202 Nước suối', quantity: 1, unitPrice: 20000, total: 20000, category: 'drink', addedAt: nowIso, addedBy: 'owner_emu' },
  ],
  hourlySurcharge: 0,
  depositPaid: 0,
  guestPaid: 0,
  otaSettlementStatus: 'not_applicable',
  status: 'reserved',
  createdAt: nowIso,
  updatedAt: nowIso,
  createdBy: 'owner_emu',
});

const PORT = 4184;
const viteProc = spawn(
  process.execPath,
  [path.resolve(rootDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { cwd: rootDir, env: { ...process.env, VITE_USE_FIREBASE_EMULATOR: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] }
);
let ready = false;
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) { ready = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { viteProc.kill(); throw new Error('Vite failed to start'); }

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const consoleErrors = [];
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const paper = (page) => page.locator('.print-sheet-root').first();

async function login(page, mobile) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  await page.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('owner_emu');
  await page.locator('input[type="password"]').first().fill('OwnerEmu#2026');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForSelector(mobile ? 'header h1' : 'aside nav', { timeout: 20000 });
  await page.waitForTimeout(800);
}

async function gotoNav(page, mobile, label) {
  if (mobile) {
    await page.locator('header button:visible').first().click();
    await page.waitForTimeout(300);
    await page.locator('div.fixed button:visible').filter({ hasText: label }).first().click();
  } else {
    await page.locator('aside button:visible').filter({ hasText: label }).first().click();
  }
  await page.waitForTimeout(500);
}

async function runCustomizer(page, mobile, tag) {
  await gotoNav(page, mobile, 'Tùy chỉnh biểu mẫu');
  await page.waitForTimeout(1800); // let Firestore snapshots (hotel_config / form_templates) settle before editing
  await page.getByRole('button', { name: /2\. Hóa đơn/ }).click();
  await page.waitForSelector('[data-testid="wifi-editor"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="form-paper-room-charge-line"]', { timeout: 10000 });

  // 1. Label renamed
  const togglesText = await page.locator('label:has([data-testid="field-toggle-wifiInfo"])').innerText();
  check(togglesText.includes('Mật khẩu Wi-Fi') && !togglesText.includes('theo tầng'), `[${tag}] Wi-Fi label wrong: ${togglesText}`);
  const roomToggleText = await page.locator('label:has([data-testid="field-toggle-showRoomNumber"])').innerText();
  check(roomToggleText.includes('Hiển thị số phòng (VD: P.202)'), `[${tag}] room toggle label wrong: ${roomToggleText}`);

  // 2. Wi-Fi inputs -> live preview
  const wifiToggle = page.locator('[data-testid="field-toggle-wifiInfo"]');
  if (!(await wifiToggle.isChecked())) await wifiToggle.check();
  await page.locator('[data-testid="wifi-ssid-input"]').fill('QA Wifi ' + tag);
  await page.locator('[data-testid="wifi-password-input"]').fill('pw' + tag);
  check((await page.locator('[data-testid="wifi-display-input"]').inputValue()) === ('QA Wifi ' + tag + ' / pw' + tag), `[${tag}] display not auto-composed`);
  check((await paper(page).innerText()).includes(('QA Wifi ' + tag + ' / pw' + tag)), `[${tag}] preview missing composed wifi`);
  await page.locator('[data-testid="wifi-display-input"]').fill('Like Family Hotel / 88888888');
  check((await paper(page).innerText()).includes('Like Family Hotel / 88888888'), `[${tag}] preview missing direct display wifi`);
  check(!(await paper(page).innerText()).includes('LikeFamily_T'), `[${tag}] legacy per-floor wifi leaked`);

  // 3. Room number OFF by default
  const roomToggle = page.locator('[data-testid="field-toggle-showRoomNumber"]');
  check(!(await roomToggle.isChecked()), `[${tag}] room toggle should default OFF`);
  const offLine = (await page.locator('[data-testid="form-paper-room-charge-line"]').first().innerText()).replace(/\s+/g, ' ').trim();
  check(offLine === `Tiền phòng theo giờ (${todayVN} • 2 giờ)`, `[${tag}] OFF line wrong: "${offLine}"`);
  const offPaper = await paper(page).innerText();
  check(!/P\.?\s?202/.test(offPaper), `[${tag}] room number still visible when OFF`);

  // 4. Room number ON
  await roomToggle.check();
  const onLine = (await page.locator('[data-testid="form-paper-room-charge-line"]').first().innerText()).replace(/\s+/g, ' ').trim();
  check(onLine === `Tiền phòng theo giờ P.202 (${todayVN} • 2 giờ)`, `[${tag}] ON line wrong: "${onLine}"`);
  check((await paper(page).innerText()).includes('P.202'), `[${tag}] room number missing when ON`);
  await page.screenshot({ path: path.join(outDir, `${tag}_customizer_room_on.png`), fullPage: false });
  await roomToggle.uncheck();
  await page.screenshot({ path: path.join(outDir, `${tag}_customizer_room_off.png`), fullPage: false });
  return { offLine, onLine };
}

const results = {};
try {
  // ===== DESKTOP =====
  const dCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dPage = await dCtx.newPage();
  dPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[D] ${m.text()}`); });
  dPage.on('pageerror', (e) => consoleErrors.push(`[D] pageerror ${e.message}`));
  await login(dPage, false);
  results.desktop = await runCustomizer(dPage, false, 'desktop');

  // Save with room ON + shared wifi, then verify print modal from booking detail
  await dPage.locator('[data-testid="field-toggle-showRoomNumber"]').check();
  await dPage.getByRole('button', { name: /Lưu mẫu biểu mẫu/ }).click();
  await dPage.waitForTimeout(1200);

  async function openPrintFromDetail(page) {
    await gotoNav(page, false, 'Lịch Calendar');
    await page.waitForSelector('[data-testid="calendar-booking-bar-LIK00990"]', { timeout: 10000 });
    await page.locator('[data-testid="calendar-booking-bar-LIK00990"]').click();
    await page.waitForSelector('[data-testid="quick-preview-detail-btn"]', { timeout: 8000 });
    await page.locator('[data-testid="quick-preview-detail-btn"]').click();
    await page.waitForSelector('[data-testid="booking-detail-modal"]', { timeout: 8000 });
    await page.locator('[data-testid="booking-detail-tab-payment"]').click();
    await page.waitForSelector('[data-testid="detail-tab-payment-panel"]', { timeout: 5000 });
    await page.getByRole('button', { name: /Phiếu thanh toán/ }).click();
    await page.waitForSelector('[data-testid="form-paper-room-charge-line"]', { timeout: 8000 });
    return (await page.locator('[data-testid="form-paper-room-charge-line"]').last().innerText()).replace(/\s+/g, ' ').trim();
  }

  const printOn = await openPrintFromDetail(dPage);
  check(printOn.includes('P.202'), `[print] ON line missing room: ${printOn}`);
  const printOnPaper = await dPage.locator('.print-sheet-root').last().innerText();
  check(printOnPaper.includes('Like Family Hotel / 88888888'), '[print] shared wifi missing on printed paper');
  await dPage.screenshot({ path: path.join(outDir, 'desktop_print_room_on.png'), fullPage: false });
  await dPage.reload({ waitUntil: 'domcontentloaded' });
  await dPage.waitForSelector('aside nav', { timeout: 20000 });
  await dPage.waitForTimeout(600);

  // Turn OFF, save, re-open print
  await gotoNav(dPage, false, 'Tùy chỉnh biểu mẫu');
  await dPage.getByRole('button', { name: /2\. Hóa đơn/ }).click();
  await dPage.waitForSelector('[data-testid="field-toggle-showRoomNumber"]', { timeout: 8000 });
  await dPage.waitForFunction(
    () => document.querySelector('[data-testid="wifi-display-input"]')?.value === 'Like Family Hotel / 88888888',
    null,
    { timeout: 8000 }
  );
  await dPage.waitForTimeout(800);
  check(await dPage.locator('[data-testid="field-toggle-showRoomNumber"]').isChecked(), '[persist] room toggle ON was not persisted');
  check((await dPage.locator('[data-testid="wifi-display-input"]').inputValue()) === 'Like Family Hotel / 88888888', '[persist] wifi display not persisted');
  await dPage.locator('[data-testid="field-toggle-showRoomNumber"]').uncheck();
  await dPage.getByRole('button', { name: /Lưu mẫu biểu mẫu/ }).click();
  await dPage.waitForTimeout(1200);
  const printOff = await openPrintFromDetail(dPage);
  check(printOff === `Tiền phòng theo giờ (${todayVN} • 2 giờ)`, `[print] OFF line wrong: "${printOff}"`);
  const printOffPaper = await dPage.locator('.print-sheet-root').last().innerText();
  check(!/P\.?\s?202/.test(printOffPaper), '[print] room number leaked on printed paper when OFF (incl. service names)');
  await dPage.screenshot({ path: path.join(outDir, 'desktop_print_room_off.png'), fullPage: false });
  results.print = { printOn, printOff };
  await dCtx.close();

  // ===== MOBILE =====
  const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mPage = await mCtx.newPage();
  mPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[M] ${m.text()}`); });
  mPage.on('pageerror', (e) => consoleErrors.push(`[M] pageerror ${e.message}`));
  await login(mPage, true);
  results.mobile = await runCustomizer(mPage, true, 'mobile');
  const overflow = await mPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `[mobile] horizontal overflow ${overflow}px`);
  await mCtx.close();

  console.log('FORM_QA_RESULTS:', JSON.stringify(results, null, 2));
  console.log('CONSOLE_ERRORS:', consoleErrors.length, consoleErrors);
  if (consoleErrors.length) failures.push('console errors present');
  if (failures.length) throw new Error('FORM_QA_FAILURES:\n- ' + failures.join('\n- '));
  console.log('ALL_FORM_QA_CHECKS_PASSED');
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);

