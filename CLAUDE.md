# Garage Manager - Trimurti Auto

Bilingual (Marathi + English) garage management system for one two-wheeler workshop.
PHP 8.1+ JSON API + MySQL on cPanel, vanilla-JS web app (no build step), Expo React Native Android app.

**Source of truth:** `docs/Garage Manager – Build Specification for Claude Code.md`, including its
"Decisions adopted for the build" section (costing = weighted average ex-GST, invoice draft state,
`INV/26-27/00001` numbering, payment_allocations, etc.). Change decisions there first.

## Build status
| Phase | API | Web | Mobile | Tests |
|---|---|---|---|---|
| 1 Foundation + inventory | done | done | done (not device-tested) | API + Playwright pass; mobile tsc/lint/export clean |
| 2 Suppliers + purchases | done | done | done (not device-tested) | API + Playwright pass; mobile tsc/lint/export clean |
| 3 Customers, jobs, estimates, requests | done | done | done (not device-tested) | API + Playwright pass; mobile tsc/lint/export clean |
| 4 Billing + payments | done | done | done (not device-tested) | API + Playwright pass; mobile tsc/lint/export clean |
| 5 Owner tools + reports | done | done | done (not device-tested) | API + Playwright pass; mobile tsc/lint/export clean |

When a phase's web screens go live, raise `BUILT_PHASE` in `public_html/assets/js/ui/shell.js`
(it gates sidebar items and dashboard cards).

## Layout
- `database/schema.sql` - ALL tables for all phases (no DROPs on purpose). `seed.sql` - demo data, users password `garage123`.
- `public_html/` - upload to cPanel. `api/` (index.php router, `lib/`, `routes/` one file per module, `templates/`, `cron/`, `storage/`).
- `public_html/assets/` - `css/` tokens/base/components/print, `js/` app, router, api, i18n, `ui/` components, `pages/`; `i18n/en.json` + `mr.json` shared with mobile.
- `mobile/` - Expo SDK 58 app (Expo Router, TypeScript strict).
- `tests/run.php` + `tests/cases/*.php` - API tests; `tests/e2e/` - Playwright.
- `tools/` - dev router for `php -S`, DB reset, icon generator, i18n check, LAN server, release zips.
- `.github/workflows/ci.yml` - API tests (PHP 8.1 + 8.3), Playwright, mobile checks. Branch `feature/garage-manager-v1`.

## Commands (Windows dev machine)
- PHP is XAMPP: `C:\xampp\php\php.exe` (not on PATH). XAMPP's MariaDB 10.4 is NOT used.
- MySQL 8 in Docker: `docker compose up -d` → 127.0.0.1:3307, root / devroot. First start takes ~1 min.
- Rebuild dev DB: `php tools/reset-dev-db.php` (garage_dev, uses `public_html/api/config.php`, gitignored).
- Dev server: `php -S 127.0.0.1:8080 -t public_html tools/dev-router.php` → http://127.0.0.1:8080
- API tests: `php tests/run.php [filter]` (rebuilds garage_test, starts its own server on :8099).
- E2E: `cd tests/e2e && PHP_BIN=C:/xampp/php/php.exe npx playwright test` (garage_e2e, port 8098).
  Playwright must be ≥1.65 - 1.49 hangs on Node 24.
- Phone on Wi-Fi: `powershell -ExecutionPolicy Bypass -File tools/serve-lan.ps1` (prints the address; sets GM_APP_URL).
- Translations: `node tools/check-i18n.mjs` (same keys/placeholders en+mr, mobile copies synced) - CI runs it.
- Release: `node tools/make-release.mjs` → `dist/` site / database / docs zips from HEAD.
- APK without Expo account: `node tools/build-apk-local.mjs` (prebuild + Gradle in C:gmbmobile, CMake 3.31 for long
  paths, key in ~/.garagio/ - never commit it). Files on this laptop get the Windows Hidden flag; the script clears it.
- Publish the APK to phones: `node tools/publish-apk.mjs` (GitHub release `app-v<version>`, asset `trimurti-garage.apk`,
  git's saved GitHub login; link `…/releases/latest/download/trimurti-garage.apk` in Settings → App).
- Deploy: `.github/workflows/deploy.yml` (CI green on main → test site; manual → live) → cPanel API →
  `.cpanel.yml` → `tools/cpanel-deploy.sh` (backup, git-archive copy, migrations, deploy.json). APK: `apk.yml`.
- Schema changes after release: new `public_html/api/migrations/NNN_name.sql` + same change in `schema.sql`
  (and its `schema_migrations` INSERT). Applied by `api/cron/migrate.php`.
- Icons: add the name to `tools/build-icons.mjs`, run it against `lucide-static/icons`.

## API conventions
- Register routes with `route(METHOD, '/path/{id}', fn($p) => [...], ['roles' => [...], 'public' => true, 'pw' => true])`.
  Prefer `'perm' => 'make_bills'` (any of a list; `'also' => 'x'` = AND) over roles: per-person permissions in
  `lib/auth.php` PERMISSIONS (`can()`, `user_perms()`); clients use `can()` in `store.js` / `session.ts`.
  More specific paths (`/parts/labels`) before `/parts/{id}` in the same file.
- Validate every input with `clean($in, ['field' => 'type|req|max:N|min:N|def:V'], $partial)`.
  Use `def:0` for NOT NULL numeric columns (forms send empty strings → null otherwise).
- Errors: `fail(status, 'snake_code', 'message', $fields)`. Clients translate `errors.<code>`.
- Money/stock changes inside `tx()`. Stock only via `stock_move()` (writes the ledger row + balance_after);
  the go-live ledger wipe is `stock_restart_ledger()`, also in `lib/stock.php`.
- Line discounts go through `clean_discounts()`; unused customer money is applied with `apply_customer_advance()`.
- Return payloads through `strip_cost()` wherever cost fields (COST_FIELDS) may appear.
- Excel: downloads with `xlsx_build(['Sheet' => rows])`; uploads arrive as heading => cell rows, mapped by
  `import_map_row($raw, ALIASES, NUMBERS, $unused)` (lib/xlsx.php). Aliases: `PART_IMPORT_ALIASES` (parts.php),
  `PURCHASE_IMPORT_ALIASES` (purchases.php). Clients read sheets with SheetJS (`readSheetRows` web, `src/excel.ts` phone).
- Uploaded photos: `save_uploaded_image($dir)` / `image_response($file)` (lib/util.php), files under `api/storage/`
  (photos, bills, scans), never served directly.
- Final sales bills change only through `invoice_edit_apply()` (routes/invoice_edit.php: same number, stock and money
  follow, preview = same code rolled back). Drafts use `rebuild_draft()`.
- `audit()` for discounts, invoice cancels, stock adjustments, credit changes, user changes.
- GST maths only in `lib/gst.php` (`gst_line`, `gst_bill`); never on clients. Anything we *sell* goes through
  `sale_bill()`, which drops GST while setting `gst_registered` is 0 (shop not registered yet; bills `BIL/…`,
  `invoices.gst_registered` keeps each bill's mode). Purchases use `gst_bill` directly.
- Numbers: `next_job_no()`, `next_estimate_no()`, `next_invoice_no($date)` (locked counter rows).
- Job card photos → `POST /jobs/scan-card` → `lib/jobcard.php` (Gemini generateContent, key only in config.php,
  `ai_stub` file in tests). Result only pre-fills New job; `scan_id` on POST /jobs attaches the card photo.

## Mobile conventions (`mobile/`)
- Expo SDK 58, RN 0.88, React 19.3, expo-router, TS strict. Install native modules with `npx expo install`.
- Checks: `npm run typecheck`, `npm run lint` (must be warning-free), `npx expo export --platform android`.
- Translations: edit the web JSON files, then `npm run sync-i18n` (copies into `src/i18n/`).
- Screens in `app/`; tabs per role in `src/tabs.ts` (`ROLE_TABS`, `TAB_PERM`, `hasTab()`); detail screens on the root stack.
  Never link to a tab the person may not have: expo-router sends them to their first tab. Use the page twin
  (`/purchase`, `/customer`, `/job/new`, `/parts-requests`, `/profile`, `/parts`; screens shared via `src/screens/`) or `hasTab()`.
- Data via TanStack Query hooks in `src/api/queries.ts`; session in zustand `src/store/session.ts` (token in SecureStore).
- UI kit in `src/components/ui.tsx`: `Txt` picks Inter or Noto Sans Devanagari by language; `Button needsOnline` disables while offline.
- Import fonts by subpath (`@expo-google-fonts/inter/400Regular`), never the package root (bundles every weight).
- Dates: `DateField` (`src/components/dateField.tsx`, calendar, ISO in/out, `isoDay()`); never typed dates and never
  `toISOString()` for a day (midnight in India is still the previous day in UTC).
- Forms show API field errors with `fieldErrors()` (`src/fieldErrors.ts`).
- The app is edge to edge: stack screens get `paddingBottom: NAV_BAR` from the root layout; a screen with its own
  bottom bar opts out (`contentStyle` without it) and pads with `useSafeAreaInsets()`.
- RN 0.88: TextInput refs are `TextInputInstance`. lucide-react-native 1.x renamed icons (e.g. `TriangleExclamationPoint`).
- No device or emulator on the dev machine: manual checklist in `docs/MOBILE_TEST_CHECKLIST.md`.

## Web conventions
- Markup via the `html` tagged template (auto-escapes); `raw()` only for markup we built.
- Page module: `export default async function (ctx)`; render into `ctx.el` (fresh element per page, so
  listeners die with the page); check `ctx.alive()` after awaits; may return a cleanup fn.
- Forms in drawers: `openDrawer({ title, body, onSubmit })`; fields via `field({...})`; API 422 field errors shown automatically.
- Every UI string in BOTH `en.json` and `mr.json`. Bilingual records use `name_en`/`name_mr` → `nm(obj)`.
- Money `money()` (Indian grouping), dates `DD-MM-YYYY`, Western digits in both languages.
- Brand colour is the logo's red #C1272D with white ink (5.8:1; dark mode #D63339), decision 32. It replaced the orange.
- Look (decisions 31–32): tokens in `css/tokens.css` and `mobile/src/theme/tokens.ts` (change both); `--grad-brand` banner
  (`.hero`, grey → red), `.plate` for bike numbers, `.dl dt.grand/dd.grand` for bill totals, round `.kpi-icon` tones
  (success/warning/danger/info/violet/teal/pink). Logo (grey gear, red ring + spanner, 100×100 SVG; keep every copy the
  same): `ui/logo.js` (web), `img/icon.svg`, `logo_svg()` (bills), `components/brand.tsx` (phone: `Logo`,
  `GradientPanel`, `Plate`), `tools/make-app-icons.mjs` (Android icons).
- Shop name: short `shop_name` inside the app; `shop_full_name($lang)` (lib/util.php) on bills, receipts, WhatsApp, login.
- One `<h1>` per page (the page heading); the top-bar title is a plain div.
