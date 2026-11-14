# Going live at Trimurti Auto

This is the order of work from "the site is installed" to "paper slips are gone". Installing the site and
building the Android app are in `DEPLOY.md`; staff instructions in Marathi are in `USER_GUIDE_MR.md`.

Plan for about two weeks: **2–3 days of setup**, **half a day of trial**, **one week of pilot** alongside paper.

---

## 1. Shop details (owner, 15 minutes)

Settings → **Shop** and **Billing & GST**. Copy the details exactly as on the GST registration certificate.

| Setting | What to enter | Prints on |
|---|---|---|
| Shop name (English / Marathi) | Legal or trade name as registered | Every bill, estimate, WhatsApp message |
| Address (English / Marathi) | Already filled in: *Beside Ambedkar Statue, Dharangaon - 425105* / *आंबेडकर पुतळ्याशेजारी, धरणगाव - 425105* – check it | Bills, receipts, estimates |
| Phone | Already filled in: 8956252573 – check it | Bills, receipts, estimate page "Call me" |
| GSTIN | 15 characters, e.g. `27ABCDE1234F1Z5` | Every tax invoice |
| State | Maharashtra (27) | Decides CGST + SGST or IGST |
| Prices include GST | On if your selling prices are MRP-style (GST inside) | Bill maths |
| GST % on labour / SAC | Currently 18 % and SAC 998714 – **confirm with the CA** | Labour lines |
| Invoice prefix | Up to 4 letters; bills look like `INV/26-27/00001` | Bill numbers |
| Invoice terms (both languages) | Your shop's terms | Bottom of every bill |
| UPI ID | e.g. `trimurtiauto@okaxis` – adds a "scan to pay" QR to bills | Bills with a balance |
| Thermal printer paper width | 58 mm or 80 mm – the shop bills from phones on a Bluetooth receipt printer (`PRINTER_SETUP.md`) | Receipts |

Then Settings → **System**: every line should be green or yellow. Fix every red line before billing.

---

## 2. Questions for the CA (take this page)

The system was built with the defaults below. Ask the CA to confirm or correct each one **before the first real bill**.

1. **Registration type.** Is the shop a *regular* GST taxpayer? (If it is under the *composition* scheme it must
   issue a "bill of supply" without GST – tell us before going live, the bill layout changes.)
2. **GST rates and HSN codes of parts.** The sample parts all use 18 %:

   | Category | HSN codes used | Rate |
   |---|---|---|
   | Engine (gaskets, piston kit, carburettor kit) | 84099990 | 18 % |
   | Spark plug | 85111000 | 18 % |
   | Brakes (shoes, pads) | 68138100 | 18 % |
   | Cables, chain sprocket kit, clutch plates | 87141090 | 18 % |
   | Drive belt | 40103999 | 18 % |
   | Tyres / tubes | 40114000 / 40131020 | 18 % |
   | Engine oil / chain lube / brake fluid | 27101980 / 34031900 / 38190010 | 18 % |
   | Air filter / oil filter | 84213100 / 84212300 | 18 % |
   | Bulbs / horn / battery | 85392190 / 85123010 / 85071000 | 18 % |
   | Bearings / oil seals / mirror | 84821011 / 40169320 / 70091090 | 18 % |

   Each part keeps its own HSN and rate (Parts → edit), so mixed rates on one bill are fine.
3. **Labour:** SAC **998714** at **18 %**?
4. **Invoice numbers:** `INV/26-27/00001`, a new series every financial year (1 April), at most 16 characters. OK?
5. **Cancelled bills:** the owner can cancel a final bill with a reason; the number stays in the series marked
   *cancelled* and the stock comes back. Is cancelling acceptable, or does the CA want a **credit note** for
   bills from a month whose GSTR-1 is already filed? (Credit notes are not built yet – this decides whether they are needed.)
6. **Discounts:** given on the bill before tax (they reduce the taxable value). OK?
7. **Round-off:** the bill total is rounded to the nearest rupee and the difference is shown as "Round off". OK?
8. **Customers with a GSTIN (B2B):** the bill shows their GSTIN and name; other-state GSTIN gets IGST. OK?
9. **Monthly data for GSTR-1 / 3B:** Reports → **GST summary** (CSV) gives output tax by rate and input tax from
   purchase bills. Ask which format the CA wants each month.

Write the answers here and change Settings / parts before the trial:

| # | CA answer | Changed in the system on |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6–9 | | |

---

## 3. Staff (owner, 15 minutes)

Settings → **Users** (or More → Users on the phone).

1. Add each real person with the right role: **owner**, **inventory manager**, **front desk**, **mechanic**.
   Mechanics need a phone number (it shows on the job card).
2. Give each person their username and the temporary password; they must set their own at first login.
3. **Deactivate** the demo users you do not need (`stock`, `desk`, `ramesh`, `mahesh`). Keep `admin` only if
   the owner uses it – otherwise create the owner's own login first, then deactivate `admin`.
4. Settings → System must no longer show "Users still on the demo password".

---

## 4. Parts and opening stock (inventory manager, 1–2 days)

Pick one way:

- **Excel import (fastest):** Parts → **Import**. One row per part: part no., name (English / Marathi), category,
  brand, models, unit, HSN, GST %, selling price, purchase price and discount %, location, rack, min stock,
  opening stock (valued at the purchase price less discount). Download the template from the import screen.
  Re-importing the same part no. updates it.
- **As bills arrive:** enter each supplier bill (Purchases → New); new parts can be created on the bill itself.

Then:

1. Print **QR labels** (Parts → QR labels) – one per rack and, for fast movers, one per part.
2. Do a **stock count** location by location (Stock count) so the app matches the shelves.
3. Set **min stock** on fast movers so the reorder list works.

## 5. Suppliers and customers (owner + front desk, half a day)

- **Suppliers:** name, phone (for WhatsApp orders), GSTIN, state and **opening balance = what you owe them today**.
- **Customers with dues or credit:** opening balance (owner only), mark **trusted** and set a credit limit
  (Customers → credit). Everyone else is created automatically when the first job is opened.

---

## 6. Trial run and "Go live" (everyone, half a day)

1. Run two or three complete rounds with the real staff on their own phones:
   job card → estimate on WhatsApp → customer approves on the link → mechanic starts work → parts request →
   inventory issues (and one ₹1,000+ part needing approval) → mark ready → bill → payment → deliver.
   Also one counter sale, one purchase bill and one supplier payment.
2. Print a **receipt** on the thermal printer (set up with `PRINTER_SETUP.md`) and look at it together with
   the CA's answers from section 2. Also send one **Share PDF** bill on WhatsApp.
3. Owner: Settings → **System → Go live**.
   - Parts: **Keep parts and today's stock** (if the stock count in section 4 is done), otherwise *set all stock to 0*
     and count again.
   - Customers and suppliers: **Remove only the demo ones** (keeps the real ones you entered).
   - Type `RESET`, your password → **Remove trial data**. A backup is taken first and kept for good.
4. Job, estimate and bill numbers now start again from 1. Settings → System shows "Live since".

---

## 7. One-week pilot alongside paper

For one week the shop works **in the app and on paper at the same time**. Paper stays the official record
until the end of the week. Each evening the owner spends 10 minutes on the checks below.

| Day | Focus | Evening check (owner) |
|---|---|---|
| 1 | Front desk opens **every** job card in the app (and writes the paper slip as usual) | Jobs in the app = paper slips today |
| 2 | Mechanics **request parts in the app**; inventory issues only from the queue | No part left the store without an issue in the app |
| 3 | **All bills from the app**, receipt printed for every customer (paper bill book copied from the app bill) | Dashboard "Today's sales" by cash / UPI = cash drawer + UPI app |
| 4 | **Purchase bills** entered the day they arrive; supplier payments recorded | Supplier balances look right |
| 5 | **Stock count** of one location | Differences are small and explained |
| 6 | **Reports**: sales, dues, GST summary for the week | Totals match the paper bill book |
| 7 | Review meeting with all staff | Decide: stop paper, or one more week |

**Keep an issue log** (a page in the counter notebook is enough): date, who, phone or computer, screen,
what happened, photo / screen recording. Send it at the end of each day, not one message per problem.

**Stop paper when all of these are true:**

- 5 days in a row the cash and UPI totals matched the drawer and the UPI app.
- No job, part issue or bill was missing from the app.
- Every staff member can do their daily work without help.
- No open problem that blocks work (wrong totals, lost data, app crashes).

---

## 8. After go-live: routine

| When | Who | What |
|---|---|---|
| Every evening | Owner | Today's sales vs drawer; approvals and requests empty; anything left "ready" but not delivered |
| Every day | (automatic) | 8 AM reminders cron, 11 PM backup cron – Settings → System shows when they last ran |
| Every week | Owner | Settings → Backup → **Download latest backup** and keep it off the server (Google Drive / pen drive) |
| Every week | Inventory | Count one location; reorder list → WhatsApp to suppliers |
| Every month | Owner | Reports → GST summary CSV to the CA; customer dues reminders; supplier payables |
| New APK | Owner | Settings → App: minimum version + link, so every phone updates |

## 9. When something goes wrong

| Problem | What to do |
|---|---|
| Wrong bill | Owner cancels it with a reason (same day if possible) and the desk makes a new one. Never re-use a number. |
| Internet or server down | Write paper slips / bills; enter them in the app first thing when it is back. |
| Phone lost or staff leaves | Owner deactivates the user at once – their phone is logged out immediately. |
| Forgotten password | Owner → Users → reset password (temporary; they set a new one at login). |
| Data looks wrong / need to go back | Do not keep working. Restore the last good backup (phpMyAdmin → Import the `.sql.gz`) – ask for help first. |
| Settings → System shows red | Fix it the same day; the line says how. |
