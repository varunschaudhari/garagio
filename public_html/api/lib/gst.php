<?php
declare(strict_types=1);

/*
 * GST maths. All money is calculated here, on the server.
 *
 *   gross    = qty × unit_price × (1 − disc%/100)          (minus any share of a bill discount)
 *   inclusive: taxable = gross / (1 + rate/100); tax = gross − taxable
 *   exclusive: taxable = gross;                 tax = taxable × rate/100
 *   intra-state: CGST = round(tax/2), SGST = tax − CGST   (no half-paise)
 *   inter-state: IGST = tax
 *
 * Each line is rounded to 2 decimals; the grand total is rounded to the rupee with a round-off line.
 */

/**
 * Calculate one line.
 * @return array{gross:float,disc_amount:float,taxable:float,tax_amount:float,cgst:float,sgst:float,igst:float,line_total:float}
 */
function gst_line(float $qty, float $unitPrice, float $discPct, float $rate, bool $inclusive, bool $interstate, float $extraDisc = 0.0): array
{
    $base = r2($qty * $unitPrice);
    $disc = r2($base * $discPct / 100) + r2($extraDisc);
    $gross = r2($base - $disc);
    if ($inclusive) {
        $taxable = r2($gross / (1 + $rate / 100));
        $tax = r2($gross - $taxable);
    } else {
        $taxable = $gross;
        $tax = r2($taxable * $rate / 100);
    }
    if ($interstate) {
        $cgst = 0.0;
        $sgst = 0.0;
        $igst = $tax;
    } else {
        $cgst = r2($tax / 2);
        $sgst = r2($tax - $cgst);
        $igst = 0.0;
    }
    return [
        'gross' => $base,
        'disc_amount' => r2($disc),
        'taxable' => $taxable,
        'tax_amount' => $tax,
        'cgst' => $cgst,
        'sgst' => $sgst,
        'igst' => $igst,
        'line_total' => r2($taxable + $tax),
    ];
}

/**
 * Calculate a whole bill.
 *
 * $lines: [['qty', 'unit_price', 'disc_pct', 'gst_rate', ...anything else kept], ...]
 * $billDiscPct: whole-bill discount %, spread over lines in proportion to their value after line discounts.
 *
 * Returns ['lines' => [...line + calc fields], 'totals' => [...], 'by_rate' => [...]]
 */
function gst_bill(array $lines, bool $inclusive, bool $interstate, float $billDiscPct = 0.0, float $otherCharges = 0.0): array
{
    // Value after line discount, used to spread the bill discount
    $afterLine = [];
    foreach ($lines as $i => $l) {
        $base = r2((float) $l['qty'] * (float) $l['unit_price']);
        $afterLine[$i] = r2($base - r2($base * (float) ($l['disc_pct'] ?? 0) / 100));
    }
    $billDiscTotal = r2(array_sum($afterLine) * $billDiscPct / 100);
    $shares = spread_amount($billDiscTotal, $afterLine);

    $out = [];
    $t = ['gross' => 0.0, 'discount_total' => 0.0, 'taxable_total' => 0.0, 'cgst' => 0.0, 'sgst' => 0.0, 'igst' => 0.0, 'tax_total' => 0.0];
    $byRate = [];
    foreach ($lines as $i => $l) {
        $rate = (float) $l['gst_rate'];
        $c = gst_line((float) $l['qty'], (float) $l['unit_price'], (float) ($l['disc_pct'] ?? 0), $rate, $inclusive, $interstate, $shares[$i] ?? 0.0);
        $out[] = array_merge($l, $c);
        $t['gross'] += $c['gross'];
        $t['discount_total'] += $c['disc_amount'];
        $t['taxable_total'] += $c['taxable'];
        $t['cgst'] += $c['cgst'];
        $t['sgst'] += $c['sgst'];
        $t['igst'] += $c['igst'];
        $t['tax_total'] += $c['tax_amount'];
        $key = number_format($rate, 2, '.', '');
        $byRate[$key] ??= ['gst_rate' => $rate, 'taxable' => 0.0, 'cgst' => 0.0, 'sgst' => 0.0, 'igst' => 0.0, 'tax' => 0.0];
        $byRate[$key]['taxable'] += $c['taxable'];
        $byRate[$key]['cgst'] += $c['cgst'];
        $byRate[$key]['sgst'] += $c['sgst'];
        $byRate[$key]['igst'] += $c['igst'];
        $byRate[$key]['tax'] += $c['tax_amount'];
    }
    foreach ($t as $k => $v) {
        $t[$k] = r2($v);
    }
    foreach ($byRate as $k => $r) {
        foreach (['taxable', 'cgst', 'sgst', 'igst', 'tax'] as $f) {
            $byRate[$k][$f] = r2($r[$f]);
        }
    }
    ksort($byRate, SORT_NUMERIC);
    $t['other_charges'] = r2($otherCharges);
    $exact = r2($t['taxable_total'] + $t['tax_total'] + $t['other_charges']);
    $t['grand_total'] = round($exact, 0);
    $t['round_off'] = r2($t['grand_total'] - $exact);
    $t['grand_total'] = r2($t['grand_total']);
    $t['bill_discount'] = $billDiscTotal;
    return ['lines' => $out, 'totals' => $t, 'by_rate' => array_values($byRate)];
}

/**
 * Split $amount over $weights proportionally, in paise, so the parts add up exactly.
 * @return float[] keyed like $weights
 */
function spread_amount(float $amount, array $weights): array
{
    $sum = array_sum($weights);
    $out = array_fill_keys(array_keys($weights), 0.0);
    if ($amount == 0.0 || $sum <= 0) {
        return $out;
    }
    $paise = (int) round($amount * 100);
    $given = 0;
    $keys = array_keys($weights);
    foreach ($keys as $idx => $k) {
        if ($idx === count($keys) - 1) {
            $p = $paise - $given;
        } else {
            $p = (int) floor($paise * $weights[$k] / $sum);
            $given += $p;
        }
        $out[$k] = $p / 100;
    }
    return $out;
}

/** Inter-state when the counterparty has a GST state code different from the shop's. */
function is_interstate(?string $gstin, ?string $stateCode = null): bool
{
    $shop = setting('shop_state_code', '27');
    if ($gstin && preg_match('/^(\d{2})/', $gstin, $m)) {
        return $m[1] !== $shop;
    }
    // Unregistered customers: place of supply is the shop (counter / workshop) → intra-state.
    return false;
}

function supplier_interstate(?string $gstin, ?string $stateCode): bool
{
    $shop = setting('shop_state_code', '27');
    if ($gstin && preg_match('/^(\d{2})/', $gstin, $m)) {
        return $m[1] !== $shop;
    }
    return $stateCode !== null && $stateCode !== '' && $stateCode !== $shop;
}

const GST_STATES = [
    '01' => 'Jammu and Kashmir', '02' => 'Himachal Pradesh', '03' => 'Punjab', '04' => 'Chandigarh',
    '05' => 'Uttarakhand', '06' => 'Haryana', '07' => 'Delhi', '08' => 'Rajasthan', '09' => 'Uttar Pradesh',
    '10' => 'Bihar', '11' => 'Sikkim', '12' => 'Arunachal Pradesh', '13' => 'Nagaland', '14' => 'Manipur',
    '15' => 'Mizoram', '16' => 'Tripura', '17' => 'Meghalaya', '18' => 'Assam', '19' => 'West Bengal',
    '20' => 'Jharkhand', '21' => 'Odisha', '22' => 'Chhattisgarh', '23' => 'Madhya Pradesh', '24' => 'Gujarat',
    '26' => 'Dadra and Nagar Haveli and Daman and Diu', '27' => 'Maharashtra', '29' => 'Karnataka', '30' => 'Goa',
    '31' => 'Lakshadweep', '32' => 'Kerala', '33' => 'Tamil Nadu', '34' => 'Puducherry',
    '35' => 'Andaman and Nicobar Islands', '36' => 'Telangana', '37' => 'Andhra Pradesh', '38' => 'Ladakh',
];

/** GST slabs accepted on parts and labour. */
const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];

function check_gst_rate(float $rate, string $field = 'gst_rate'): void
{
    foreach (GST_RATES as $r) {
        if (abs($r - $rate) < 0.001) {
            return;
        }
    }
    fail(422, 'validation_failed', 'GST rate must be one of ' . implode(', ', GST_RATES), [$field => 'invalid_choice']);
}
