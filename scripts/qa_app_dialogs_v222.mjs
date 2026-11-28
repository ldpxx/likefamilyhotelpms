import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/APP_DIALOGS_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const { chromium } = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);

const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'DlgQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'DlgQaOwn');
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

const PORT = 4185;
const viteProc = spawn(
  process.execPath,
  [path.resolve(rootDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { cwd: rootDir, env: { ...process.env, VITE_USE_FIREBASE_EMULATOR: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] }
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
  throw new Error('Vite failed to start');
}

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const nativeDialogsTriggered = [];
const consoleErrors = [];
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

async function loginAndOpenSettings(page, mobile) {
  page.on('dialog', async (d) => {
    nativeDialogsTriggered.push(`${d.type()}: ${d.message()}`);
    await d.dismiss();
  });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  await page.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('owner_emu');
  await page.locator('input[type="password"]').first().fill('OwnerEmu#2026');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForSelector(mobile ? 'header h1' : 'aside nav', { timeout: 20000 });
  await page.waitForTimeout(1500);

  if (mobile) {
    await page.locator('header button:visible').first().click();
    await page.waitForTimeout(300);
    await page.locator('div.fixed button:visible').filter({ hasText: 'Cài đặt & Sao lưu' }).first().click();
  } else {
    await page.locator('aside button:visible').filter({ hasText: 'Cài đặt & Sao lưu' }).first().click();
  }
  await page.waitForTimeout(600);
}

try {
  // === 1. DESKTOP 1440x900 ===
  const dCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dPage = await dCtx.newPage();
  dPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[D] ${m.text()}`); });
  dPage.on('pageerror', (e) => consoleErrors.push(`[D] pageerror ${e.message}`));

  await loginAndOpenSettings(dPage, false);
  await dPage.getByRole('button', { name: /Loại phòng, Giá ngày\/giờ & Phòng/ }).click();
  await dPage.waitForSelector('[data-testid^="edit-room-type-btn-"]', { timeout: 8000 });

  // A. RatePlanFormModal (Add -> Edit -> Delete via ConfirmDialog)
  await dPage.locator('[data-testid^="add-rate-plan-btn-"]').first().click();
  await dPage.waitForSelector('[data-testid="rate-plan-form-modal"]', { timeout: 5000 });
  await dPage.locator('[data-testid="rate-plan-name-input"]').fill('Giá Lễ Tết QA');
  await dPage.locator('[data-testid="rate-plan-price-input"]').fill('650000');
  const formattedRateVal = await dPage.locator('[data-testid="rate-plan-price-input"]').inputValue();
  check(formattedRateVal === '650.000', `[D] CurrencyInput thousand separator expected 650.000, got ${formattedRateVal}`);
  await dPage.screenshot({ path: path.join(outDir, 'desktop_rate_plan_modal.png'), fullPage: false });
  await dPage.locator('[data-testid="rate-plan-form-modal-submit-btn"]').click();
  await dPage.waitForTimeout(600);
  check((await dPage.locator('body').innerText()).includes('Giá Lễ Tết QA'), '[D] Added rate plan not visible');

  // Edit the newly added rate plan
  const editRateBtns = dPage.locator('[data-testid^="edit-rate-plan-btn-"]');
  await editRateBtns.nth((await editRateBtns.count()) - 1).click();
  await dPage.waitForSelector('[data-testid="rate-plan-form-modal"]', { timeout: 5000 });
  await dPage.locator('[data-testid="rate-plan-price-input"]').fill('680000');
  await dPage.locator('[data-testid="rate-plan-form-modal-submit-btn"]').click();
  await dPage.waitForTimeout(600);
  check((await dPage.locator('body').innerText()).includes('680.000'), '[D] Updated rate plan price not visible');

  // Delete the rate plan -> verify ConfirmDialog
  const delRateBtns = dPage.locator('[data-testid^="delete-rate-plan-btn-"]');
  await delRateBtns.nth((await delRateBtns.count()) - 1).click();
  await dPage.waitForSelector('[data-testid="confirm-delete-rate-plan-dialog"]', { timeout: 5000 });
  await dPage.screenshot({ path: path.join(outDir, 'desktop_confirm_delete_rate_plan.png'), fullPage: false });
  await dPage.locator('[data-testid="confirm-delete-rate-plan-dialog-confirm-btn"]').click();
  await dPage.waitForTimeout(600);

  // B. RoomTypeFormModal
  await dPage.locator('[data-testid^="edit-room-type-btn-"]').first().click();
  await dPage.waitForSelector('[data-testid="room-type-form-modal"]', { timeout: 5000 });
  await dPage.locator('[data-testid="room-type-hour1-input"]').fill('160000');
  await dPage.screenshot({ path: path.join(outDir, 'desktop_room_type_modal.png'), fullPage: false });
  await dPage.locator('[data-testid="room-type-form-modal-submit-btn"]').click();
  await dPage.waitForTimeout(600);
  check((await dPage.locator('body').innerText()).includes('160.000'), '[D] RoomType hourly price update not visible');

  // C. RoomFormModal
  await dPage.locator('[data-testid="edit-room-btn-201"]').click();
  await dPage.waitForSelector('[data-testid="room-form-modal"]', { timeout: 5000 });
  await dPage.locator('[data-testid="room-note-input"]').fill('Ban công hướng phố thoáng mát');
  await dPage.screenshot({ path: path.join(outDir, 'desktop_room_modal.png'), fullPage: false });
  await dPage.locator('[data-testid="room-form-modal-submit-btn"]').click();
  await dPage.waitForTimeout(600);
  check((await dPage.locator('body').innerText()).includes('Ban công hướng phố thoáng mát'), '[D] Room note update not visible');

  // D. ServiceCatalogFormModal
  await dPage.getByRole('button', { name: /Dịch vụ & Bảng giá/ }).click();
  await dPage.waitForSelector('[data-testid^="edit-service-btn-"]', { timeout: 8000 });
  await dPage.locator('[data-testid^="edit-service-btn-"]').first().click();
  await dPage.waitForSelector('[data-testid="service-catalog-form-modal"]', { timeout: 5000 });
  await dPage.locator('[data-testid="service-modal-price-input"]').fill('25000');
  await dPage.screenshot({ path: path.join(outDir, 'desktop_service_catalog_modal.png'), fullPage: false });
  await dPage.locator('[data-testid="service-catalog-form-modal-submit-btn"]').click();
  await dPage.waitForTimeout(600);

  await dCtx.close();

  // === 2. MOBILE 390x844 ===
  const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mPage = await mCtx.newPage();
  mPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[M] ${m.text()}`); });
  mPage.on('pageerror', (e) => consoleErrors.push(`[M] pageerror ${e.message}`));

  await loginAndOpenSettings(mPage, true);
  await mPage.getByRole('button', { name: /Loại phòng, Giá ngày\/giờ & Phòng/ }).click();
  await mPage.waitForSelector('[data-testid^="edit-room-type-btn-"]', { timeout: 8000 });

  // Verify mobile input font-size >= 16px inside RoomTypeFormModal & Android Back closes modal
  await mPage.locator('[data-testid^="edit-room-type-btn-"]').first().click();
  await mPage.waitForSelector('[data-testid="room-type-form-modal"]', { timeout: 5000 });
  const mobileInputFontPx = await mPage.evaluate(() => {
    const el = document.querySelector('[data-testid="room-type-name-input"]');
    return el ? parseFloat(window.getComputedStyle(el).fontSize) : 0;
  });
  check(mobileInputFontPx >= 16, `[M] Mobile input font-size must be >= 16px to prevent zoom, got ${mobileInputFontPx}px`);
  await mPage.screenshot({ path: path.join(outDir, 'mobile_room_type_modal.png'), fullPage: false });

  // Close modal via Android physical Back button
  await mPage.evaluate(() => window.history.back());
  await mPage.waitForTimeout(400);
  check((await mPage.locator('[data-testid="room-type-form-modal"]').count()) === 0, '[M] Android Back did not close AppModal');

  // Open Kênh OTA & Nguồn khách -> test ConfirmDialog on Mobile
  await mPage.getByRole('button', { name: /Kênh OTA & Nguồn khách/ }).click();
  await mPage.getByRole('button', { name: /Khôi phục danh mục nguồn mặc định/ }).click();
  await mPage.waitForSelector('[data-testid="confirm-restore-sources-dialog"]', { timeout: 5000 });
  await mPage.screenshot({ path: path.join(outDir, 'mobile_confirm_dialog.png'), fullPage: false });
  await mPage.locator('[data-testid="confirm-restore-sources-dialog-confirm-btn"]').click();
  await mPage.waitForTimeout(600);

  const mobileOverflow = await mPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(mobileOverflow <= 0, `[M] Horizontal overflow ${mobileOverflow}px`);
  await mCtx.close();

  check(nativeDialogsTriggered.length === 0, `Native browser dialogs triggered: ${JSON.stringify(nativeDialogsTriggered)}`);
  check(consoleErrors.length === 0, `Console errors: ${JSON.stringify(consoleErrors)}`);

  console.log('DIALOG_QA_SUMMARY:', JSON.stringify({
    nativeDialogsCount: nativeDialogsTriggered.length,
    consoleErrorsCount: consoleErrors.length,
    mobileInputFontPx,
    failuresCount: failures.length,
  }, null, 2));

  if (failures.length > 0) {
    throw new Error('DIALOG_QA_FAILURES:\n- ' + failures.join('\n- '));
  }
  console.log('ALL_APP_DIALOG_QA_CHECKS_PASSED');
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);
