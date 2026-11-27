import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'QA_REPORTS/UI_UX_AUDIT_v2.2.2');
const shotsDir = path.join(outDir, 'screenshots');
fs.mkdirSync(shotsDir, { recursive: true });

const appMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/app/dist/index.mjs')).href);
const authMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/auth/dist/index.mjs')).href);
const fsMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/firebase/firestore/dist/index.mjs')).href);
const pwMod = await import(pathToFileURL(path.resolve(rootDir, 'node_modules/playwright-core/index.mjs')).href);
const { chromium } = pwMod;

// 1. Seed Firebase Local Emulator from backups/firestore_backup_pre_v2.2.2_2026-11-27.json (ZERO touch on live!)
const emuConfig = { apiKey: 'demo-api-key', authDomain: 'likefamilypms.firebaseapp.com', projectId: 'likefamilypms' };
const appSa = appMod.initializeApp(emuConfig, 'UxAuditSa');
const appOwn = appMod.initializeApp(emuConfig, 'UxAuditOwn');
const authSa = authMod.getAuth(appSa);
const authOwn = authMod.getAuth(appOwn);
authMod.connectAuthEmulator(authSa, 'http://127.0.0.1:9099', { disableWarnings: true });
authMod.connectAuthEmulator(authOwn, 'http://127.0.0.1:9099', { disableWarnings: true });
const dbSa = fsMod.getFirestore(appSa);
fsMod.connectFirestoreEmulator(dbSa, '127.0.0.1', 8080);

const saCred = await authMod.createUserWithEmailAndPassword(authSa, 'ducphuong84@gmail.com', 'DemoSa#2026');
const fullPerms = {
  canViewFinance: true, canViewProfit: true, canCreateBooking: true, canCheckInOut: true, canCancelBooking: true,
  canManageHousekeeping: true, canManageOta: true, canManageConfig: true, canManageStaff: true,
  canExportReports: true, canCollectPayment: true, canAddExpense: true, canEditPrice: true, canUndoAction: true,
};
await fsMod.setDoc(fsMod.doc(dbSa, 'system_meta', 'bootstrap'), {
  adminInitialized: true, superAdminUid: saCred.user.uid, ownerUid: saCred.user.uid,
  superAdminEmail: 'ducphuong84@gmail.com', initializedAt: new Date().toISOString(),
});
await fsMod.setDoc(fsMod.doc(dbSa, 'staff_users', saCred.user.uid), {
  uid: saCred.user.uid, username: 'ducphuong84', email: 'ducphuong84@gmail.com',
  fullName: 'SuperAdmin Gốc', phone: '', role: 'superadmin', authSource: 'firebase_superadmin',
  isActive: true, permissions: fullPerms, createdAt: new Date().toISOString(),
});
const ownCred = await authMod.createUserWithEmailAndPassword(authOwn, 'qa_runner@likefamilyhotel.com', 'QaRunner@2026');
await fsMod.setDoc(fsMod.doc(dbSa, 'staff_users', ownCred.user.uid), {
  uid: ownCred.user.uid, username: 'qa_runner', email: 'qa_runner@likefamilyhotel.com',
  fullName: 'QA Staging Runner', phone: '0900000099', role: 'owner', authSource: 'firebase_staff',
  isActive: true, mustChangePassword: false, permissions: fullPerms, createdAt: new Date().toISOString(),
});

const backup2m = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'backups/firestore_backup_pre_v2.2.2_2026-11-27.json'), 'utf8'));
const COLS = ['hotel_config', 'form_templates', 'room_types', 'rooms', 'guests', 'booking_groups', 'bookings', 'room_maintenances', 'ota_payout_batches', 'ota_adjustments', 'post_checkout_adjustments', 'shift_handovers', 'transactions', 'audit_logs'];
const queue = [];
for (const col of COLS) {
  for (const [docId, data] of Object.entries(backup2m.collections[col] || {})) queue.push({ col, docId, data });
}
for (let i = 0; i < queue.length; i += 350) {
  const b = fsMod.writeBatch(dbSa);
  for (const it of queue.slice(i, i + 350)) b.set(fsMod.doc(dbSa, it.col, it.docId), it.data);
  await b.commit();
}
// Emulator-only sample VietQR bank account so Playwright tests live VietQR rendering & 0đ auto-hide (NEVER touches live!)
await fsMod.updateDoc(fsMod.doc(dbSa, 'hotel_config', 'main'), {
  bankAccount: { bankId: 'MB', accountNo: '0901234567', accountName: 'LE DUC PHUONG' },
});
console.log(`UX_AUDIT_EMU_SEEDED: ${queue.length} docs (with Emulator VietQR test account)`);

// 2. Start Vite dev server against Local Emulator
const PORT = 4175;
const viteProc = spawn(process.execPath, [path.resolve(rootDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: rootDir,
  env: { ...process.env, VITE_USE_FIREBASE_EMULATOR: 'true' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let ready = false;
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) { ready = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { viteProc.kill(); throw new Error('Vite server failed to start'); }

// Geometric DOM Auditor function injected into browser
async function auditGeometry(page, label, viewportWidth) {
  return page.evaluate(({ label, viewportWidth }) => {
    const isMobileOrTablet = viewportWidth <= 768;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const horizontalOverflow = document.documentElement.scrollWidth > vw + 4;

    const smallButtons = [];
    const occludedButtons = [];
    const crampedButtonPairs = [];
    const smallTexts = [];
    const clippedElements = [];

    // Scope checks to top-most active modal when a modal/drawer is open (avoid false occlusion of elements under backdrop)
    const modals = Array.from(document.querySelectorAll('div.fixed.inset-0')).filter((el) => {
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden';
    });
    const scopeRoot = modals.length > 0 ? modals[modals.length - 1] : document;

    const visibleEls = Array.from(scopeRoot.querySelectorAll('button, a, input, select')).filter((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      // Ignore elements scrolled outside their own overflow-y-auto scroll container (e.g. behind sticky modal footer)
      let p = el.parentElement;
      while (p && p !== document.body) {
        const pst = window.getComputedStyle(p);
        if (pst.overflowY === 'auto' || pst.overflowY === 'scroll') {
          const pr = p.getBoundingClientRect();
          if (r.bottom > pr.bottom - 2 || r.top < pr.top + 2) return false;
        }
        p = p.parentElement;
      }
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    });

    const buttons = visibleEls.filter((el) => el.tagName === 'BUTTON');
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      const text = (btn.innerText || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40);

      // Touch target check on Mobile/Tablet (primary interactive buttons < 40px height or width)
      if (isMobileOrTablet && (r.height < 40 || r.width < 40)) {
        smallButtons.push({ text, w: Math.round(r.width), h: Math.round(r.height) });
      }

      // Occlusion check via elementFromPoint at center
      const cx = Math.min(vw - 2, Math.max(2, r.left + r.width / 2));
      const cy = Math.min(vh - 2, Math.max(2, r.top + r.height / 2));
      const topEl = document.elementFromPoint(cx, cy);
      if (topEl && topEl !== btn && !btn.contains(topEl) && !topEl.contains(btn)) {
        const topStyle = window.getComputedStyle(topEl);
        if (topStyle.pointerEvents !== 'none') {
          occludedButtons.push({
            text,
            occludedBy: `${topEl.tagName.toLowerCase()}.${String(topEl.className || '').slice(0, 40)}`,
          });
        }
      }

      // Right-edge viewport clip
      if (r.right > vw + 4) {
        clippedElements.push({ tag: 'button', text, right: Math.round(r.right), vw });
      }
    }

    // Sibling spacing check on Mobile/Tablet (< 8px gap between adjacent horizontal buttons in same parent)
    if (isMobileOrTablet) {
      for (let i = 0; i < buttons.length; i++) {
        for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i];
          const b = buttons[j];
          if (a.parentElement !== b.parentElement) continue;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const sameRow = Math.abs(ra.top - rb.top) < 12;
          if (sameRow) {
            const gap = rb.left >= ra.right ? rb.left - ra.right : ra.left >= rb.right ? ra.left - rb.right : -1;
            if (gap >= 0 && gap < 7.5) {
              crampedButtonPairs.push({
                a: (a.innerText || '').trim().slice(0, 20),
                b: (b.innerText || '').trim().slice(0, 20),
                gap: Math.round(gap * 10) / 10,
              });
            }
          }
        }
      }
    }

    // Font size check (< 12px on visible content text)
    const textNodes = Array.from(scopeRoot.querySelectorAll('p, span, td, th, label, div, button')).filter((el) => {
      if (el.children.length > 0) return false;
      const t = (el.textContent || '').trim();
      if (!t || t.length < 2) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
    });
    for (const el of textNodes) {
      const fs = parseFloat(window.getComputedStyle(el).fontSize || '14');
      if (fs < 11.9) {
        smallTexts.push({ text: (el.textContent || '').trim().slice(0, 35), fontSize: fs });
      }
    }

    return {
      label,
      viewport: `${vw}x${vh}`,
      horizontalOverflow,
      scrollWidth: document.documentElement.scrollWidth,
      occludedCount: occludedButtons.length,
      occludedSample: occludedButtons.slice(0, 6),
      smallButtonCount: smallButtons.length,
      smallButtonSample: smallButtons.slice(0, 8),
      crampedPairCount: crampedButtonPairs.length,
      crampedPairSample: crampedButtonPairs.slice(0, 6),
      smallTextCount: smallTexts.length,
      smallTextSample: smallTexts.slice(0, 8),
      clippedCount: clippedElements.length,
      clippedSample: clippedElements.slice(0, 6),
    };
  }, { label, viewportWidth });
}

const report = {
  executedAt: new Date().toISOString(),
  viewports: ['1440x900', '768x1024', '390x844', '360x800'],
  geometryAudits: [],
  specialChecks: {},
  consoleErrors: [],
  pageErrors: [],
};

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => report.pageErrors.push(e.message));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  await page.locator('input[type="text"], input[placeholder*="Tên đăng nhập"]').first().fill('qa_runner');
  await page.locator('input[type="password"]').first().fill('QaRunner@2026');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  await page.waitForTimeout(2000);

  // --- PART 1: 4 Viewports across Room Grid, Dashboard, Bookings, Finance ---
  const viewports = [
    { name: 'desktop_1440', width: 1440, height: 900 },
    { name: 'tablet_768', width: 768, height: 1024 },
    { name: 'mobile_390', width: 390, height: 844 },
    { name: 'mobile_360', width: 360, height: 800 },
  ];

  const views = [
    { id: 'rooms', label: 'Sơ đồ phòng' },
    { id: 'dashboard', label: 'Tổng quan' },
    { id: 'bookings', label: 'Đơn, Đoàn & ASM' },
    { id: 'finance', label: 'Tài chính & P&L' },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);
    for (const v of views) {
      // Navigate via visible sidebar or mobile drawer button
      let navBtn = page.locator('aside button:visible').filter({ hasText: v.label }).first();
      if (!(await navBtn.isVisible().catch(() => false))) {
        await page.locator('header button:visible').first().click().catch(() => {});
        await page.waitForTimeout(350);
        navBtn = page.locator('div.fixed button:visible').filter({ hasText: v.label }).first();
      }
      await navBtn.click();
      await page.waitForTimeout(700);
      const res = await auditGeometry(page, `${vp.name}_${v.id}`, vp.width);
      report.geometryAudits.push(res);
      if (v.id === 'rooms' || (vp.name === 'mobile_360' && v.id === 'finance')) {
        await page.screenshot({ path: path.join(shotsDir, `${vp.name}_${v.id}.png`), fullPage: false });
      }
    }
  }

  // --- PART 2: SPECIAL CHECK A — VietQR (Unpaid balance > 0 on Desktop & Mobile 360, AND Paid balance === 0!) ---
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('aside button', { hasText: 'Sơ đồ phòng' }).first().click();
  await page.waitForTimeout(800);

  // Open room 201 in-house card (Trần Tuấn Khang — Còn lại 1.080.000đ)
  const unpaidCard = page.locator('div.cursor-pointer, button').filter({ hasText: 'Trần Tuấn Khang' }).first();
  await unpaidCard.click();
  await page.waitForTimeout(900);

  // Click "Hiện VietQR" button inside BookingDetailModal if present
  const showQrBtn = page.locator('button', { hasText: 'Hiện VietQR' }).first();
  if (await showQrBtn.isVisible().catch(() => false)) {
    await showQrBtn.click();
    await page.waitForTimeout(500);
  }
  const vietQrUnpaidDesktop = await page.evaluate(() => {
    const img = document.querySelector('img[src*="vietqr.io"], img[alt*="VietQR"]');
    const r = img ? img.getBoundingClientRect() : null;
    const bodyText = document.body.innerText;
    return {
      found: Boolean(img),
      src: img ? img.getAttribute('src') : null,
      width: r ? Math.round(r.width) : 0,
      height: r ? Math.round(r.height) : 0,
      hasAmountParam: Boolean(img?.getAttribute('src')?.includes('amount=')),
      hasAddInfoParam: Boolean(img?.getAttribute('src')?.includes('addInfo=')),
      drawerVisible: bodyText.includes('Khách cần thanh toán tại quầy'),
    };
  });
  await page.screenshot({ path: path.join(shotsDir, 'special_vietqr_desktop.png'), fullPage: false });

  // Also check VietQR & BookingDetailModal on Mobile 360x800
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(500);
  const vietQrUnpaidMobile360 = await auditGeometry(page, 'mobile_360_booking_detail_vietqr', 360);
  report.geometryAudits.push(vietQrUnpaidMobile360);
  await page.screenshot({ path: path.join(shotsDir, 'special_vietqr_mobile360.png'), fullPage: false });

  // --- PART 3: SPECIAL CHECK B — Guest Registration & Base64 Photo Modal on 360px & 390px ---
  const occTabBtn = page.locator('button', { hasText: 'AI OCR' }).first();
  await occTabBtn.click();
  await page.waitForTimeout(600);
  // Upload a tiny valid PNG into first file input (CCCD front) to test Base64 preview inside 360px modal
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
  const fileInputs = page.locator('input[type="file"]');
  let uploadedBase64Preview = false;
  if ((await fileInputs.count()) > 0) {
    await fileInputs.first().setInputFiles({
      name: 'cccd_front_test.png',
      mimeType: 'image/png',
      buffer: Buffer.from(tinyPngBase64, 'base64'),
    });
    await page.waitForTimeout(800);
    uploadedBase64Preview = await page.evaluate(() => Boolean(document.querySelector('img[src^="data:image/"]')));
  }
  const ocrMobile360 = await auditGeometry(page, 'mobile_360_guest_ocr_base64', 360);
  report.geometryAudits.push(ocrMobile360);
  await page.screenshot({ path: path.join(shotsDir, 'special_ocr_mobile360.png'), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const ocrMobile390 = await auditGeometry(page, 'mobile_390_guest_ocr_base64', 390);
  report.geometryAudits.push(ocrMobile390);

  // --- PART 4: SPECIAL CHECK C — Printable Invoice & Confirmation (@media print A4 & A5) ---
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const overviewTabBtn = page.locator('button', { hasText: 'Tổng quan & Thanh toán' }).first();
  if (await overviewTabBtn.isVisible().catch(() => false)) {
    await overviewTabBtn.click();
    await page.waitForTimeout(400);
  }
  const printBtn = page.locator('button', { hasText: 'Xuất Hóa đơn & VietQR' }).first();
  let printCheck = { opened: false };
  if (await printBtn.isVisible().catch(() => false)) {
    await printBtn.click();
    await page.waitForTimeout(700);
    // Switch to Hóa đơn thanh toán
    const receiptTab = page.locator('button', { hasText: 'Hóa đơn thanh toán' }).first();
    if (await receiptTab.isVisible().catch(() => false)) {
      await receiptTab.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(shotsDir, 'special_print_modal_screen.png'), fullPage: false });

    // Emulate @media print A4 (794x1123)
    await page.emulateMedia({ media: 'print' });
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.waitForTimeout(400);
    const a4Metrics = await page.evaluate(() => {
      const noPrintVisible = Array.from(document.querySelectorAll('.no-print')).some((el) => window.getComputedStyle(el).display !== 'none');
      return {
        noPrintHidden: !noPrintVisible,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 4,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    await page.screenshot({ path: path.join(shotsDir, 'special_print_A4.png'), fullPage: true });

    // Emulate @media print A5 (559x794)
    await page.setViewportSize({ width: 559, height: 794 });
    await page.waitForTimeout(400);
    const a5Metrics = await page.evaluate(() => {
      const noPrintVisible = Array.from(document.querySelectorAll('.no-print')).some((el) => window.getComputedStyle(el).display !== 'none');
      return {
        noPrintHidden: !noPrintVisible,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 4,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    await page.screenshot({ path: path.join(shotsDir, 'special_print_A5.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    printCheck = { opened: true, a4Metrics, a5Metrics };
    await page.keyboard.press('Escape').catch(() => {});
    const closeModalBtns = page.locator('button').filter({ has: page.locator('svg.lucide-x') });
    if ((await closeModalBtns.count()) > 0) await closeModalBtns.last().click().catch(() => {});
  }

  // Close BookingDetailModal & check a PAID booking (balance === 0) for VietQR hidden rule!
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const closeBtns = page.locator('button').filter({ has: page.locator('svg.lucide-x') });
  while ((await closeBtns.count()) > 0) {
    await closeBtns.last().click().catch(() => {});
    await page.waitForTimeout(250);
    break;
  }
  await page.locator('aside button', { hasText: 'Đơn, Đoàn & ASM' }).first().click();
  await page.waitForTimeout(900);
  // Click first checked-out booking row with "Đã thanh toán" / 0đ balance
  const paidRow = page.locator('tbody tr').filter({ hasText: 'Đã trả phòng' }).first();
  let vietQrPaidCheck = { tested: false };
  if (await paidRow.isVisible().catch(() => false)) {
    await paidRow.click();
    await page.waitForTimeout(800);
    vietQrPaidCheck = await page.evaluate(() => {
      const img = document.querySelector('img[src*="vietqr.io"], img[alt*="VietQR"]');
      const txt = document.body.innerText;
      return {
        tested: true,
        vietQrHiddenWhenZeroBalance: !img,
        foundSrc: img ? img.getAttribute('src') : null,
        hasZeroBalanceText: txt.includes('0đ') || txt.includes('0 đ'),
      };
    });
    // Also check Print modal on paid booking to verify VietQR is hidden on paid receipt too!
    const printBtnPaid = page.locator('button', { hasText: 'Xuất Hóa đơn & VietQR' }).first();
    if (await printBtnPaid.isVisible().catch(() => false)) {
      await printBtnPaid.click();
      await page.waitForTimeout(600);
      const printQrWhenPaid = await page.evaluate(() => Boolean(document.querySelector('img[src*="vietqr.io"], img[alt*="VietQR"]')));
      vietQrPaidCheck.printModalQrShownWhenPaid = printQrWhenPaid;
    }
  }

  report.specialChecks = {
    vietQrUnpaidDesktop,
    vietQrPaidCheck,
    uploadedBase64Preview,
    ocrMobile360Overflow: ocrMobile360.horizontalOverflow,
    ocrMobile390Overflow: ocrMobile390.horizontalOverflow,
    printCheck,
  };
} finally {
  await browser.close();
  viteProc.kill();
}

fs.writeFileSync(path.join(outDir, 'ui_ux_audit_raw.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('=== UI/UX GEOMETRIC AUDIT SUMMARY ===');
for (const g of report.geometryAudits) {
  console.log(`${g.label} (${g.viewport}): overflow=${g.horizontalOverflow}, occluded=${g.occludedCount}, smallBtns(<40px)=${g.smallButtonCount}, crampedPairs(<8px)=${g.crampedPairCount}, smallText(<12px)=${g.smallTextCount}, clipped=${g.clippedCount}`);
}
console.log('SPECIAL_CHECKS:', JSON.stringify(report.specialChecks, null, 2));
console.log('CONSOLE_ERRORS:', report.consoleErrors.length, 'PAGE_ERRORS:', report.pageErrors.length);
process.exit(0);
