# Hotel PMS — Project Agent Rules & Skill Routing

## Project Agent Skill Routing & Conflict Safeguards

### 1. Session & Token Priority (Highest Priority)
- `vibe-code-token-checkpoint` always holds **Priority 0** over every other skill.
- Always check `.agent/CHECKPOINT.md` at session start **before** running `brainstorming` or exploring the repo.
- Immediately interrupt **any** active loop (UI visual/lint loops, build/test loops, DB migration loops) when context reaches **75-80%** token budget, save clean resumable state to `.agent/CHECKPOINT.md`, and hand off cleanly.
- Follow `tokenleak` on every file read, command output, and search batch.

### 2. UI Mutual Exclusion (100% Conflict-Free Frontend Routing)
- **NEVER** load `design-taste-frontend` and `unslop` in the same turn or task. Pick **EXACTLY ONE**:
  - **Use `unslop`** (`.agent/skills/unslop/SKILL.md`): Primary aesthetic skill for designing, polishing, or auditing **Hotel PMS Web App screens, Admin Dashboards, room calendars, data tables, and operational forms**.
  - **Use `design-taste-frontend`** (`.agent/skills/design-taste-frontend/SKILL.md`): ONLY when building a **brand-new public Landing Page, hotel booking showcase, or marketing website** from scratch.
- Do not simultaneously load any other competing UI aesthetic skill (`hallmark`, `frontend-design`, `high-end-visual-design`, `ui-ux-pro-max`) unless explicitly requested by the user.

### 3. Web App Design & Engineering Skills
- Always consult `modern-web-guidance` (plugin) first for modern HTML/CSS/DOM patterns.
- **UI Workflow & Quality:** `build-ui`, `ui-states`, `ui-a11y`, `ui-review`, `write-design-md`, `kpi-dashboard-design`.
- **Frontend Stack:** `frontend-developer`, `react-best-practices`, `react-patterns`, `tailwind-patterns`, `shadcn`, `typescript-expert`, `frontend-api-integration-patterns`.
- **Browser QA:** `playwright-skill`.

### 4. Android App & Multi-Platform Skills
- **Mobile UI/UX & Architecture:** `mobile-design`, `mobile-developer`, `multi-platform-apps-multi-platform`.
- **Android Tooling & Device Verification (Plugins):** `android-cli`, `android-device-hub`, `compose-preview` (if using Jetpack Compose).
- **Android APK + Web Release Pipeline:** `github-apk-auto-release` (`.agent/skills/github-apk-auto-release/SKILL.md`) — always confirm the 4 project-specific parameters (`GITHUB_OWNER`, `GITHUB_REPO`, `APP_SLUG`, `HOSTING_BASE_URL`) before generating `release.config.json`.

### 5. Data, Backend, Auth & AI Vision Skills
- **Database:** `database-design` (`.agent/skills/database-design/SKILL.md`).
- **API Design:** `api-design-principles` (`.agent/skills/api-design-principles/SKILL.md`).
- **Auth & RBAC:** `auth-implementation-patterns` (`.agent/skills/auth-implementation-patterns/SKILL.md`).
- **Document / ID / Passport OCR:** `gemini-vision-ocr` (Global) for guest check-in CCCD/passport/invoice scanning on Web & Android.
