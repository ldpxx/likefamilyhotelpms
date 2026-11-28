import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/HYDRATION_SLOW3G_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const { chromium } = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);

const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'HydQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'HydQaOwn');
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

// Seed real 15 rooms (P.201 - P.503), room_types, hotel_config, form_templates from pre-golive backup
const backup = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'backups/firestore_backup_pre_golive_2026-11-28.json'), 'utf8'));
for (const col of ['hotel_config', 'form_templates', 'room_types']) {
  for (const [docId, data] of Object.entries(backup.collections[col] || {})) {
    await fsMod.setDoc(fsMod.doc(dbSa, col, docId), data);
  }
}
const activeRoomNumbers = ['201', '202', '203', '204', '301', '302', '303', '304', '401', '402', '403', '404', '501', '502', '503'];
for (let idx = 0; idx < activeRoomNumbers.length; idx++) {
  const num = activeRoomNumbers[idx];
  const floor = `Tầng ${num[0]}`;
  const isSingle = ['203', '303', '403', '502'].includes(num);
  await fsMod.setDoc(fsMod.doc(dbSa, 'rooms', `room_${num}`), {
    id: `room_${num}`,
    roomNumber: num,
    floor,
    roomTypeId: isSingle ? 'rt_std_single' : 'rt_dbl_balk',
    roomTypeName: isSingle ? 'Phòng Đơn Tiêu Chuẩn' : 'Phòng Đôi Có Ban Công',
    hkStatus: 'clean',
    currentBookingId: null,
    isActive: true,
    sortOrder: idx + 1,
  });
}

const PORT = 4186;
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

const consoleErrors = [];
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

async function runSlow3GLoginTest(viewport, tag) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${tag}] pageerror ${e.message}`));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });

  // Enable CDP Slow 3G network emulation + artificial latency on Firestore Listen streams
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 350, // Slow 3G RTT latency
    downloadThroughput: (400 * 1024) / 8, // 400 kbps
    uploadThroughput: (200 * 1024) / 8,
    connectionType: 'cellular3g',
  });

  // Also delay Firestore Listen/channel responses by 1600ms so we deterministically observe the Hydration Progress Screen
  let delayFirestore = true;
  await page.route('http://127.0.0.1:8080/**', async (route) => {
    if (delayFirestore && route.request().url().includes('Listen')) {
      await new Promise((r) => setTimeout(r, 1600));
    }
    await route.continue();
  });

  await page.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('owner_emu');
  await page.locator('input[type="password"]').first().fill('OwnerEmu#2026');
  await page.locator('button[type="submit"]').first().click();

  let sawHydrationScreen = false;
  let sawSeedText = false;
  let capturedHydrationInfo = null;

  // Poll every 80ms during slow-3G login & hydration
  for (let i = 0; i < 120; i++) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/Tạo dữ liệu mẫu|Khởi tạo dữ liệu mẫu/i.test(bodyText)) {
      sawSeedText = true;
    }
    const hydCount = await page.locator('[data-testid="hydration-loading-screen"]').count();
    if (hydCount > 0 && !sawHydrationScreen) {
      sawHydrationScreen = true;
      capturedHydrationInfo = {
        title: await page.locator('[data-testid="hydration-title"]').innerText().catch(() => ''),
        timer: await page.locator('[data-testid="hydration-timer"]').innerText().catch(() => ''),
        pct: await page.locator('[data-testid="hydration-progress-pct"]').innerText().catch(() => ''),
        stepsCount: await page.locator('[data-testid^="hydration-step-"]').count(),
      };
      await page.screenshot({ path: path.join(outDir, `${tag}_hydration_loading.png`), fullPage: false });
      delayFirestore = false;
    }

    // Check if Hydration Gate has finished and main view with all 15 room cards has rendered
    const cardCnt = await page.locator('[data-testid^="room-grid-card-"]').count();
    if (hydCount === 0 && sawHydrationScreen && cardCnt === 15) {
      break;
    }
    await page.waitForTimeout(80);
  }

  // Restore fast network & verify hydration screen detaches and all 15 rooms render
  delayFirestore = false;
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page.waitForSelector('[data-testid="hydration-loading-screen"]', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('[data-testid="room-grid-card-201"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="room-grid-card-503"]', { timeout: 15000 });
  await page.waitForTimeout(400);

  const finalBodyText = await page.locator('body').innerText();
  if (/Tạo dữ liệu mẫu|Khởi tạo dữ liệu mẫu/i.test(finalBodyText)) {
    sawSeedText = true;
  }

  const visibleRoomCount = await page.locator('[data-testid^="room-grid-card-"]').count();
  await page.screenshot({ path: path.join(outDir, `${tag}_hydrated_15_rooms.png`), fullPage: false });
  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  check(!sawSeedText, `[${tag}] "Tạo/Khởi tạo dữ liệu mẫu" appeared during slow network login!`);
  check(sawHydrationScreen, `[${tag}] Hydration loading screen was not displayed during Slow 3G load`);
  check(capturedHydrationInfo?.stepsCount === 5, `[${tag}] Expected 5 hydration steps, got ${capturedHydrationInfo?.stepsCount}`);
  check(visibleRoomCount === 15, `[${tag}] Expected all 15 rooms (P.201-P.503) after hydration, got ${visibleRoomCount}`);
  check(overflowPx <= 0, `[${tag}] Horizontal overflow ${overflowPx}px`);

  await ctx.close();
  return {
    sawHydrationScreen,
    sawSeedText,
    capturedHydrationInfo,
    visibleRoomCount,
    overflowPx,
  };
}

const summary = {};
try {
  summary.mobile = await runSlow3GLoginTest({ width: 390, height: 844 }, 'mobile');
  summary.desktop = await runSlow3GLoginTest({ width: 1440, height: 900 }, 'desktop');

  check(consoleErrors.length === 0, `Console errors: ${JSON.stringify(consoleErrors)}`);
  console.log('HYDRATION_QA_SUMMARY:', JSON.stringify(summary, null, 2));
  console.log('CONSOLE_ERRORS:', consoleErrors.length, consoleErrors);

  if (failures.length > 0) {
    throw new Error('HYDRATION_QA_FAILURES:\n- ' + failures.join('\n- '));
  }
  console.log('ALL_HYDRATION_SLOW3G_QA_CHECKS_PASSED');
} finally {
  await browser.close();
  viteProc.kill();
}
process.exit(0);
