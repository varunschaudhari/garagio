# Deploying Garage Manager on cPanel

Everything runs on an ordinary cPanel shared host: no SSH, no Composer, no build step on the server.
Allow about 30 minutes. Screenshots are marked **[screenshot]** – add your host's own when you do it the first time.

## What you need

- A cPanel account with **PHP 8.1 or newer** and **MySQL 8 / MariaDB 10.6+**.
- Your shop domain pointed at the account (e.g. `trimurtiauto.in`).
- The project files (this repository).

## 1. Create the database

1. cPanel → **MySQL Databases**.
2. *Create New Database*: e.g. `garage` → cPanel names it `cpaneluser_garage`.
3. *Add New User*: e.g. `garage` with a strong password → `cpaneluser_garage`.
4. *Add User To Database* → tick **ALL PRIVILEGES** → *Make Changes*.

**[screenshot: MySQL Databases page]**

## 2. Import the tables and starting data

1. cPanel → **phpMyAdmin** → click the new database on the left.
2. **Import** → choose `database/schema.sql` → *Go*. (It refuses to run on a database that already has tables – that protects live data.)
3. **Import** again → choose `database/seed.sql` → *Go*.

The seed adds the shop settings (Trimurti Auto), demo staff, storage locations, categories, the labour rate list,
30 sample two-wheeler parts with opening stock, and a few demo suppliers / customers marked “(Demo)”.

**[screenshot: phpMyAdmin import]**

## 3. Upload the files

1. cPanel → **File Manager** → open `public_html`.
2. Upload the **contents** of this repository's `public_html/` folder (not the folder itself) – easiest as a zip, then *Extract*.
   On the development PC, `node tools/make-release.mjs` builds `dist/garage-manager-<date>-<commit>-site.zip`
   (contents of `public_html`, hidden `.htaccess` files included) plus the database and docs zips.
3. In `public_html/api/` copy `config.sample.php` to **`config.php`** and edit it:
   - `db` → host `localhost`, the database name, user and password from step 1.
   - `jwt_secret` → a long random string (64+ characters). Changing it later logs everyone out.
   - `app_url` → `https://your-domain.in` (used in the WhatsApp estimate links).
   - `backup_dir` → leave the default (`/home/<cpaneluser>/backups`, outside `public_html`).
4. Make sure `public_html/api/storage/` is writable (permission 755 is usually enough). Photos and error logs go there.

**[screenshot: config.php in File Manager editor]**

## 4. PHP version and HTTPS

1. cPanel → **MultiPHP Manager** → select the domain → **PHP 8.1** or newer → *Apply*.
   Needed extensions (normally on by default): `pdo_mysql`, `mbstring`, `json`, `gd`, `zip`, `zlib`, `curl`.
2. cPanel → **SSL/TLS Status** → *Run AutoSSL*. Wait until the domain shows a valid certificate.
   The site redirects HTTP to HTTPS automatically (`public_html/.htaccess`).

## 5. Cron jobs

cPanel → **Cron Jobs** → *Add New Cron Job* (twice). Use the PHP binary of the version you chose in step 4
(cPanel shows the path; often `/usr/local/bin/ea-php81`, or simply `php`):

| When | Command |
|---|---|
| Every day 08:00 | `/usr/local/bin/ea-php81 /home/<cpaneluser>/public_html/api/cron/reminders.php` |
| Every day 23:00 | `/usr/local/bin/ea-php81 /home/<cpaneluser>/public_html/api/cron/backup.php` |

The reminders job tells the owner and front desk how many service / payment reminders are waiting.
The backup job writes `garage-YYYYMMDD-HHMMSS.sql.gz` to the backup folder and keeps the newest 14.
Both scripts refuse to run from a browser.

## 6. First login

1. Open `https://your-domain.in`.
2. Log in as **admin / garage123** → you are asked to set a new password.
3. **Settings → Shop**: shop name, address, phone, **GSTIN**, state.
4. **Settings → Billing & GST**: check “prices include GST”, labour GST rate and SAC, invoice terms, UPI ID (adds a pay-by-QR on bills).
5. **Settings → Workflow**: approval limit (₹1,000), reminder periods.
6. **Users**: change the demo staff names or deactivate them and add your real staff (everyone must set their own password at first login).
7. **Settings → System** shows a check list (PHP, HTTPS, secret, backup folder, cron jobs, GSTIN, demo data).
   Fix every red line before you start; yellow lines are reminders.
8. When the trial is over, **Settings → System → Go live** removes all trial jobs, bills, purchases and
   payments (a backup is taken first), the “(Demo)” customers and suppliers, and restarts the numbering at 1.
   See `docs/GO_LIVE.md`.

> Ask your CA to confirm the HSN codes and GST rates on your parts before you start billing.

## 7. Check that it works

- Open a job card, prepare an estimate, **Send on WhatsApp** → open the link on a phone → the bilingual
  estimate page loads at `https://your-domain.in/e/...` and **Approve** works.
- Make a counter sale and **Print / PDF** the bill.
- **Settings → Backup → Back up now**, then **Download latest backup**.

## 8. Android app

On a computer with Node.js 20+:

```bash
cd mobile
npm install
npx eas-cli login            # your Expo account
npx eas-cli init             # once: links the project (adds extra.eas.projectId)
npx eas-cli build -p android --profile preview   # same as: npm run build:apk
```

Download the APK from the link EAS prints and share it with staff (WhatsApp / USB). On first launch the app
asks for the server address – enter `https://your-domain.in` – and the language.

**Push notifications** (optional – the in-app bell works without them): create a Firebase project, add an
Android app with package `in.trimurtiauto.garage`, then `npx eas-cli credentials` → *Android* → *Push
Notifications* → upload the FCM v1 service-account key. Rebuild the APK.

When you publish a new APK, set **Settings → App → Minimum app version** to force old phones to update, and
put the APK link in **Link to latest APK**.

## Updating later

1. Back up first (Settings → Backup → Back up now).
2. Upload the changed files over the old ones (never overwrite `api/config.php` or `api/storage/`).
3. If the release has files in `database/migrations/`, import them in phpMyAdmin in number order.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Server not configured” | `api/config.php` is missing – step 3. |
| Logged out immediately / “Please log in again” on every click | Host strips the `Authorization` header; the apps also send `X-Auth-Token`, so check `api/.htaccess` was uploaded. |
| API returns 404 for everything | `mod_rewrite` is off; the web app falls back to `api/index.php?r=…` automatically. Ask the host to enable it for nicer URLs. |
| Blank page / “Server error” | See `public_html/api/storage/logs/error-YYYY-MM.log`. |
| Estimate link opens the home page | `public_html/.htaccess` was not uploaded (hidden file – enable “show hidden files”). |
| Backup warning in Settings | `backup_dir` points inside `public_html`; move it outside in `config.php`. |
