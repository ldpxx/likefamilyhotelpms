import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/IMAGE_UPLOAD_UX_v2.2.2');
fs.mkdirSync(outDir, { recursive: true });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfpms-upload-qa-'));

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const pwMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);
const { chromium } = pwMod;

// 1. Seed Firebase Local Emulator (ZERO touch on live production!)
const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'UploadQaSa');
const appOwn = appMod.initializeApp(emuConfig, 'UploadQaOwn');
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
await fsMod.setDoc(fsMod.doc(dbSa, 'hotel_config', 'main'), { hotelLogoBase64: '' }, { merge: true });

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
await fsMod.setDoc(fsMod.doc(dbSa, 'bookings', 'bkg_upload_qa_1'), {
  id: 'bkg_upload_qa_1',
  bookingCode: 'UPL-201',
  roomId: 'room_201',
  roomName: '201',
  roomTypeId: 'rt_dbl_balk',
  roomTypeName: 'Phòng Đôi Ban Công',
  guestId: 'guest_upl_1',
  guestName: 'Nguyễn Minh Quân',
  guestPhone: '0905123456',
  bookingMode: 'overnight',
  status: 'in_house',
  source: 'walk_in',
  checkIn: today,
  checkOut: tomorrow,
  nights: 2,
  roomRate: 550000,
  totalRoomCharge: 1100000,
  totalServiceCharge: 0,
  surcharge: 0,
  discount: 0,
  totalAmount: 1100000,
  paidAmount: 500000,
  depositAmount: 500000,
  paymentStatus: 'partial',
  dailyRates: [{ date: today, price: 550000 }],
  services: [],
  occupants: [
    {
      occupantId: 'occ_upl_1',
      guestId: 'guest_upl_1',
      guestCategory: 'vietnamese',
      fullName: 'Nguyễn Minh Quân',
      phone: '0905123456',
      gender: 'Nam',
      dob: '1992-05-12',
      nationality: 'Việt Nam',
      idType: 'cccd',
      idNumber: '048092001234',
      visaNumber: '',
      idIssueDate: '2022-04-10',
      address: 'Đà Nẵng',
      entryDate: '',
      stayPermitExpiryDate: '',
      asmStatus: 'not_applicable',
      isPrimary: true,
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// 2. Start Vite dev server against Emulator
const PORT = 4177;
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

// Generate realistic high-res sample test images via headless browser Canvas so they exercise full Canvas compression
async function generateSampleImages() {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const data = await p.evaluate(() => {
    const makeImg = (w, h, bg, title, sub, transparent = false) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (!transparent) {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
      }
      g.fillStyle = '#0F5132';
      g.fillRect(40, 40, w - 80, 90);
      g.fillStyle = '#FFFFFF';
      g.font = 'bold 42px sans-serif';
      g.fillText(title, 70, 100);
      g.fillStyle = '#1C1B18';
      g.font = '28px monospace';
      g.fillText(sub, 70, 210);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = i % 2 === 0 ? '#D97706' : '#1B5E4B';
        g.fillRect(70 + (i * 35) % (w - 140), 280 + Math.floor(i / 10) * 60, 24, 24);
      }
      return c.toDataURL('image/png').split(',')[1];
    };
    return {
      front: makeImg(1600, 1000, '#F3F7F4', 'CCCD FRONT — SAMPLE', 'ID: 048092001234 | NGUYEN MINH QUAN'),
      back: makeImg(1600, 1000, '#FAF6EE', 'CCCD BACK — SAMPLE', 'ISSUE DATE: 10/04/2022 | DA NANG'),
      stamp: makeImg(1600, 1000, '#EEF2F8', 'VIETNAM ENTRY STAMP', 'ENTRY: 20/11/2026 | PERMIT: 20/12/2026'),
      logo: makeImg(600, 240, '#FFFFFF', 'LIKE FAMILY', 'HOTEL PMS', true),
    };
  });
  await ctx.close();
  const paths = {
    front: path.join(tmpDir, 'sample_cccd_front.png'),
    back: path.join(tmpDir, 'sample_cccd_back.png'),
    stamp: path.join(tmpDir, 'sample_entry_stamp.png'),
    logo: path.join(tmpDir, 'sample_hotel_logo.png'),
  };
  fs.writeFileSync(paths.front, Buffer.from(data.front, 'base64'));
  fs.writeFileSync(paths.back, Buffer.from(data.back, 'base64'));
  fs.writeFileSync(paths.stamp, Buffer.from(data.stamp, 'base64'));
  fs.writeFileSync(paths.logo, Buffer.from(data.logo, 'base64'));
  return paths;
}

const sampleImgs = await generateSampleImages();
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

  // Navigate to Bookings list and open our booking modal
  await navigateTo('Đơn, Đoàn & ASM');
  await page.waitForSelector('text=UPL-201', { timeout: 15000 });
  await page.locator('text=UPL-201').first().click();
  await page.waitForSelector('text=Khách lưu trú', { timeout: 10000 });
  await page.getByRole('button', { name: /Khách lưu trú/i }).first().click();
  await page.waitForSelector('[data-testid="guest-doc-multi-upload-input"]', { state: 'attached', timeout: 10000 });

  // 1. Audit DOM attributes of all <input type="file"> in OccupantOcrPanel
  const ocrInputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[type="file"]')).map((el) => ({
      testId: el.getAttribute('data-testid'),
      accept: el.getAttribute('accept'),
      capture: el.getAttribute('capture'),
      multiple: el.hasAttribute('multiple'),
      value: el.value,
    }))
  );

  const multiInput = ocrInputs.find((i) => i.testId === 'guest-doc-multi-upload-input');
  if (!multiInput || multiInput.capture !== null || !multiInput.multiple || multiInput.accept !== 'image/*') {
    throw new Error(`[${viewportName}] Multi-upload input invalid: ${JSON.stringify(multiInput)}`);
  }
  const frontGallery = ocrInputs.find((i) => i.testId === 'photo-gallery-input-front' || i.testId === 'photo-replace-gallery-input-front');
  if (!frontGallery || frontGallery.capture !== null || frontGallery.accept !== 'image/*') {
    throw new Error(`[${viewportName}] Front gallery input invalid: ${JSON.stringify(frontGallery)}`);
  }

  // 2. Test multi-file upload (2 files at once for Vietnamese CCCD)
  await page.locator('[data-testid="guest-doc-multi-upload-input"]').setInputFiles([sampleImgs.front, sampleImgs.back]);
  await page.waitForSelector('[data-testid="photo-preview-front"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="photo-preview-back"]', { timeout: 10000 });

  const multiValueAfter = await page.locator('[data-testid="guest-doc-multi-upload-input"]').inputValue();
  if (multiValueAfter !== '') {
    throw new Error(`[${viewportName}] Multi-upload input was not reset to empty string`);
  }

  // Check replacement gallery inputs have NO capture attribute
  const replaceInputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[type="file"]')).map((el) => ({
      testId: el.getAttribute('data-testid'),
      capture: el.getAttribute('capture'),
      accept: el.getAttribute('accept'),
    }))
  );
  const frontReplaceGallery = replaceInputs.find((i) => i.testId === 'photo-replace-gallery-input-front');
  if (!frontReplaceGallery || frontReplaceGallery.capture !== null) {
    throw new Error(`[${viewportName}] Replace gallery input has capture lock: ${JSON.stringify(frontReplaceGallery)}`);
  }

  // 3. Switch to Foreigner (3 slots) & upload 3 images at once + re-upload single slot
  await page.getByRole('button', { name: /Khách Nước ngoài/i }).click();
  await page.locator('[data-testid="guest-doc-multi-upload-input"]').setInputFiles([
    sampleImgs.front,
    sampleImgs.back,
    sampleImgs.stamp,
  ]);
  await page.waitForSelector('[data-testid="photo-preview-stamp"]', { timeout: 10000 });

  // Re-select same file on slot 1 via gallery input (verifies e.target.value = '' reset works)
  await page.locator('[data-testid="photo-replace-gallery-input-front"]').setInputFiles(sampleImgs.front);
  await page.waitForTimeout(400);
  const singleValueAfter = await page.locator('[data-testid="photo-replace-gallery-input-front"]').inputValue();
  if (singleValueAfter !== '') {
    throw new Error(`[${viewportName}] Single gallery input was not reset to empty string`);
  }

  // Verify compressed sizes in UI & save to Firestore Emulator
  const sizeTexts = {
    front: await page.locator('[data-testid="photo-size-front"]').textContent(),
    back: await page.locator('[data-testid="photo-size-back"]').textContent(),
    stamp: await page.locator('[data-testid="photo-size-stamp"]').textContent(),
  };

  await page.screenshot({ path: path.join(outDir, `${viewportName}_occupant_ocr.png`), fullPage: false });

  await page.getByRole('button', { name: /Lưu hồ sơ & ảnh giấy tờ/i }).click();
  await page.waitForSelector('text=Đã lưu hồ sơ khách lưu trú', { timeout: 10000 });

  // Verify persisted guest_documents in Emulator (< 150 KB each)
  const gdSnap = await fsMod.getDocs(fsMod.collection(dbSa, 'guest_documents'));
  if (gdSnap.empty) throw new Error(`[${viewportName}] guest_documents was not persisted!`);
  const gdData = gdSnap.docs[0].data();
  const byteSize = (b64) => (b64 ? Math.round(((b64.includes(',') ? b64.split(',')[1] : b64).length * 3) / 4) : 0);
  const storedBytes = {
    front: byteSize(gdData.frontImageBase64),
    back: byteSize(gdData.backImageBase64),
    stamp: byteSize(gdData.entryStampImageBase64),
  };
  for (const [k, b] of Object.entries(storedBytes)) {
    if (b <= 0 || b >= 150 * 1024) {
      throw new Error(`[${viewportName}] Stored image ${k} out of range: ${b} bytes`);
    }
  }

  // Close booking modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closeBtn = page.locator('div.fixed.inset-0 button').first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await page.locator('div.fixed.inset-0 button:has(svg.lucide-x)').first().click().catch(() => {});
  }
  await page.waitForTimeout(300);

  // 4. Navigate to Settings & Admin View -> test Hotel Logo upload
  await navigateTo('Cài đặt & Sao lưu');
  await page.waitForSelector('[data-testid="hotel-logo-upload-input"]', { state: 'attached', timeout: 10000 });

  const logoInputAttrs = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="hotel-logo-upload-input"]');
    return el
      ? { accept: el.getAttribute('accept'), capture: el.getAttribute('capture'), value: el.value }
      : null;
  });
  if (!logoInputAttrs || logoInputAttrs.capture !== null || !logoInputAttrs.accept?.includes('image/*')) {
    throw new Error(`[${viewportName}] Logo input invalid: ${JSON.stringify(logoInputAttrs)}`);
  }

  await page.locator('[data-testid="hotel-logo-upload-input"]').setInputFiles(sampleImgs.logo);
  await page.waitForSelector('[data-testid="settings-hotel-logo-preview"]', { timeout: 10000 });
  await page.waitForTimeout(500);

  const logoValueAfter = await page.locator('[data-testid="hotel-logo-upload-input"]').inputValue();
  if (logoValueAfter !== '') {
    throw new Error(`[${viewportName}] Logo input was not reset to empty string`);
  }

  const cfgSnap = await fsMod.getDoc(fsMod.doc(dbSa, 'hotel_config', 'main'));
  const savedLogo = cfgSnap.data()?.hotelLogoBase64 || '';
  if (!savedLogo.startsWith('data:image/') || savedLogo.length >= 60000) {
    throw new Error(`[${viewportName}] Saved hotel logo invalid or too large (${savedLogo.length} chars)`);
  }

  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: path.join(outDir, `${viewportName}_hotel_logo.png`), fullPage: false });

  await context.close();

  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(
      `[${viewportName}] Console/Page errors detected: console=${JSON.stringify(consoleErrors)}, page=${JSON.stringify(pageErrors)}`
    );
  }

  results.push({
    viewport: `${viewportName} (${viewport.width}x${viewport.height})`,
    ocrInputsChecked: ocrInputs.length,
    galleryInputsLockedByCapture: ocrInputs.filter((i) => i.testId?.includes('gallery') && i.capture !== null).length,
    multiUploadSupported: true,
    sizeTexts,
    storedBytes,
    logoSavedChars: savedLogo.length,
    logoCaptureAttr: logoInputAttrs.capture,
    horizontalOverflowPx: overflowPx,
    consoleErrors: 0,
    pageErrors: 0,
    status: 'PASS',
  });
}

try {
  await runScenario('desktop', { width: 1440, height: 900 });
  await runScenario('mobile', { width: 390, height: 844 });
  console.log('QA_IMAGE_UPLOAD_UX_RESULTS:', JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  viteProc.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
process.exit(0);
