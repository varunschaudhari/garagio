# Android app – manual test checklist

Run on a low-end Android phone (2–3 GB RAM, 360 px wide) before each release. Tick every box in **both
Marathi and English** unless the line says otherwise. Automated checks (`npm run typecheck`,
`npm run lint`, `npx expo export --platform android`) must pass first.

## How to test against a local server

1. On the PC: `docker compose up -d`, then `C:\xampp\php\php.exe tools\reset-dev-db.php` (fresh demo data).
2. Start the server on the Wi-Fi: `powershell -ExecutionPolicy Bypass -File tools\serve-lan.ps1`.
   It prints the address to type in the phone (e.g. `http://192.168.1.20:8080`) and the firewall command
   to run once if the phone cannot connect. WhatsApp estimate links also point at that address.
3. Phone and PC on the same Wi-Fi. Install **Expo Go** from the Play Store. In `mobile/`: `npx expo start`,
   scan the QR code with Expo Go. (Expo Go must support SDK 58; if the Play Store version is newer, build a
   test APK with EAS instead – see `docs/DEPLOY.md` § 8 – and point it at the HTTPS test site.)
4. First launch → the server address from step 2.
   (A real APK must use the HTTPS shop domain; Android blocks plain HTTP in release builds.)
5. Note every failure with the phone model, the language, the screen and what you tapped. A screen
   recording (Android quick settings → Screen record) is the fastest bug report.

## Phase 1 – foundation and inventory

### First launch and login
- [ ] First launch shows server address + language; a wrong address shows "not a Garage Manager server".
- [ ] Language choice changes the setup and login screens immediately.
- [ ] Login with a seeded user (`garage123`) forces a new password; back button does not skip it.
- [ ] Wrong password shows a clear error; 5 wrong tries → "try again after 10 minutes".
- [ ] After login the language follows the user's saved language.
- [ ] Killing and reopening the app keeps you logged in (token in secure storage).
- [ ] Raising "Minimum app version" in web Settings above the app version shows the update screen.

### Tabs by role
- [ ] Owner: Home · Stock · More.  Inventory manager: Home · Stock · Me.
- [ ] Front desk: Home · Stock · Me.  Mechanic: Stock · Me.

### Stock lookup
- [ ] Stock (owner / store keeper): "New part" opens the form; MRP and part name required; GST, location and category as chips; saving opens the new part. "Edit part" on a part changes it.
- [ ] "Import from Excel": "Get the sample Excel file" opens the share sheet with parts-import-sample.xlsx; choosing that file shows "3 rows found"; Import shows created / updated and the automatic part number note. An .xls and a .csv also work; a photo or PDF shows "Could not read this file".
- [ ] Search finds parts by English name, Marathi name, part no. and rack.
- [ ] Low-stock chip filters; low parts show the red "Low" chip.
- [ ] Pull to refresh works on every list.
- [ ] Part detail shows stock, location, rack, MRP, GST, HSN and the ledger.
- [ ] Mechanic and front desk never see average cost or purchase price.
- [ ] Owner / inventory manager see the cost tile and the "Adjust stock" button; others do not.
- [ ] Adjust stock with −2 and a reason → success toast + haptic; ledger shows "Adjustment"; going below zero is refused.

### QR scanning
- [ ] Print labels from the web (Parts → QR labels). Scanning a part label opens that part.
- [ ] Scanning a rack label opens the parts on that rack.
- [ ] Unknown code shows "No part with code …" and the scanner keeps running.
- [ ] Torch button works; camera permission prompt appears once and "Allow camera" works if denied.

### Stock count
- [ ] Location tabs list parts grouped by rack, in rack order.
- [ ] Entering a different count highlights the row; footer shows "N parts differ".
- [ ] Leaving the screen and coming back keeps entered counts.
- [ ] Scan button (header) jumps to the scanned rack or part.
- [ ] Post count → confirm → toast "Stock count posted"; web ledger shows "Stock count" rows.

### Offline
- [ ] Turn on airplane mode: orange offline banner appears, cached lists still show, save buttons are disabled.
- [ ] Turn it off: banner disappears and lists refresh.

### Look and feel
- [ ] Dark mode (system setting) is readable on every screen.
- [ ] Buttons are easy to hit with a thumb; no text is cut off in Marathi.
- [ ] Logout asks for confirmation and returns to login.

## Phase 2 – suppliers and purchases

- [ ] Inventory manager has a Purchases tab; the owner reaches Purchases, Suppliers and Reorder from More.
- [ ] New purchase bill: pick a supplier from the search sheet; supplier balance shows under the name. "New supplier" in the search sheet adds one and picks it.
- [ ] "Import from Excel" on a new purchase bill: choose the supplier's .xlsx / .csv; lines appear (known parts with stock, unknown ones with a "NEW" chip); the yellow note lists new parts and rows left out; saving adds the new parts.
- [ ] On every screen opened from a tab (purchase bill, part form, cash book, bill …) the last button sits fully above Android's navigation bar (try 3-button and gesture navigation).
- [ ] Bill date: tapping opens the calendar (no future days); today is filled in; no "invalid date".
- [ ] Suppliers screen: "New supplier"; a supplier's page has "Edit supplier" (contact person, phone, GSTIN, opening balance, address).
- [ ] Add parts from the search sheet and by scanning a QR label; MRP fills from the selling price, discount from the last purchase.
- [ ] "Prices on this bill" = MRP: 10 × MRP 185, 22% → line total ₹1,443.00; the rate follows the MRP until you change it. Switch to "Without GST": the rate becomes the last purchase price and GST is added on top.
- [ ] The supplier's contact person and phone show under the supplier name and on the saved bill.
- [ ] Changing qty, price, discount or GST updates the line total and bill totals (from the server).
- [ ] An other-state supplier (e.g. Deccan Lubricants) shows the IGST note and an IGST line.
- [ ] Saving with a bill number already used for that supplier shows the error under "Bill no.".
- [ ] After saving, the bill opens; stock of each part went up (check the part ledger: "Purchase").
- [ ] Credit bill shows "Due"; "Record payment" pre-fills the due amount; a part payment reduces it.
- [ ] "Correct bill" opens the form filled from the bill (supplier fixed); saving shows "This bill corrects bill …" and the old bill shows Cancelled with a link to the new one.
- [ ] "Cancel bill" needs a reason; stock goes back down; the bill disappears from the Purchases list.
- [ ] Supplier screen: balance, ledger (newest first), call button, record payment, new bill for this supplier.
- [ ] Reorder list: groups by supplier; editing an order quantity changes the shared message.
- [ ] "Share on WhatsApp" opens WhatsApp to the supplier's number with the order text; without a phone number the system share sheet opens.

## Phase 3 – jobs, estimates, parts requests

Tabs: owner Home · Approvals · Jobs · More; inventory Queue · Approvals · Stock · Purchases · Me;
front desk Jobs · New job · Customers · Stock · Me; mechanic My jobs · Requests · Stock · Me.

- [ ] Front desk: New job → type a phone or bike number → pick the bike (or create customer + bike) → complaint chips, mechanic, promised time → job opens.
- [ ] (Gemini key set) **Scan paper job card**: photo of a real handwritten card (Marathi and English) → form fills in within ~15 s;
      unclear fields listed in yellow; tapping the thumbnail shows the card; an existing customer / bike is picked automatically;
      after saving, the job shows the card photo. A blurred photo gives a clear "could not read" message, never a wrong save.
- [ ] Prepare estimate (labour from the rate list, parts from search) → "Send on WhatsApp" opens WhatsApp to the customer with the link.
- [ ] Customer opens the link on their phone (no login): bilingual page, Approve → job shows Approved. "Call me" notifies desk and owner.
- [ ] "Approved on call" with a note also approves.
- [ ] Mechanic: "Start work" is refused before approval; after approval it works.
- [ ] Mechanic: Request parts → search / scan QR / free-text part, stepper, "Needs approval" chip on lines ≥ ₹1,000 → Send.
- [ ] Inventory: Queue tab shows the request (oldest first) with location, rack and stock; badge count on the tab.
- [ ] A ₹1,450 tyre waits in Approvals; the ₹150 spark plug can be issued at once.
- [ ] Issue with partial quantity keeps the line open; "Not available" asks for a remark; free-text lines need "Link to part".
- [ ] Issuing more than stock shows "Not enough stock".
- [ ] Mechanic gets a notification (bell count within 20 s; push if EAS project id is set) when parts are issued or not available.
- [ ] Job screen: labour from rate list, inspection notes save, camera photo (max 4, long-press to delete), parts used, return to stock (inventory / owner).
- [ ] "Mark ready" notifies desk and owner; desk can send "bike ready" on WhatsApp.
- [ ] Tapping a notification opens the right screen.
- [ ] Customers tab: search by name / phone / bike, customer screen with bikes and job history, call and WhatsApp buttons.

Push notifications need an EAS project: run `npx eas-cli init` in `mobile/` (adds `extra.eas.projectId`),
upload FCM credentials with `npx eas-cli credentials`, then build. Without it, the in-app bell still works.

## Phase 4 – billing and payments

Tabs: front desk Jobs · New job · Billing · Customers · Me; owner Home · Approvals · Jobs · Money · More.

- [ ] Job screen → "Create bill" opens a draft with issued parts + labour (labour approved on the estimate is already there).
- [ ] Front desk sees "Only the owner can give a discount"; owner can set line and bill discounts on the draft (Apply).
- [ ] Payment boxes (cash / UPI / card / bank) show the remaining credit; "Paid in full" fills cash.
- [ ] Finalise with no payment for a non-trusted or walk-in customer → refused with a clear message; for a trusted customer within limit → saved as unpaid.
- [ ] Job screen shows "Next service due: <date> or <km> km, whichever comes first"; the pencil opens a sheet (DD-MM-YYYY + km); a wrong date is refused; saving updates the line. Mechanics do not see the pencil.
- [ ] The printed receipt of a job bill ends with the next service date and km.
- [ ] Owner: counter sale and draft bill lines have a pencil "Change MRP"; the new MRP shows at once and the total changes; the part's MRP is the new one afterwards. Front desk sees the pencil only after the owner ticks "Change a part's MRP".
- [ ] Bill lines read "2 × rate"; a discounted part line adds "MRP … −10%"; the printed receipt shows the same.
- [ ] Owner: "Edit bill" on a final bill opens the edit screen; changing qty / price shows the new total and "Collect now" / "Give back" at once; the amount to collect is filled in; saving keeps the bill number and shows "Edited … by …" (and "Given back …").
- [ ] Front desk does not see "Edit bill".
- [ ] Final bill: "Print receipt" opens the Android print screen; the thermal printer prints a 58 / 80 mm receipt in the customer's language (`docs/PRINTER_SETUP.md`).
- [ ] "Share PDF" opens the share sheet with the A4 PDF; sharing to WhatsApp attaches it (Marathi + English bill).
- [ ] "Send on WhatsApp" opens a chat with the bill message; "Record payment" reduces the balance; "Deliver bike" closes the job.
- [ ] Owner: Money tab shows today's sales and customer dues; "Cancel bill" asks for a reason; a counter-sale cancel puts stock back.
- [ ] Owner → More: New job, Customers, Parts requests, Purchase bills and My profile each open their own page with a back arrow (not the dashboard). Dashboard purchase / low-stock cards open purchase bills / parts.
- [ ] Parts import: "The sheet's quantity becomes the stock" is on; the owner also sees "Replace the whole parts list" (asks to confirm). A sheet with a wrong row shows "Nothing was changed".
- [ ] Supplier page: "Delete supplier" – a new, unused supplier disappears; one with bills is hidden (message says so).
- [ ] Purchase bill: "Correct bill" and "Cancel bill" are right under the bill header.
- [ ] Cash book (Bills tab button, or More → Cash book): add a tea expense in cash – "Should be in the drawer" goes down; a UPI expense does not change it.
- [ ] Owner Home starts with eight tiles (Purchase bill, Sales bill, Stock, Job card, Supplier payables with the amount, Expenses, Reports, Suppliers); each opens its screen and Back returns to Home (no bounce to the dashboard).
- [ ] Owner: "Change the list of expense types" in the cash book – add "Cleaning", rename it, hide it; the add-expense sheet shows only the visible types. Front desk does not see the button.
- [ ] Add an expense with "Take photo": the camera opens; after saving, the expense shows a picture icon that opens the photo full screen. An expense without a photo has a camera icon (camera or gallery).
- [ ] Purchase bill: "Photo of the bill" on the new bill form and on the saved bill (take / replace / gallery / remove); the photo opens full screen on tap.
- [ ] Count the cash: the difference shows as you type ("Short by …" / "Extra …"); after saving, expenses can no longer be deleted; only the owner sees "Reopen".
- [ ] "Return items" on a final bill: enter a qty, the return value and "give back" amount appear; saving prints the return note on the 80 mm printer; the line shows "1 returned"; "Cancel bill" is gone.
- [ ] Counter sale: add parts by search or QR, choose a customer or walk-in, pay, finalise → bill opens.
- [ ] Customer screen: ledger (newest first) and "Record payment" (pays oldest bills first).

## Phase 5 – owner tools

- [ ] Owner Home shows today's sales, credit today, customer dues and supplier payables.
- [ ] More → Mechanic summary: today / yesterday; jobs billed with labour and parts; "Pay" records daily pay or an advance.
- [ ] More → Reports: profit (with the formula), GST summary for this / last month, dues, payables, stock.
- [ ] Inventory manager reaches Reports from the Purchases tab and sees only stock and payables.
- [ ] Reminders (owner More, front desk Customers tab): "Send" opens WhatsApp with the reminder; the customer then leaves the list.
- [ ] More → Users: deactivate a user (they are logged out at once); reset a password (they must change it at login).
- [ ] More → Settings: change the approval limit; a new parts request uses the new limit.

## Release APK – 15-minute smoke test

Run on every new APK, installed from the EAS link, against the **HTTPS test site** (not the PC).

- [ ] Install over the previous version keeps the login (no reinstall needed).
- [ ] Server address `https://<test-domain>` is accepted; `http://` to a LAN address is refused in the APK.
- [ ] Log in as each role (owner, inventory, front desk, mechanic) – the right tabs appear.
- [ ] Scan a printed part label; camera and torch work.
- [ ] Mechanic requests a part → inventory phone gets a **push notification** (needs FCM set up) and the bell count.
- [ ] Front desk finalises a counter sale → "Print receipt" prints on the Bluetooth printer; "Share PDF" sends the A4 bill on WhatsApp with Marathi text intact.
- [ ] Airplane mode → offline banner; back online → lists refresh.
- [ ] Settings → App → raise "Minimum app version" above this APK → the update screen appears with the APK link. Set it back.
