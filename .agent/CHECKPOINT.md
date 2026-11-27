# Checkpoint — Like Family PMS

- **Timestamp:** 2026-11-27 21:43 (UTC+7)
- **Version:** `v2.2.2` (Deployed Live for Owner Real-Device UAT UI/UX Testing)
- **Status:** DEPLOYED LIVE AT `https://likefamilypms.web.app` — **QA DATA CLEANUP HELD AT STOP GATE (`QA2M_*` & `qa_runner` INTACT PER OWNER DECISION)**
- **GitHub Branch:** `fix/v2.2.2` (`https://github.com/ldpxx/likefamilyhotelpms/tree/fix/v2.2.2`)
- **Live Verification (`likefamilypms`):**
  - Hot backup before deploy: `backups/firestore_backup_pre_uat_ui_v2.2.2_2026-11-27.json` (`2,077.9 KB`)
  - `firestore.rules` `v2.2.2` (`validOccupancyDoc()`, `configMigrationVersion`) deployed: **PASS**
  - P.502 sample maintenance `QA2M_MNT_0014` marked `completed` & `auditAndRebuildOccupancy` executed live: **`75/75` `room_occupancy` docs built, `15/15` rooms = `0` conflicts (`missing=0, mismatch=0`)**
  - `hotel_config/main` `bookingSources` migration executed live: **`12` sources, `configMigrationVersion: 1`**
  - Hosting `v2.2.2` deployed (`npm run build` 0 errors, `5.46s`): `https://likefamilypms.web.app` (`HTTP 200`) & `/superadmin` (`HTTP 200`)
  - UI/UX Geometric Audit (`scripts/qa_ui_ux_audit.mjs` + `QA_REPORTS/UI_UX_AUDIT_v2.2.2/UI_UX_AUDIT_REPORT.md`): **19/19 PASS** (`0` overflow, `0` occluded, `0` buttons `< 40px`, `0` pairs `< 8px`, `0` text `< 12px`, `0` console errors; VietQR, Base64 OCR modal & A4/A5 `@media print` verified)
- **Next Pending Owner Decision:** After completing real-device UX/UI testing on `https://likefamilypms.web.app`, approve final QA cleanup (`1,496` `QA2M_*` docs + 15-room reset + `qa_runner` revocation) to hand over for official hotel operations.
