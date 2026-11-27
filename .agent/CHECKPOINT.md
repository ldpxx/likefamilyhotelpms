# Checkpoint — Like Family PMS

- **Timestamp:** 2026-11-27 11:36 (UTC+7)
- **Version:** `v2.1.1` (Split-Stay P&L / KPI & Chain Cancellation Hotfix — v2.0.1-hotfix on top of v2.1.0)
- **Status:** COMPLETED & DEPLOYED TO PRODUCTION
- **Live URLs:**
  - Staff & Owner Portal: `https://likefamilypms.web.app` (`HTTP 200`)
  - SuperAdmin Root Portal: `https://likefamilypms.web.app/superadmin` (`HTTP 200`)
- **Verification Results:**
  - Forbidden imports (`GoogleAuthProvider`, `firebase/storage`): `0`
  - `npm run build` (`tsc -b && vite build`): PASS (0 errors, 6.54s)
  - Firebase Hosting deploy (`likefamilypms`): PASS
- **Docs Synced:** `Progress.md`, `changelog.md`, `package.json` (`2.1.1`).
