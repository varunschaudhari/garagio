# Garage Manager – Build Specification for Claude Code

Nov 13, 2026 · @Varun

Build a modern, bilingual (Marathi + English) garage management system for a single two-wheeler workshop: a PHP + MySQL REST API on cPanel, a responsive web app in HTML/CSS/JS, and a React Native Android app, replacing the paper parts slip with a tracked request → approval → issue → bill flow.

## Overview

The system runs one two-wheeler garage with one shop, several storage spots (Counter, Godown, Upstairs) and racks. Four roles use it: owner, inventory manager, mechanic and front desk. Every role uses the Android app; the web app is used at the counter and by the owner.

**Problems it solves**

- Mechanics write parts needed on paper and hand it to the inventory manager — replaced by a tracked parts request.
- No reliable stock count, purchase cost or rack location — replaced by a stock ledger where every change is recorded.
- No GST bills, customer history, credit tracking or supplier dues.

**Definition of done**

- All five build phases (see *Build phases*) pass their acceptance criteria.
- Deploys to a fresh cPanel account by uploading files, importing one SQL file and editing one config file.
- Android APK builds and connects to the deployed API over HTTPS.
- Every screen works in Marathi and English, on a 360 px-wide phone and a 1366 px laptop.
- No feature in this spec is left as a stub; seed data lets the owner try every flow on day one.

## Tech stack and repository structure

One PHP API serves both clients; the web app needs no build step on the server, so it uploads to cPanel as plain files.

| Layer | Choice | Notes |
| --- | --- | --- |
| Backend | PHP 8.1+, no framework, PDO, JSON REST | Runs on any cPanel shared host; no Composer or SSH required |
| Database | MySQL 8 / MariaDB 10.6+, InnoDB, utf8mb4 | Schema + seed as plain `.sql` files for phpMyAdmin import |
| Auth | JWT (HS256), 30-day tokens, bcrypt passwords | Accept `Authorization: Bearer` and `X-Auth-Token` (some cPanel hosts strip Authorization) |
| Web app | HTML5, modern CSS (custom properties, grid, container queries), vanilla JS ES modules | Single-page app with hash routing; vendored libraries only, no CDN at runtime |
| Web libraries | Lucide icons (SVG), Chart.js for dashboard charts | Self-hosted in `/assets/vendor` |
| Fonts | Inter (Latin) + Noto Sans Devanagari (Marathi) | Self-hosted WOFF2 |
| Mobile | React Native via Expo (latest SDK), TypeScript, Expo Router | Android only; build APK with EAS Build |
| Mobile libraries | TanStack Query, Zustand, expo-secure-store, expo-camera (QR), expo-print + expo-sharing (PDF to WhatsApp), i18next | — |
| Bills / PDF | One HTML invoice template served by the API | Web prints it (A4 print CSS); mobile turns it into a PDF with expo-print |

**Repository layout**

```
garage-manager/
  database/
    schema.sql            # all tables
    seed.sql              # settings, demo users, sample parts/customers
    migrations/           # numbered .sql files for later changes
  public_html/            # upload this folder to cPanel
    index.html            # web app shell
    assets/
      css/                # tokens.css, base.css, components.css, print.css
      js/                 # app.js, router.js, api.js, i18n.js, pages/*.js, components/*.js
      i18n/               # en.json, mr.json (shared with mobile)
      vendor/  fonts/  img/
    api/
      index.php           # router + error handling
      .htaccess           # rewrite to index.php, keep Authorization header
      config.sample.php   # copy to config.php
      lib/                # db.php, http.php, auth.php, gst.php, stock.php, i18n.php
      routes/             # one file per module
      templates/          # invoice.php, estimate.php (HTML)
      cron/               # reminders.php, backup.php
  mobile/                 # Expo app
    app/                  # Expo Router screens, grouped by role
    src/  api/ components/ theme/ i18n/ store/
    app.json  eas.json  package.json
  docs/
    DEPLOY.md  USER_GUIDE_MR.md  API.md
```

## Roles and permissions

Enforce every rule in the API, not only in the UI. Purchase price, purchase discount, cost and margin are returned **only** to owner and inventory manager.

| Action | Owner | Inventory manager | Front desk | Mechanic |
| --- | --- | --- | --- | --- |
| Create customer, bike, job card | Yes | — | Yes | — |
| Send estimate / mark customer approval | Yes | — | Yes | — |
| Inspect job, add inspection notes and labour | Yes | — | Yes | Own jobs |
| Change job status (in progress, waiting parts, ready) | Yes | — | Yes | Own jobs |
| Raise parts request | Yes | — | Yes | Own jobs |
| Approve part line of ₹1,000 or more | Yes | Yes | — | — |
| Issue parts, mark unavailable, accept returns | Yes | Yes | — | — |
| Create / edit parts, stock count, adjustments | Yes | Yes | — | — |
| View stock and rack location | Yes | Yes | Yes | Yes |
| See purchase price, discount, cost, margin | Yes | Yes | — | — |
| Suppliers, purchase bills, supplier payments | Yes | Yes | — | — |
| Create invoice, take payment | Yes | — | Yes | — |
| Give discount on a bill | Yes | — | — | — |
| Allow credit (mark customer trusted, set limit) | Yes | — | — | — |
| Cancel invoice | Yes | — | — | — |
| Mechanic daily summary and payments | Yes | — | — | — |
| Reports, GST summary, dashboard money figures | Yes | Stock reports only | — | — |
| Users, settings, labour rate list | Yes | — | — | — |

## Core workflow

1. Front desk looks up the customer by phone or bike number and opens a job card (`pending`).
2. Mechanic inspects the bike and adds inspection notes and labour.
3. Front desk builds the estimate (parts + labour) and sends the approval link on WhatsApp (`estimate_sent`).
4. **Approval 1 — customer** approves through the link, or front desk marks "Approved on call" (`approved`).
5. Mechanic starts work (`in_progress`) and raises a parts request.
6. **Approval 2 — owner / inventory manager** approves any line worth ₹1,000 or more.
7. Inventory manager issues the parts (stock drops, parts land on the job) or marks them unavailable (`waiting_parts`).
8. Mechanic finishes (`ready`); front desk sends "bike ready" on WhatsApp.
9. Front desk generates the invoice from issued parts + labour (draft → owner discount if any → final) and takes payment or credit.
10. Bike handed over (`delivered`); bill PDF shared on WhatsApp.

Work starts only after the customer approves the estimate; any part line worth ₹1,000 or more waits for the owner or inventory manager before it is issued. Issued parts flow straight onto the GST bill, so nothing is re-typed.

## Functional requirements by module

### 1. Inventory

- Part fields: part no, name (English), name (Marathi), category, brand, compatible models, unit, HSN, GST %, selling price (MRP), last purchase price, last purchase discount %, storage location (Counter / Godown / Upstairs, editable list), rack, current stock, minimum stock, active flag.
- **Stock is never typed directly.** Every change writes a `stock_movements` row (opening, purchase, job issue, job return, counter sale, sale cancel, adjustment, stock count) in the same transaction that updates `current_stock`.
- Stock count screen: pick a location, walk racks in order, enter counted quantity; the system posts the difference as a `stock_count` movement with a reason.
- Part ledger: every movement with date, type, reference (job / bill), user, running balance.
- Low stock: current ≤ minimum, shown as a badge and on the dashboard.
- Reorder list = low-stock parts + request lines marked unavailable in the last 30 days, grouped by last supplier; shareable on WhatsApp.
- QR labels: print a sheet of QR codes per rack or per part (code = part no); scanning opens the part.
- Excel / CSV import of parts (upsert by part no) for later use.

### 2. Suppliers and purchases

- Supplier: name, phone, GSTIN, state, address, opening balance.
- Purchase bill: supplier, bill no, bill date, items (part, qty, price, discount %, GST %, taxable, CGST/SGST/IGST), freight/other, round-off, total, payment mode (cash / UPI / bank / **credit**).
- New parts can be created inline from the purchase screen.
- Saving a bill adds stock and updates the part's last purchase price and discount.
- Supplier ledger: bills, payments made, balance payable; record supplier payments (full or part).

### 3. Customers and bikes

- Customer: name, phone (unique), alternate phone, address, GSTIN, preferred language (mr/en), **trusted for credit** flag, credit limit (owner only).
- Bike: reg no (stored uppercase without spaces), make, model, year, last odometer. One customer, many bikes.
- Search by phone or bike number from a single box.
- Customer page: bikes, job history, invoices, payments, balance due.

### 4. Job cards

- Fields: job no (JC-0001), customer, bike, odometer, fuel level, complaint, inspection notes, mechanic, status, promised delivery time, photos (up to 4, optional).
- Statuses: `pending` → `estimate_sent` → `approved` → `in_progress` → `waiting_parts` → `ready` → `delivered`; plus `cancelled`.
- Job board (kanban by status) on web; list with status chips on mobile.

### 5. Estimates and customer approval

- Estimate = parts (from catalogue, priced at selling price) + labour (from rate list, editable).
- Send on WhatsApp as a message with a link to a public approval page (signed token, no login) showing items and total, with **Approve** / **Call me** buttons.
- Front desk can instead mark "Approved on call" with a note.
- Work cannot move to `in_progress` until the estimate is approved.
- If issued parts + labour exceed the approved total, the job shows "Revised estimate needed" and a revised estimate (v2, v3…) is sent the same way.

### 6. Parts requests (replaces the paper slip)

- Mechanic picks a job, searches parts (English or Marathi name, part no, rack) or scans a QR, sets quantities; can add a free-text part not in the catalogue.
- Each line with qty × selling price **≥ ₹1,000** (setting) is held as `needs_approval`; owner or inventory manager approves or rejects with a reason.
- Inventory queue shows open requests oldest first with job no, bike, mechanic, location and rack of each line, and stock available.
- Per line: **Issue** (full or partial qty), **Not available** (with remark), **Link** a free-text line to a catalogue part.
- Issue reduces stock and adds the part to the job. Unused parts can be returned to stock from the job.
- New request → notification to inventory manager; approval needed → notification to owner and inventory manager; issued / unavailable → notification to the mechanic.

### 7. Billing and payments

- Job invoice built from issued parts + labour lines; counter-sale invoice for walk-in part sales (reduces stock).
- Discount field visible and editable only for the owner (per line or whole bill).
- Payment: cash, UPI, card, **credit**, or split. Credit only for trusted customers and within their limit.
- Record later payments against a customer (allocated oldest invoice first).
- Bill is bilingual, printable on A4, and shareable as PDF on WhatsApp.
- Cancelling an invoice (owner only) reverses counter-sale stock and reopens the job.

### 8. Mechanic daily summary (owner only)

- For a chosen date: per mechanic — jobs completed, bike numbers, labour billed, parts fitted value.
- Owner types the amount paid to each mechanic (his decision) and an optional note; stored as `mechanic_payments`.
- Weekly / monthly totals per mechanic, including advances.

### 9. Notifications and WhatsApp

- Phase 1: **click-to-send** — the app opens WhatsApp (`https://wa.me/91XXXXXXXXXX?text=…`) with a prefilled bilingual message: estimate link, bike ready, bill PDF, payment reminder, service reminder.
- In-app notifications for staff (bell icon + list); mobile polls every 20 s while open and uses Expo push notifications when available.
- Daily cron: list of customers due for service (90 days or 3,000 km since last service) and pending payment reminders, shown as a to-send list.
- Later: WhatsApp Business API provider behind a `MessageSender` interface so it can be switched on without UI changes.

### 10. Dashboard and reports

- Owner dashboard: today's sales (cash / UPI / card / credit), jobs by status, open requests, approvals waiting, low-stock count, customer dues, supplier payables, last 30 days sales chart.
- Reports with date range and CSV export: sales register, purchase register, stock valuation (at net cost), profit (sales − parts cost − mechanic payments), customer dues ageing, supplier payables, **monthly GST summary** (output vs input, by rate), mechanic performance.

## GST, billing, discount and credit rules

All money is calculated on the server; clients only display it. Store amounts as `DECIMAL(12,2)`, round each line to 2 decimals, round the grand total to the nearest rupee with a round-off line.

**Line calculation** (setting `prices_include_gst`, default on = MRP style):

```
gross    = qty × unit_price × (1 − disc% / 100)
inclusive: taxable = gross / (1 + rate/100); tax = gross − taxable
exclusive: taxable = gross;                 tax = taxable × rate/100
same state (shop state code 27 = Maharashtra): CGST = SGST = tax / 2
other state (customer GSTIN state ≠ shop):    IGST = tax
```

- Parts use their own HSN and GST % (default 18%). Labour uses SAC 998714 at the `labour_gst_rate` setting (default 18%).
- Invoice numbers per financial year: `INV/2026-27/0001`; job numbers `JC-0001`; estimate numbers `EST-0001`. Generated with a locked counter row inside the transaction.
- Tax invoice shows: shop name, address, GSTIN, state + code; customer name, phone, GSTIN if any; HSN/SAC, qty, rate, discount, taxable, GST % and amount per line; tax summary by rate; amount in words (English + Marathi); terms; signature line.
- **Discount:** only the owner role can set `disc_pct` on lines or a bill-level discount; the API rejects discounts from other roles.
- **Credit:** payment mode `credit` (or a partial payment) is allowed only when `customers.is_trusted = 1` and the new balance ≤ `credit_limit` (0 = no limit). Otherwise the API returns 409 with a clear message.
- Invoice status: `paid`, `partial`, `unpaid` from payments; `cancelled` by owner only, with reason.
- Purchase GST (input) is stored per purchase line so the monthly GST summary = output tax (invoices) − input tax (purchases), by rate, CGST/SGST/IGST separately.
- Have the shop's CA confirm HSN codes and rates before go-live; both are editable per part.

## Data model

All tables have `id INT AUTO_INCREMENT`, InnoDB, utf8mb4, foreign keys, and `created_at` / `updated_at` set by PHP (Asia/Kolkata). Statuses are `VARCHAR` validated in PHP. Money `DECIMAL(12,2)`, quantities `DECIMAL(10,2)`.

| Table | Key fields |
| --- | --- |
| `settings` | skey, svalue (shop name/address/GSTIN/state code, prefixes, prices\_include\_gst, labour\_gst\_rate, labour\_sac, approval\_limit = 1000, service\_reminder\_days = 90, service\_reminder\_km = 3000, invoice terms en/mr) |
| `users` | name, username, phone, password\_hash, role, language (mr/en), push\_token, active |
| `storage_locations` | name\_en, name\_mr, sort\_order, active |
| `categories` | name\_en, name\_mr |
| `parts` | part\_no, name\_en, name\_mr, category\_id, brand, compatible\_models, unit, hsn, gst\_rate, selling\_price, last\_purchase\_price, last\_purchase\_disc\_pct, location\_id, rack, current\_stock, min\_stock, active |
| `stock_movements` | part\_id, qty (±), mtype, ref\_type, ref\_id, unit\_cost, note, user\_id |
| `suppliers` | name, phone, gstin, state\_code, address, opening\_balance |
| `purchases` | supplier\_id, bill\_no, bill\_date, taxable\_total, cgst, sgst, igst, other\_charges, round\_off, total, payment\_mode, notes |
| `purchase_items` | purchase\_id, part\_id, qty, price, disc\_pct, net\_cost, gst\_rate, taxable, tax\_amount, line\_total |
| `supplier_payments` | supplier\_id, amount, mode, reference, paid\_on, note |
| `customers` | name, phone, alt\_phone, address, gstin, state\_code, language, is\_trusted, credit\_limit |
| `vehicles` | customer\_id, reg\_no, make, model, year, last\_odometer, last\_service\_on |
| `labour_rates` | name\_en, name\_mr, amount, active |
| `job_cards` | job\_no, customer\_id, vehicle\_id, odometer, fuel\_level, complaint, inspection\_notes, mechanic\_id, status, promised\_at, approved\_estimate\_id, invoice\_id, delivered\_at |
| `job_photos` | job\_card\_id, path |
| `job_labour` | job\_card\_id, labour\_rate\_id, description, amount |
| `job_parts` | job\_card\_id, part\_id, qty, unit\_price, request\_item\_id, issued\_by, issued\_at |
| `estimates` | job\_card\_id, version, est\_no, parts\_total, labour\_total, grand\_total, status (draft/sent/approved/rejected/superseded), approval\_token, approved\_via (link/call), approved\_at, note |
| `estimate_items` | estimate\_id, item\_type, part\_id, description, qty, unit\_price, amount |
| `part_requests` | job\_card\_id, requested\_by, status (open/closed/cancelled), note, closed\_at |
| `part_request_items` | request\_id, part\_id (nullable), custom\_name, qty, issued\_qty, line\_value, status (requested/needs\_approval/approved/rejected/issued/unavailable/cancelled), approved\_by, approved\_at, remark, handled\_by, handled\_at |
| `invoices` | invoice\_no, invoice\_date, inv\_type (job/counter), job\_card\_id, customer\_id, customer snapshot (name, phone, gstin, state), is\_interstate, discount\_total, taxable\_total, cgst, sgst, igst, round\_off, grand\_total, paid\_total, balance, pay\_status, status, cancel\_reason |
| `invoice_items` | invoice\_id, item\_type (part/labour), part\_id, description\_en, description\_mr, hsn, qty, unit\_price, disc\_pct, gst\_rate, taxable, tax\_amount, line\_total, unit\_cost (for profit) |
| `customer_payments` | customer\_id, invoice\_id (nullable), amount, mode, reference, received\_on |
| `mechanic_payments` | mechanic\_id, work\_date, amount, kind (daily/advance), note, paid\_by |
| `notifications` | user\_id, type, title, body, link, read\_at |
| `message_log` | customer\_id, channel (whatsapp), template, payload, status, sent\_by |
| `counters` | ckey, cval (job, estimate, invoice per FY) |
| `audit_log` | user\_id, action, entity, entity\_id, before\_json, after\_json |

## REST API endpoints

Base `/api`, JSON in and out. Errors return `{"error": "message", "code": "snake_case"}` with 400 / 401 / 403 / 404 / 409 / 422. Lists accept `?q=&page=&per_page=` and return `{items, total}`. Every stock- or money-changing call runs in one DB transaction. Also expose `index.php?r=<path>` for hosts without mod\_rewrite.

| Module | Endpoints |
| --- | --- |
| Auth | `POST /auth/login` · `GET /auth/me` · `POST /auth/password` · `POST /auth/push-token` |
| Settings & masters | `GET/PUT /settings` · `GET/POST/PUT /locations` · `GET/POST/PUT /categories` · `GET/POST/PUT /labour-rates` |
| Users | `GET/POST /users` · `PUT /users/{id}` · `GET /users/mechanics` |
| Parts | `GET /parts` (q, category, location, low) · `GET /parts/{id}` · `POST /parts` · `PUT /parts/{id}` · `GET /parts/{id}/ledger` · `POST /parts/{id}/adjust` · `GET /parts/by-code/{code}` · `POST /parts/import` · `GET /parts/labels` (QR sheet HTML) |
| Stock count | `POST /stock-counts` (location, lines) · `GET /reorder` |
| Suppliers | `GET/POST /suppliers` · `PUT /suppliers/{id}` · `GET /suppliers/{id}/ledger` · `POST /suppliers/{id}/payments` |
| Purchases | `GET/POST /purchases` · `GET /purchases/{id}` |
| Customers | `GET/POST /customers` · `GET/PUT /customers/{id}` · `GET /customers/{id}/ledger` · `POST /customers/{id}/payments` · `PUT /customers/{id}/credit` (owner) · `GET /lookup?q=` (phone or bike number) |
| Vehicles | `POST /customers/{id}/vehicles` · `PUT /vehicles/{id}` · `GET /vehicles/{id}/history` |
| Job cards | `GET/POST /jobs` · `GET/PUT /jobs/{id}` · `POST /jobs/{id}/status` · `POST /jobs/{id}/labour` · `DELETE /jobs/{id}/labour/{lid}` · `POST /jobs/{id}/photos` · `POST /jobs/{id}/return` |
| Estimates | `POST /jobs/{id}/estimates` · `GET /estimates/{id}` · `POST /estimates/{id}/send` (returns wa.me link) · `POST /estimates/{id}/approve-call` · public `GET /e/{token}` + `POST /e/{token}/approve` |
| Parts requests | `GET/POST /requests` · `GET /requests/{id}` · `POST /requests/{id}/items/{iid}/approve` · `/reject` · `/issue` · `/unavailable` · `/link` · `POST /requests/{id}/issue-all` · `POST /requests/{id}/cancel` |
| Invoices | `POST /invoices/preview` · `GET/POST /invoices` · `GET /invoices/{id}` · `GET /invoices/{id}/html?lang=` · `POST /invoices/{id}/payments` · `POST /invoices/{id}/cancel` |
| Mechanics | `GET /mechanics/daily?date=` · `POST /mechanics/{id}/payments` · `GET /mechanics/{id}/payments?from=&to=` |
| Notifications & messages | `GET /notifications` · `POST /notifications/read` · `GET /messages/due` (service + payment reminders) · `POST /messages/log` |
| Dashboard & reports | `GET /dashboard` (role-aware) · `GET /reports/sales` · `/purchases` · `/stock` · `/profit` · `/dues` · `/payables` · `/gst` · `/mechanics` (all accept `from`, `to`, `format=csv`) |

## Modern UI design system and web screens

The look is clean, calm and fast: lots of white space, one strong accent, rounded cards, clear status colours, and big touch targets so it works on a counter touchscreen too. Light and dark themes from the same tokens. The same tokens drive the mobile theme.

**Design tokens** (`tokens.css` and `mobile/src/theme/tokens.ts`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #F7F8FA | #0F1115 | Page background |
| `--surface` | #FFFFFF | #171A21 | Cards, sheets, tables |
| `--border` | #E5E7EB | #2A2F3A | Dividers, inputs |
| `--text` / `--text-muted` | #111827 / #6B7280 | #F3F4F6 / #9CA3AF | Body / secondary |
| `--primary` | #F97316 (orange) | #FB923C | Main actions, active nav — garage / workshop feel |
| `--primary-ink` | #FFFFFF | #111827 | Text on primary |
| `--success` / `--warning` / `--danger` / `--info` | #16A34A / #D97706 / #DC2626 / #2563EB | lighter tints | Status chips, alerts |

- **Type:** Inter for English, Noto Sans Devanagari for Marathi; scale 12 / 14 / 16 / 20 / 24 / 32; numbers use tabular figures; amounts always formatted `₹1,23,456.00` (Indian grouping).
- **Shape and space:** 4 px spacing grid; radius 8 (inputs), 12 (cards), 999 (chips); soft shadow on cards only; 44 px minimum touch target.
- **Motion:** 150–200 ms ease-out on hover, drawers and toasts; respect `prefers-reduced-motion`.
- **Components:** app shell (collapsible left sidebar + top bar with search, language switch, notifications bell, user menu), buttons (primary / secondary / ghost / danger), inputs with inline validation, searchable select, date picker, status chips, KPI stat cards, data table (sticky header, sort, filter chips, pagination, row actions, CSV export), side drawer for create/edit, modal for confirm, toast, skeleton loaders, empty states with an illustration + one action, kanban board.
- **Command palette:** `Ctrl + K` searches customers, bikes, job numbers, parts and invoices from anywhere.
- **Responsive:** sidebar collapses to a bottom bar under 768 px; tables become cards on phones.
- **Accessibility:** WCAG AA contrast, visible focus rings, full keyboard use, labels on every input.

**Web screens**

1. Login (language toggle, show password)
2. Dashboard (role-aware KPI cards, 30-day sales chart, approvals waiting, low stock, today's jobs)
3. Job board (kanban by status) and job detail (customer + bike header, timeline, estimate, parts, labour, requests, photos, bill)
4. New job card (phone / bike number lookup, quick-create customer and bike, complaint chips for common problems)
5. Parts requests queue (inventory) with approve / issue / unavailable actions
6. Parts catalogue, part detail with ledger, stock count, reorder list, QR label print
7. Suppliers, purchase bill entry (fast keyboard grid), supplier ledger and payments
8. Customers list, customer detail with bikes, history and ledger; credit settings (owner)
9. Billing: job invoice, counter sale (POS-style with part search + barcode field), payments, invoice view / print
10. Mechanic daily summary (owner)
11. Reports (tabs per report, date range, CSV export)
12. Settings: shop details, GST, numbering, approval limit, labour rate list, locations, categories, users

## Android app screens by role

One app; after login the bottom tabs change by role. Design for low-end Android phones (2–3 GB RAM, 360 px wide), greasy hands and noisy shops: large buttons, big text, few taps, haptic feedback, and clear success / error toasts.

| Role | Bottom tabs | Key screens |
| --- | --- | --- |
| Mechanic | My jobs · Requests · Parts · Me | Job detail (status buttons, inspection notes, add labour from rate list, photos) · Request parts (search / QR scan, quantity stepper, free-text part, send) · Request status per line · Stock lookup with rack |
| Inventory manager | Queue · Approvals · Stock · Purchases · Me | Request queue with issue / unavailable per line · Approvals (≥ ₹1,000) · Part detail + ledger + adjust · Stock count by rack with QR scan · Reorder list (share on WhatsApp) · Purchase bill entry · Supplier payments |
| Front desk | Jobs · New job · Billing · Customers · Me | Lookup by phone / bike number · New job card · Estimate builder + send on WhatsApp · Mark approved on call · Generate bill, take payment, share PDF · Counter sale · Customer ledger, record payment |
| Owner | Home · Approvals · Jobs · Money · More | Dashboard · Approvals (parts ≥ ₹1,000) · Discounts on bills · Trusted customers + credit limits · Mechanic daily summary + payments · Dues and payables · Reports · Settings and users |

**App behaviour**

- First launch asks for the server address (prefilled with the shop domain) and language; then login. Token kept in `expo-secure-store`.
- Pull-to-refresh on every list; TanStack Query caches lists so screens open instantly; queue and approvals refresh every 20 s while visible.
- Push notifications (Expo) for new requests, approvals needed, parts issued / unavailable, bike ready.
- If offline: show a clear banner, keep showing cached data, disable save buttons (no offline writes in v1).
- QR scanner via `expo-camera` for parts and racks.
- Bills and estimates: fetch `/invoices/{id}/html?lang=`, render to PDF with `expo-print`, share to WhatsApp with `expo-sharing`.
- Version check on launch against `GET /settings` `min_app_version`; prompt to update the APK.

## Marathi + English localisation

- Each user picks a language (stored on `users.language`); switchable from the top bar / profile at any time.
- All UI strings live in `en.json` and `mr.json`, shared by web and mobile; no hard-coded text in components. Missing Marathi keys fall back to English.
- Data that has two names (parts, categories, locations, labour rates) stores `name_en` and `name_mr`; screens show the user's language, search matches both.
- **Customer documents are bilingual:** estimate, invoice and WhatsApp messages show Marathi and English together (labels like "एकूण / Total"; item names in both where available).
- Amount in words in English and Marathi on the invoice.
- Numbers stay in Western digits (0–9) in both languages for clarity; dates as DD-MM-YYYY.
- The customer's language (`customers.language`) decides which language comes first in WhatsApp messages.

## Security, deployment on cPanel, backups

**Security**

- HTTPS only (cPanel AutoSSL); redirect HTTP to HTTPS in the root `.htaccess`.
- Prepared statements everywhere; validate and whitelist every input field; escape all output in HTML templates.
- bcrypt passwords; login rate limit (5 failed tries → 10 min lock per username + IP); force password change on first login of seeded users.
- `config.php`, `lib/`, `routes/`, `templates/`, `cron/` blocked from direct web access.
- Role checks in the API for every route; cost fields stripped for non-cost roles.
- Public estimate links use a random 32-byte token, expire after 7 days, and show no other customer data.
- `audit_log` records discounts, invoice cancels, stock adjustments, credit changes and user changes.

**Deployment (write `docs/DEPLOY.md` as step-by-step with screenshots placeholders)**

1. cPanel → MySQL Databases: create DB + user, grant all.
2. phpMyAdmin: import `schema.sql`, then `seed.sql`.
3. File Manager: upload `public_html/` contents; copy `config.sample.php` → `config.php`, fill DB details and a random JWT secret.
4. Select PHP 8.1+ in "MultiPHP Manager"; enable AutoSSL.
5. Cron Jobs: `php ~/public_html/api/cron/reminders.php` daily 8 AM; `php ~/public_html/api/cron/backup.php` daily 11 PM.
6. Log in as `admin`, change password, fill shop details and GSTIN.
7. Build the APK (`eas build -p android --profile preview`), share it, set the server URL on first launch.

**Backups**

- Nightly cron dumps the database to a gzipped SQL file outside `public_html`, keeps the last 14, and the owner can download the latest from Settings.
- Also rely on the host's daily backups.

## Build phases with acceptance criteria

Build in this order; finish each phase (API + web + mobile + tests) before the next. Each phase ends with a working, deployable app.

1. **Foundation + inventory** — schema, seed, API core (router, auth, roles, errors), design system, app shell on web and mobile, i18n, settings, users, parts, locations, stock ledger, stock count, QR labels.
   - Accept: owner and inventory manager can log in on web and phone in both languages; create a part with Marathi name, rack and opening stock; stock count posts a difference; ledger balance always equals `current_stock`; mechanic cannot see purchase price via the API.
2. **Suppliers + purchases** — suppliers, purchase bills with GST, credit purchases, supplier payments and ledger, reorder list.
   - Accept: a credit purchase bill raises stock, updates last purchase price/discount and the supplier balance; a part payment reduces it.
3. **Customers, job cards, estimates, parts requests** — lookup, job card, estimate + WhatsApp link + public approval page, request → ₹1,000 approval → issue / unavailable, returns, notifications.
   - Accept: a job cannot start before approval; a ₹1,450 tyre line waits for approval while a ₹150 spark plug can be issued at once; issuing more than stock is refused; mechanic gets a push when parts are issued.
4. **Billing + payments** — job invoice, counter sale, owner-only discounts, credit for trusted customers, payments, bilingual invoice HTML/PDF, cancellation.
   - Accept: GST totals match a hand-checked example (inclusive and exclusive modes, intra- and inter-state); front desk discount is refused; credit to a non-trusted customer is refused; WhatsApp share opens with the PDF.
5. **Owner tools + reports** — dashboard, mechanic daily summary + payments, all reports with CSV, GST summary, service and payment reminders, backups.
   - Accept: profit report = sales − parts cost − mechanic payments for the range; GST summary output − input matches invoice and purchase totals; cron produces the reminder list and a backup file.

**Testing expected from Claude Code**

- PHP: a lightweight test runner (`tests/run.php`) against a SQLite or test MySQL database covering GST maths, stock movements, permissions and every acceptance case above.
- Web: Playwright smoke tests for login, create job, request → issue, bill.
- Mobile: TypeScript strict mode; type-check and lint clean; manual test checklist in `docs/`.

## Assumptions and open questions

**Assumed (change if wrong)**

- Approval limit is per request line (qty × selling price ≥ ₹1,000), editable in settings.
- Labour on bills comes from an editable rate list; amounts can be changed per job.
- Selling prices include GST (MRP style); switchable in settings.
- Single shop in Maharashtra (state code 27); GST 18% default for parts and labour, to be confirmed by the shop's CA.
- WhatsApp is click-to-send in v1; no paid WhatsApp API.
- No offline writes in the mobile app in v1.
- Both A4 printing (web) and PDF on WhatsApp (mobile) are supported, so the printer choice does not block the build.

**Open questions**

- [ ] Does the counter have a computer or laptop, or will billing be on a phone / tablet only?
- [ ] Printer: A4, Bluetooth thermal (2–3 inch), or PDF only? A thermal receipt layout can be added in Phase 4 if needed.
- [x] Shop name: **Trimurti Auto**. Address, GSTIN and domain still to come (placeholders in seed; editable in Settings).

## Decisions adopted for the build (13 Nov 2026)

Defaults chosen where the spec was silent. Change them here first if any are wrong.

1. **Costing:** weighted-average net cost, excluding GST (`parts.avg_cost`). Each purchase line recalculates it; each outbound movement records the current average as `unit_cost`. Stock valuation and profit use it.
2. **Bill-level discount** is spread over lines in proportion to their gross value before tax (so taxable value and GST drop correctly by rate).
3. **Invoices have a `draft` state.** Front desk creates the draft; the owner can set discounts on it; finalising assigns the invoice number, posts stock (counter sale) and takes payment.
4. **Free-text request lines** must be linked to a catalogue part before the approval rule is evaluated or the line is issued.
5. **Partial issue:** a line stays open (`approved` / `requested`) with `issued_qty < qty`; it becomes `issued` when `issued_qty = qty`, or the remainder is marked `unavailable`.
6. **Job status rules:** parts requests only from `approved`, `in_progress` or `waiting_parts`; a pending revised estimate blocks invoicing until approved; `delivered` is set by hand after the invoice is final; cancelling a job invoice returns the job to `ready`.
7. **Customer payments** are split across invoices through a `payment_allocations` table (oldest unpaid invoice first, or a chosen invoice).
8. **Service reminder by km:** km per day is estimated from the last two odometer readings of the bike; a bike is due when estimated km since last service ≥ 3,000 or days ≥ 90.
9. **Invoice numbers:** `INV/26-27/00001` (15 characters, within the GST 16-character limit). Job `JC-0001`, estimate `EST-0001`.
10. **Credit limit 0** on a trusted customer means no limit (as written).
11. **Extra fields:** `login_attempts` table; `users.must_change_password`; `estimates.sent_at`, `expires_at`; `customers.opening_balance`; `parts.avg_cost`; `stock_movements.balance_after`; `min_app_version` setting; public `GET /public/info` (shop name, min app version) for the login screen and app setup.
12. **Tests** run against MySQL 8 (Docker), not SQLite. Backups use a pure-PHP dump (no `exec`). Excel import is parsed in the browser and posted as rows. QR codes are drawn client-side with a vendored `qrcode-generator`.
13. **Inventory manager reports:** stock, purchase register and supplier payables.
14. **Job photos** are stored in `api/storage/` (blocked from the web) and served through an authenticated endpoint.
15. **Invoice cancellation** stays as specified; ask the CA whether a credit note is needed once GSTR-1 is filed.
16. **Shop feedback (15 Nov 2026) – simpler job flow:** front desk / owner can **Approve** a job at the counter (estimate optional; approves the latest draft/sent estimate if any). Catalogue parts on the approved estimate become *planned* job parts (`job_parts.issued = 0`, estimate price) and go on the bill with its labour; the store issuing the same part uses up the planned line. The bill can be made any time after approval (`approved`, `in_progress`, `waiting_parts`, `ready`); planned parts leave stock when the bill is **finalised** (short stock stops finalising). Mechanic parts requests stay optional. `delivered` is allowed from any of those statuses once the bill is final. Free-text estimate parts are not copied (no stock item).
17. **Per-person permissions (shop feedback, 15 Nov 2026):** roles stay as the default set; the owner ticks / unticks
    per person: see money, see purchase prices, make bills, give discounts, cancel bills, jobs, customers, edit parts,
    purchases, issue parts, reports (`users.permissions` JSON stores only differences from the role). Owners always
    have everything; settings, users, backups, credit limits and mechanic pay stay owner-only. The API enforces every
    permission (route option `perm`); web menus / pages and Android tabs / buttons follow them.
18. **Dashboard (shop feedback):** sale and purchase bill totals for today and this month plus the latest 8 bills of
    each; sales need "see money", purchases need "purchases". **Part numbers** print on bills and receipts.
19. **Purchase bill cancel / correct (16 Nov 2026):** a purchase bill is never edited in place. **Cancel** (reason
    required) takes its parts back out of stock at the cost they came in at (the weighted average is worked back; refused
    when the stock is already used) and drops it from supplier balance, reports, GST input and the dashboard; money
    already paid stays with the supplier as advance. **Correct** = a new bill with `replaces_id`: the new stock goes in
    first, then the old bill is cancelled (`replaced_by`) and its payments move to the new bill; only the difference is
    paid for a non-credit bill. The bill number is unique per supplier among bills that are not cancelled.
20. **Sale returns / credit notes (16 Nov 2026):** a final bill takes returns line by line (`POST /invoices/{id}/returns`,
    "cancel bills" permission). Each line is reversed in proportion to the bill line (last units take exactly what is
    left; `return_line` / `return_totals` in lib/gst.php); the total is rounded to the rupee and never exceeds what is left
    of the bill. Parts go back to stock at the cost they left at unless marked faulty. `invoices.returned_total` lowers what
    the bill needs; payments beyond that come off the bill (latest first) and become advance, or are refunded now (cash /
    UPI / bank) up to what the customer is owed after all their bills; a walk-in customer must get it all back. Numbers:
    `CN/yy-yy/00001` against a GST bill, `RET/yy-yy/00001` against a plain bill. Returns show as minus rows in the sales
    register and lower output GST and profit in the month they happen. A bill with returns can no longer be cancelled.
21. **Cash book (16 Nov 2026):** shop expenses (rent, electricity, tea / snacks, fuel, tools, staff salary, shop repairs,
    transport, other; cash / UPI / bank) and a once-a-day cash count, under a new "cash_book" tick (owner + front desk by
    default). Expected cash = opening + cash from customers − cash given back on returns − cash paid to suppliers − cash
    expenses − mechanic pay (mechanic pay is treated as cash, on the day it is entered). The first count asks for the
    opening; after that the opening is the previous count minus what was taken out. A counted day is locked (no expense
    changes) until the owner reopens it. Profit = sales − parts cost − mechanic pay − expenses.
22. **Purchase bills the shop's way (19 Nov 2026, from the shop's notes):** each bill is entered either as "MRP / with
    GST, less discount" (the screens' default: 10 × MRP 185 − 22% = 1443, GST worked out from inside the price) or
    "without GST" (GST added on top, as before; still the API default so older phone apps keep working). Each line may
    carry the MRP; saving makes it the part's selling price (audited as a price change; only for people with the
    edit_parts tick). parts.last_purchase_price stays without GST in both modes. Suppliers get a contact person, shown
    with the phone on the purchase bill.
23. **MRP and Rate on bills (19 Nov 2026):** bill lines show the MRP (the part's price on the bill), the discount and
    the Rate = one unit after its discounts (line + share of a bill discount), on screen, on the A4 bill and on the
    thermal receipt ("2 × 180.00", with "MRP 200.00 −10%" underneath when discounted). Labour lines have no MRP.
    Discounts stay owner-only (give_discount).
24. **Expense types (19 Nov 2026):** the fixed expense categories of decision 21 became a list the owner keeps
    (Settings → Expense types on the web, "Change the list" in the phone's cash book): add, rename, hide. It starts with
    the shop's own list (tea, snacks, water, tools, machinery, racks, then rent, electricity, fuel, salary, shop repairs,
    transport, other). expenses.category_id; the old codes (tea_snacks, fuel, …) are still accepted from older phone apps.
25. **Next service due (19 Nov 2026):** every job card shows when the bike should come back, by date and km, whichever
    comes first. Until someone with the jobs tick changes it, it is the job date + service_reminder_days and the job's km
    + service_reminder_km; clearing both goes back to that. It can be changed after delivery too. It prints on the A4
    bill and the thermal receipt, is copied to the bike on delivery (and when the bike's latest delivered job changes),
    and then decides the service reminder (due once the date has passed or the estimated km is reached); bikes without
    one keep the old rule (decision 8).
26. **Bill photos (19 Nov 2026):** an expense and a purchase bill can each keep one photo of the paper bill (camera or
    gallery; JPEG / PNG / WebP up to 6 MB), added while entering it or later, replaced or removed. Files are kept in
    api/storage/bills/ (never served directly; not in the SQL backup, like job photos) and removed with the record and
    on the go-live reset.
27. **Dashboard tiles (19 Nov 2026):** the dashboard (web and the owner's phone Home) starts with the shop's eight big
    buttons - Purchase bill (new), Sales bill (counter sale, with or without a customer), Stock, Job card (new), Supplier
    payables (with the total when money may be seen), Expenses (cash book), Reports, Suppliers - each shown only to people
    whose ticks allow it; the figures stay below them.
28. **Shop requests of 19 Nov 2026 (phone):** suppliers and parts can be added and edited on the phone (purchases /
    edit_parts ticks), also "New supplier" from the purchase bill's supplier search. Dates on the phone are picked from
    the calendar, never typed (the typed purchase date failed for everyone: the old check turned the day into UTC, where
    midnight in India is still the previous day). Parts import from Excel on the phone and the web; headings are matched loosely on the
    server (English or Marathi: Part No, Part Name, MRP, Rate, Qty, GST …; ₹ % and commas allowed), a missing part
    number gets an automatic P00001… (or updates the part with the same name), and GET /parts/import-sample gives a
    sample .xlsx with a "How to fill" sheet. The shop phone printed on bills became 8669116229 (migration 011, only if it
    was still the old number).
29. **Shop requests of 19 Nov 2026, second batch:** (a) a purchase bill can be filled from the supplier's Excel / CSV
    (POST /purchases/import-lines: headings matched loosely - Item Code, Particulars, Qty, Rate, Disc %, GST % or CGST %,
    MRP; parts matched by number, then name; unknown parts become new parts saved with the bill, numbered P00001… when
    the sheet has no number; rows without qty are left out and listed). (b) Phone screens keep their content above
    Android's navigation bar (the app draws edge to edge, so the last button was half hidden). (c) MRPs change: a
    "Change MRP" pencil on counter-sale and draft-bill lines sets the part's selling price (audited) for this bill and
    later ones; on a job bill the job's parts take it too. New tick change_mrp (owner + store keeper by default; the
    owner can give it to the front desk). Discounts stay owner-only.
30. **Shop requests of 19 Nov 2026, third batch (answers from the owner):**
    - Parts upload: "The sheet's quantity becomes the stock" (default on) sets each existing part's stock to the sheet's
      quantity through a stock adjustment "Excel upload". The owner can "Replace the whole parts list": a backup is
      taken first; any wrong row stops the whole upload (nothing changes); parts not in the sheet are deleted when never
      on a purchase, bill, job, request, estimate or return, otherwise hidden with their stock adjusted to 0.
    - Suppliers can be deleted; one with bills, payments or an opening balance is hidden instead.
    - Purchase bills: "Correct bill" and "Cancel bill" stay the way to change them (no hard delete); on the phone they
      sit right under the bill header.
    - The owner (cancel_bills tick) edits a final sales bill and it keeps its number: qty, price, discount, remove lines,
      add parts (counter bills), bill discount, walk-in name / phone. Stock follows the difference (job bills through
      the job's parts). If the bill goes up the extra is collected now (credit only for trusted customers within their
      limit); if it goes down a customer keeps the extra as advance and a walk-in customer gets it back (bill_refunds,
      in the cash book). Not after a return or a change of GST registration. Every edit is previewed first and audited
      with the old and new lines; the bill shows "Edited … by …".
31. **Design refresh (19 Nov 2026, owner's choice "Fresh & light, keep orange"), web and phone together:** softer
    off-white background (#F4F6FA), white cards with 16–18 px corners and soft shadows, rounder buttons and inputs, an
    orange brand gradient (#C2410C → #EA580C → #F97316; white text only on its darker part). A simple logo: "TA"
    monogram over a road line on the gradient (web sidebar, login, favicon, Android icon / splash, A4 bill; black on
    the thermal receipt). Home starts with a gradient banner (greeting, today's sales / bills / jobs) above the eight
    tiles, which now have colourful round icons. Bike numbers look like Indian number plates. Bill totals sit on a
    soft orange band. Phone tab bar: active tab on an orange pill; its height includes Android's navigation bar.
32. **Shop requests of 23 Nov 2026 (answers from the owner):**
    - The shop's own logo and colours: a grey gear with a red ring and spanner (drawn as SVG, same in the web app,
      the bills, the phone app and the Android icons; black on the thermal receipt). Buttons and the brand colour are
      the logo's red #C1272D with white text (5.8:1; dark mode #D63339); the banner gradient runs from the logo's grey
      to its red. This replaces the orange of decision 31; the rest of that design stays.
    - Two shop names: the short `shop_name` ("Trimurti Auto") inside the app, and `shop_full_name` / `shop_full_name_mr`
      ("Trimurti Rambhau Auto Spares and Garage") on bills, receipts, returns, the estimate page, the login screen and
      WhatsApp messages (falls back to the short name when empty).
    - A bill can be made straight from any open job card (not delivered / cancelled). If the job is still pending or
      its estimate is only sent, making the bill approves it (person with the jobs permission). An empty draft is
      allowed; finalising still needs at least one line. Parts can be added straight on the job (planned, issued 0, at
      the part's selling price; they leave stock when the bill is finalised) and the open draft bill follows every
      change to the job's parts and labour.
    - Excel uploads (parts list and supplier bills) read the sheet as a table: the heading row is found anywhere in
      the first 40 rows (supplier name and address above the table are fine), headings are matched loosely (Tally /
      Busy style: Particulars, Qty, Rate, Amount, HSN/SAC, GST %…), and total / tax / round-off rows are skipped.
      The phone's file picker accepts any file type (some phones label .xlsx oddly).
33. **Shop requests of 24 Nov 2026 (answers from the owner):**
    - The owner changes a person's name, phone and username (login ID) on the web and the phone. A new username
      works from the next login; people already logged in stay logged in. A username used by someone else is refused
      on the field (`taken`).
    - Mechanics may be without a login (`users.username` and `password_hash` NULL, migration 013): they are given
      jobs and paid but never open the app. "Uses the app" gives a login (username + temporary password); turning it
      off ends his open sessions. Every other role needs a login.
    - Mechanic summary (web and phone) adds, edits and removes mechanics. Removing anyone (also from Users): deleted
      when nothing in the records points at them, otherwise hidden (inactive) so old jobs, bills and pay keep the
      name; brought back from Users. Not yourself, not the last owner, not a mechanic with open jobs. A hidden
      mechanic still shows in the summary for days he worked or was paid.
    - Bikes in the shop come in two parts: **Processing** (pending, estimate sent, approved, in progress, waiting
      for parts) and **Completed** (ready: work done, waiting for the bill or the customer; leaves on delivery).
      Home shows both numbers; the web Jobs page has All / Processing / Completed chips (`?stage=`), the phone's
      Jobs tab two tabs.
