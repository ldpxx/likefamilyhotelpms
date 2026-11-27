# Checkpoint — Like Family PMS

- **Timestamp:** 2026-11-27 19:56 (UTC+7)
- **Version:** `v2.2.2` (Technical Bugfix & Regression Release — `BUG-01`, `BUG-02`, `BUG-03`, `UI-01..UI-04`, Restore Drill)
- **Status:** COMPLETED & VERIFIED ON LOCAL EMULATOR — **HELD AT STOP GATE (NOT DEPLOYED TO PRODUCTION, `QA2M_*` INTACT)**
- **GitHub Branch:** `fix/v2.2.2` (`https://github.com/ldpxx/likefamilyhotelpms`)
- **Production URL (still running `v2.2.1` pending Owner Go-Live approval):** `https://likefamilypms.web.app`
- **Verification Results (`v2.2.2`):**
  - Forbidden imports (`GoogleAuthProvider`, `firebase/storage`): `0`
  - `npm run build` (`tsc -b && vite build`): **PASS** (`0` errors, `5.60s`)
  - Firebase Local Emulator Suite (`DRILL-01..02`, `BUG01`, `BUG02` 12-req storm + 5m buffer + group atomic + release, `BUG03` idempotent migration, `SEC-OCC/CFG/RBAC`): **`14/14 PASS`**
  - Playwright Automated UI Suite (`UI-01` Desktop 1440×900, `UI-02` Tablet 768×1024, `UI-03` Mobile 390×844, `UI-04` Password mismatch + Hourly drawer + Restore Sources button, `UI-CONSOLE-01`): **`5/5 PASS`** (`0` pageErrors, `0` consoleErrors)
  - Total `v2.2.2` QA: **`19/19 PASS` (`0 FAIL`, `0 BLOCKED`, `0 NOT RUN`)** | Cumulative (`v2.2.1` + `v2.2.2`): **`54/54 PASS`**
- **Key Financial & Concurrency Proof:**
  - `serviceRev(T10) = 30.320.000đ`, `serviceRev(T11) = 28.205.000đ`, `T10+T11 = 58.525.000đ === 2M (58.525.000đ) === Sum 61 days` (**`0đ` variance**); `roomRev = 362.750.000đ / 730 đêm`.
  - Concurrency Storm (12 simultaneous `runTransaction` requests for P.201): **1 succeeded / 11 atomically rejected (`OCCUPANCY_CONFLICT`)**.
  - Historical audit finding surfaced by `auditAndRebuildOccupancy()`: `1` pre-existing seeded overlap on `room_502_2026-11-28` (`QA2M_BKG_0433` vs `QA2M_MNT_0014`) — preserved untouched for Owner review.
  - Restore Drill on Emulator: `1,519` docs restored from `backups/firestore_backup_pre_v2.2.2_2026-11-27.json` in `3,136ms` (`100%` count parity).
- **Mandatory Reports:** All **13 reports** (`00_ENVIRONMENT_GATE.md` → `12_FINAL_UAT_READINESS.md`) + `9` screenshots saved in `QA_REPORTS/BUG_FIX_REGRESSION_v2.2.2/`.
- **UAT Readiness Recommendation:** **`GO`** (awaiting Owner approval before `firebase deploy` or `QA2M_*` cleanup).
