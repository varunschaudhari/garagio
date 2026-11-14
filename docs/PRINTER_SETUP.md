# Thermal receipt printer (phones only)

Trimurti Auto bills from phones, so bills print on a **Bluetooth thermal receipt printer** through Android's
normal print dialog. Marathi prints correctly because the receipt is sent to the printer as a picture, not
as printer text.

> Not yet tried with a real printer. Test with the shop's printer before the pilot week (section 4).

## 1. Which printer

- A **58 mm (2 inch)** Bluetooth thermal printer is enough for bills; **80 mm (3 inch)** gives bigger text.
  Both work – set the width in the app (section 3).
- It must say **ESC/POS** and **Android** support (almost all do). Battery-powered portable models are fine.
- Paper: plain thermal rolls of the same width (58 mm × 40 mm or 80 mm × 80 mm diameter).

## 2. Set up each phone that prints (once, about 10 minutes)

1. Turn the printer on. Android **Settings → Bluetooth → Pair new device** → choose the printer
   (PIN is usually `0000` or `1234`).
2. Install a **print service** for ESC/POS printers from the Play Store – for example **RawBT** – or the
   printer maker's app if it adds itself to Android printing.
3. Open that app once: choose the paired printer, connection **Bluetooth**, paper **58 mm** (or 80 mm).
   Print its test page.
4. Android **Settings → Connected devices → Connection preferences → Printing** (the path differs a little
   by phone; search Settings for "Printing") → turn the print service **on**.

## 3. In Garage Manager

1. Owner: **Settings → Billing & GST → Thermal printer paper width** (or More → Settings on the phone) →
   58 mm or 80 mm.
2. Open a bill → **Print receipt** → Android shows the print screen → choose the thermal printer at the top
   (not "Save as PDF") → paper size the same width → **Print**.
3. **Share PDF** still sends the full A4 bill on WhatsApp – useful for business customers who need it.
4. In Chrome on a phone (web app): bill → **Print receipt** → the receipt opens → **Print** → same printer.

## 4. First test (before the pilot)

- [ ] A counter-sale receipt prints in **Marathi** and in **English** (customer language decides).
- [ ] Text fills the paper width – not tiny, not cut off at the right. If it is wrong, the paper width in the
      print service and in Settings must be the same.
- [ ] Shop name, address, GSTIN, bill number, date, HSN and GST % on each line, CGST / SGST, total and
      amount in words are all readable.
- [ ] A bill with a balance shows the **UPI QR**, and a phone can scan it from the paper.
- [ ] Printing works again after the printer was switched off and on.

## Troubleshooting

| Problem | Fix |
|---|---|
| Printer not in the print list | The print service is off (step 2.4) or not set to this printer (step 2.3). |
| Blank paper comes out | Paper roll is upside down – the shiny side must face the print head. |
| Text tiny or cut off | Same paper width in the print service and in Settings; choose the roll size in the print screen. |
| Marathi letters broken | Update Android System WebView from the Play Store; the receipt uses the phone's Devanagari font. |
| Printing very slow | Normal for pictures over Bluetooth on cheap printers – a long bill can take 10–20 s. |
