<?php
declare(strict_types=1);

/* Pure functions, called in-process. */

test('gst: inclusive intra-state 1180 @18% → 1000 + 90 + 90', function () {
    $c = gst_line(1, 1180, 0, 18, true, false);
    eq(1000.0, $c['taxable']);
    eq(180.0, $c['tax_amount']);
    eq(90.0, $c['cgst']);
    eq(90.0, $c['sgst']);
    eq(0.0, $c['igst']);
    eq(1180.0, $c['line_total']);
});

test('gst: inclusive 2 × 150 @18% → taxable 254.24, tax 45.76', function () {
    $c = gst_line(2, 150, 0, 18, true, false);
    eq(254.24, $c['taxable']);
    eq(45.76, $c['tax_amount']);
    eq(22.88, $c['cgst']);
    eq(22.88, $c['sgst']);
});

test('gst: exclusive 1000 @18% → tax 180, total 1180', function () {
    $c = gst_line(1, 1000, 0, 18, false, false);
    eq(1000.0, $c['taxable']);
    eq(180.0, $c['tax_amount']);
    eq(1180.0, $c['line_total']);
});

test('gst: inter-state puts all tax in IGST', function () {
    $c = gst_line(1, 1180, 0, 18, true, true);
    eq(180.0, $c['igst']);
    eq(0.0, $c['cgst']);
    eq(0.0, $c['sgst']);
});

test('gst: odd paisa split never loses a paisa', function () {
    $c = gst_line(1, 0.33, 0, 18, false, false); // tax 0.06 → 0.03 + 0.03
    eq($c['tax_amount'], r2($c['cgst'] + $c['sgst']));
    $c = gst_line(1, 0.28, 0, 18, false, false); // tax 0.05 → 0.03 + 0.02
    eq(0.05, $c['tax_amount']);
    eq(0.05, r2($c['cgst'] + $c['sgst']));
});

test('gst: line discount reduces taxable value', function () {
    $c = gst_line(1, 1180, 10, 18, true, false); // 1062 incl
    eq(118.0, $c['disc_amount']);
    eq(900.0, $c['taxable']);
    eq(162.0, $c['tax_amount']);
});

test('gst: bill discount is spread by value across rates, round-off to rupee', function () {
    $bill = gst_bill([
        ['qty' => 1, 'unit_price' => 1180, 'disc_pct' => 0, 'gst_rate' => 18],
        ['qty' => 1, 'unit_price' => 105, 'disc_pct' => 0, 'gst_rate' => 5],
    ], true, false, 10);
    eq(128.5, $bill['totals']['bill_discount']);
    eq(900.0, $bill['lines'][0]['taxable']);
    eq(90.0, $bill['lines'][1]['taxable']);
    eq(4.5, $bill['lines'][1]['tax_amount']);
    eq(990.0, $bill['totals']['taxable_total']);
    eq(166.5, $bill['totals']['tax_total']);
    eq(1157.0, $bill['totals']['grand_total']);
    eq(0.5, $bill['totals']['round_off']);
    eq(2, count($bill['by_rate']));
});

test('gst: spread_amount adds up exactly', function () {
    $s = spread_amount(10.0, [1, 1, 1]);
    eq(10.0, r2(array_sum($s)));
});

test('words: English and Marathi amount in words', function () {
    eq('Rupees One Thousand One Hundred Fifty Seven Only', amount_words_en(1157));
    eq('एक हजार एकशे सत्तावन्न रुपये फक्त', amount_words_mr(1157));
    eq('शंभर रुपये फक्त', amount_words_mr(100));
    eq('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only', amount_words_en(123456));
    eq('एक लाख तेवीस हजार चारशे छप्पन्न रुपये फक्त', amount_words_mr(123456));
    eq('Rupees Ten and Fifty Paise Only', amount_words_en(10.5));
});

test('format: Indian grouping', function () {
    eq('₹1,23,456.00', inr(123456));
    eq('₹12,34,567.50', inr(1234567.5));
    eq('₹999.00', inr(999));
    eq('-₹1,000.00', inr(-1000));
});

test('numbering: financial year label', function () {
    eq('26-27', fy_label('2026-11-13'));
    eq('26-27', fy_label('2027-03-31'));
    eq('27-28', fy_label('2027-04-01'));
});

test('normalise: phone and bike number', function () {
    eq('9822012345', normalize_phone('+91 98220 12345'));
    eq('9822012345', normalize_phone('09822012345'));
    eq(null, normalize_phone('12345'));
    eq('MH12AB1234', normalize_reg_no('mh 12 ab-1234'));
});
