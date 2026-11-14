# Deploying Garage Manager on cPanel

Everything runs on an ordinary cPanel shared host: no SSH, no Composer, no build step on the server.
Allow about 30 minutes. Screenshots are marked **[screenshot]** – add your host's own when you do it the first time.

## What you need

- A cPanel account with **PHP 8.1 or newer** and **MySQL 8 / MariaDB 10.6+**.
- Your shop domain pointed at the account (e.g. `foreverstory.in`), **or a subdomain** of it (below).
- The project files (this repository).

## Main domain or subdomain?

A subdomain such as `trimurti.foreverstory.in` works exactly like the main domain – the app has no fixed
paths – and leaves the main domain free for a shop website. A second subdomain with its **own database**
(e.g. `trimurti-test.foreverstory.in`) is a good place for the trial and for testing new APKs.

For a subdomain, change these steps:

1. cPanel → **Domains** (older cPanel: **Subdomains**) → create `trimurti.foreverstory.in`. Note its
   **document root** – newer cPanel uses `/home/<cpaneluser>/trimurti.foreverstory.in`, older cPanel
   `/home/<cpaneluser>/public_html/garage`. Wherever this guide says `public_html`, use that folder.
2. In `config.php` (step 3): `app_url` → `https://trimurti.foreverstory.in`, and **always** write
   `backup_dir` as a full path: `/home/<cpaneluser>/backups`. With the older layout the default would put
   backups inside the main site's `public_html`, where they could be downloaded (Settings → System shows it red).
3. HTTPS (step 4): AutoSSL covers the subdomain once its DNS points at the server. If the domain's DNS is
   managed outside cPanel, add an **A record** `garage` → the server's IP first. MultiPHP Manager is per
   domain – set the subdomain to PHP 8.1+ as well.
4. Cron jobs (step 5) use the subdomain's folder, e.g.
   `/usr/local/bin/ea-php81 /home/<cpaneluser>/trimurti.foreverstory.in/api/cron/backup.php`.
5. The Android app's server address is `https://trimurti.foreverstory.in`.

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

> **cPanel has Git™ Version Control?** Skip the uploads: create only `api/config.php` by hand (point 3
> below, inside the site folder – make the `api` folder first), then follow § 9 steps 1–3. The first
> *Deploy HEAD Commit* copies every file, and every later update comes from GitHub.

1. cPanel → **File Manager** → open `public_html`.
2. Upload the **contents** of this repository's `public_html/` folder (not the folder itself) – easiest as a zip, then *Extract*.
   On the development PC, `node tools/make-release.mjs` builds `dist/garage-manager-<date>-<commit>-site.zip`
   (contents of `public_html`, hidden `.htaccess` files included) plus the database and docs zips.
3. In `public_html/api/` copy `config.sample.php` to **`config.php`** and edit it:
   - `db` → host `localhost`, the database name, user and password from step 1.
   - `jwt_secret` → a long random string (64+ characters). Changing it later logs everyone out.
   - `app_url` → `https://trimurti.foreverstory.in` (used in the WhatsApp estimate links).
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

1. Open `https://trimurti.foreverstory.in`.
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
  estimate page loads at `https://trimurti.foreverstory.in/e/...` and **Approve** works.
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
asks for the server address – enter `https://trimurti.foreverstory.in` – and the language.

**Push notifications** (optional – the in-app bell works without them): create a Firebase project, add an
Android app with package `in.trimurtiauto.garage`, then `npx eas-cli credentials` → *Android* → *Push
Notifications* → upload the FCM v1 service-account key. Rebuild the APK.

When you publish a new APK, set **Settings → App → Minimum app version** to force old phones to update, and
put the APK link in **Link to latest APK**.

## 9. Automatic deploys from GitHub (optional)

Once the first install (steps 1–7) works, updates can go out from GitHub: automatically to the test site,
and with one click (plus your approval) to the live site. Nothing is uploaded by hand any more.

**How it works.** GitHub Actions calls the cPanel API → the server pulls the commit into its own copy of the
repository and runs `.cpanel.yml` → `tools/cpanel-deploy.sh`:

1. backup of the database (kept with the nightly ones),
2. copy of the committed `public_html` files into the site folder – `api/config.php`, photos and logs are
   never touched and nothing is deleted,
3. database changes (`api/cron/migrate.php`),
4. a note of the commit, which `https://<site>/api/public/info` reports. The workflow waits until the site
   shows the new commit, so a deploy that did not land fails loudly.

You need cPanel with **Git™ Version Control** and **Manage API Tokens** (most cPanel hosts have both), and
the host must allow connections to cPanel's port 2083 from outside (almost all do).

### One-time setup in cPanel (repeat for the test site with `-test` names)

1. **Git Version Control → Create**. *Clone a Repository* on; Clone URL
   `https://github.com/varunschaudhari/garagio.git`; Repository Path
   `/home/<cpaneluser>/repositories/garagio-live`; Repository Name `garagio-live` → *Create*.
   Then *Manage* → **Checked-Out Branch** `main` → *Update*.
   (The repository is public. If you make it private, add the server's SSH key as a read-only
   **deploy key** on GitHub and use the `git@github.com:…` clone URL.)
2. **Terminal** (or File Manager → *+ File*) – create `/home/<cpaneluser>/repositories/garagio-live/.deploy.env`:

   ```
   DEPLOY_PATH=/home/<cpaneluser>/trimurti.foreverstory.in
   PHP_BIN=/usr/local/bin/ea-php81
   ```

   `DEPLOY_PATH` is the subdomain's document root, `PHP_BIN` the PHP version from MultiPHP Manager.
   (The file is git-ignored, so the repository stays "clean" for cPanel.)
3. Try it by hand once: Git Version Control → *Manage* → **Pull or Deploy** → *Deploy HEAD Commit*.
   Settings → System → "Deployed version" now shows the commit. If it failed, the deploy log is linked there.
4. **Manage API Tokens → Create**: name `github-deploy`, expiry 1 year → copy the token (shown only once).

### One-time setup on GitHub

5. Repository → **Settings → Environments** → *New environment* `live` (and `test` for the test site).
   On `live`, tick **Required reviewers** and add yourself – a live deploy then waits for your approval.
6. In each environment add these **secrets**:

   | Secret | Value |
   |---|---|
   | `CPANEL_HOST` | The server name you open cPanel at, without `https://` and `:2083` (from the hosting welcome e-mail, e.g. `server123.example-host.in`) |
   | `CPANEL_USER` | Your cPanel username |
   | `CPANEL_TOKEN` | The token from step 4 |
   | `CPANEL_REPO_PATH` | `/home/<cpaneluser>/repositories/garagio-live` |

   and one **variable**: `SITE_URL` = `https://trimurti.foreverstory.in` (test: `https://trimurti-test.foreverstory.in`).

### Using it

- Merge a change into `main` → CI runs → when it is green the **test** site updates by itself
  (skipped quietly while the `test` environment is not set up).
- **Live**: GitHub → **Actions → Deploy → Run workflow** → branch `main`, target `live` → approve.
  About 2–3 minutes. Deploy outside shop hours when you can.
- **Undo**: revert the bad commit on `main` and deploy again. If a database change went wrong, restore the
  backup the deploy made just before (Settings → Backup, or phpMyAdmin → Import).
- **Android app**: **Actions → Android APK → Run workflow**. Needs the `EXPO_TOKEN` secret
  (expo.dev → Account settings → Access tokens) and `npx eas-cli init` run once in `mobile/` and committed.

No Git Version Control or API tokens at your host? Keep updating by hand (below) with the release zip.

## Updating by hand

1. Back up first (Settings → Backup → Back up now).
2. Upload the changed files over the old ones (never overwrite `api/config.php` or `api/storage/`) – easiest
   is the site zip from `node tools/make-release.mjs`.
3. If Settings → System shows **Database updates** pending, run `php api/cron/migrate.php` in cPanel →
   Terminal (or as a one-time cron job).

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Server not configured” | `api/config.php` is missing – step 3. |
| Logged out immediately / “Please log in again” on every click | Host strips the `Authorization` header; the apps also send `X-Auth-Token`, so check `api/.htaccess` was uploaded. |
| API returns 404 for everything | `mod_rewrite` is off; the web app falls back to `api/index.php?r=…` automatically. Ask the host to enable it for nicer URLs. |
| Blank page / “Server error” | See `public_html/api/storage/logs/error-YYYY-MM.log`. |
| Estimate link opens the home page | `public_html/.htaccess` was not uploaded (hidden file – enable “show hidden files”). |
| Backup warning in Settings | `backup_dir` points inside `public_html`; move it outside in `config.php`. |
