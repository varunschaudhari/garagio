<?php
declare(strict_types=1);

/*
 * Purchase bills, entered one of two ways (price_mode, per bill):
 *   mrp - the supplier's price includes GST (usually the MRP) less a trade discount: 10 × 185 − 22% = 1443;
 *   net - the price is without GST and GST is added per line (input tax).
 * Saving a bill adds stock at the net cost (price − discount, without GST once the shop is registered),
 * updates the part's last purchase price (kept without GST) / discount, the weighted-average cost and the
 * selling price (from the line's MRP), and - unless bought on credit - records the payment.
 */

const PURCHASE_ITEM_RULES = [
    'part_id' => 'int',
    'qty' => 'num|req|min:0.01|max:100000',
    'price' => 'num|req|min:0|max:10000000',
    'disc_pct' => 'num|min:0|max:100|def:0',
    'gst_rate' => 'num|min:0|max:40',
    'mrp' => 'num|min:0|max:10000000',
];

/**
 * What one unit costs the shop after the discount: without GST once registered (the GST comes back as input
 * credit), with GST while not registered (it is part of the cost).
 */
function purchase_net_cost(float $price, float $discPct, float $rate, bool $inclusive): float
{
    $net = net_cost($price, $discPct);
    if ($inclusive && gst_registered()) {
        return round($net / (1 + $rate / 100), 4);
    }
    if (!$inclusive && !gst_registered()) {
        return round($net * (1 + $rate / 100), 4);
    }
    return $net;
}

/** parts.last_purchase_price is always without GST (before the discount). */
function purchase_ex_price(float $price, float $rate, bool $inclusive): float
{
    return $inclusive ? round($price / (1 + $rate / 100), 2) : $price;
}

/* A supplier's bill sent as Excel: its lines go into the purchase form (nothing is saved here). */
const PURCHASE_IMPORT_ALIASES = [
    'part_no' => ['part_no', 'part_number', 'partno', 'part_code', 'code', 'item_code', 'sku', 'पार्ट_नं', 'पार्ट_नंबर', 'पार्ट_क्रमांक', 'पार्ट_क्र'],
    'name_en' => ['name_en', 'name', 'part_name', 'item_name', 'item', 'description', 'particulars', 'product', 'product_name', 'spare_part', 'spare_part_name', 'english_name', 'पार्टचे_नाव', 'पार्ट_नाव', 'नाव', 'तपशील'],
    'name_mr' => ['name_mr', 'marathi_name', 'name_marathi', 'name_in_marathi', 'marathi', 'मराठी_नाव', 'मराठी'],
    'qty' => ['qty', 'quantity', 'pcs', 'nos', 'purchase_qty', 'billed_qty', 'नग', 'संख्या'],
    'price' => ['price', 'rate', 'purchase_rate', 'purchase_price', 'unit_price', 'cost', 'cost_price', 'dealer_price', 'दर', 'खरेदी_दर', 'खरेदी_किंमत'],
    'disc_pct' => ['disc', 'discount', 'disc_pct', 'discount_pct', 'discount_percent', 'सूट'],
    'gst_rate' => ['gst', 'gst_rate', 'gst_pct', 'gst_percent', 'tax', 'tax_rate', 'igst', 'igst_pct', 'जीएसटी'],
    'gst_half' => ['cgst', 'cgst_pct', 'cgst_rate', 'sgst', 'sgst_pct', 'sgst_rate'],
    'mrp' => ['mrp', 'sale_price', 'selling_price', 'sales_price', 'एमआरपी', 'विक्री_किंमत'],
    'hsn' => ['hsn', 'hsn_code', 'hsn_sac'],
    'unit' => ['unit', 'uom', 'units'],
];
const PURCHASE_IMPORT_NUMBERS = ['qty', 'price', 'disc_pct', 'gst_rate', 'gst_half', 'mrp'];

/** The part a supplier's line is about: by part number, else by name (English or Marathi). */
function purchase_import_part(array $r): ?array
{
    if (!empty($r['part_no'])) {
        $p = row(PART_SELECT . ' WHERE p.part_no = ?', [strtoupper((string) preg_replace('/\s+/', '', (string) $r['part_no']))]);
        if ($p) {
            return $p;
        }
    }
    foreach (['name_en', 'name_mr'] as $f) {
        if (!empty($r[$f])) {
            $name = mb_strtolower(trim((string) $r[$f]));
            $p = row(PART_SELECT . ' WHERE LOWER(p.name_en) = ? OR LOWER(p.name_mr) = ? ORDER BY p.active DESC LIMIT 1', [$name, $name]);
            if ($p) {
                return $p;
            }
        }
    }
    return null;
}

route('POST', '/purchases/import-lines', function () {
    $rowsIn = body()['rows'] ?? null;
    if (!is_array($rowsIn) || !$rowsIn) {
        fail(422, 'validation_failed', 'No rows to import', ['rows' => 'required']);
    }
    if (count($rowsIn) > 300) {
        fail(422, 'validation_failed', 'Too many lines on one bill', ['rows' => 'too_long']);
    }
    $lines = [];
    $errors = [];
    $unused = [];
    foreach (array_values($rowsIn) as $i => $raw) {
        $r = is_array($raw) ? import_map_row($raw, PURCHASE_IMPORT_ALIASES, PURCHASE_IMPORT_NUMBERS, $unused) : [];
        if (empty($r['part_no']) && empty($r['name_en']) && empty($r['name_mr'])) {
            continue; // totals, notes, empty rows
        }
        $label = (string) ($r['name_en'] ?? $r['name_mr'] ?? $r['part_no']);
        if ((float) ($r['qty'] ?? 0) <= 0) {
            $errors[] = ['row' => $i + 2, 'name' => $label, 'code' => 'qty_missing'];
            continue;
        }
        $part = purchase_import_part($r);
        $gst = isset($r['gst_rate']) ? (float) $r['gst_rate'] : (isset($r['gst_half']) ? 2 * (float) $r['gst_half'] : null);
        $gst ??= $part ? (float) $part['gst_rate'] : (float) setting_num('default_part_gst_rate');
        $lines[] = [
            'part' => $part,
            'new_part' => $part ? null : [
                'part_no' => strtoupper((string) preg_replace('/\s+/', '', (string) ($r['part_no'] ?? ''))),
                'name_en' => (string) ($r['name_en'] ?? $r['name_mr']),
                'name_mr' => $r['name_mr'] ?? null,
                'hsn' => $r['hsn'] ?? null,
                'unit' => $r['unit'] ?? 'pcs',
                'gst_rate' => $gst,
            ],
            'qty' => (float) $r['qty'],
            'price' => isset($r['price']) ? (float) $r['price'] : null,
            'disc_pct' => (float) ($r['disc_pct'] ?? 0),
            'gst_rate' => $gst,
            'mrp' => isset($r['mrp']) ? (float) $r['mrp'] : null,
        ];
    }
    return ['lines' => $lines, 'errors' => $errors, 'unused_columns' => array_keys($unused)];
}, ['perm' => 'purchases']);

/** Validate the header + items and compute every line and total (no writes). */
function purchase_calc(array $body, bool $forSave): array
{
    $hdr = clean($body, [
        'supplier_id' => 'int|req',
        'bill_no' => $forSave ? 'str|req|max:40' : 'str|max:40',
        'bill_date' => $forSave ? 'date|req' : 'date',
        'payment_mode' => $forSave ? 'enum:cash,upi,bank,credit|req' : 'enum:cash,upi,bank,credit',
        'other_charges' => 'num|min:-1000000|max:1000000|def:0',
        'price_mode' => 'enum:mrp,net|def:net',
        'notes' => 'str|max:255',
    ]);
    $inclusive = $hdr['price_mode'] === 'mrp';
    $supplier = row('SELECT * FROM suppliers WHERE id = ?', [$hdr['supplier_id']]);
    if (!$supplier) {
        fail(422, 'validation_failed', 'Choose a supplier', ['supplier_id' => 'invalid_choice']);
    }
    $itemsIn = $body['items'] ?? null;
    if (!is_array($itemsIn) || !$itemsIn) {
        fail(422, 'validation_failed', 'Add at least one item', ['items' => 'required']);
    }
    if (count($itemsIn) > 300) {
        fail(422, 'validation_failed', 'Too many lines on one bill', ['items' => 'too_long']);
    }

    $lines = [];
    $errors = [];
    foreach (array_values($itemsIn) as $i => $raw) {
        $raw = is_array($raw) ? $raw : [];
        try {
            $it = clean($raw, PURCHASE_ITEM_RULES);
            $newPart = isset($raw['new_part']) && is_array($raw['new_part']) ? $raw['new_part'] : null;
            if (empty($it['part_id']) && !$newPart) {
                throw new ApiError(422, 'validation_failed', 'Choose a part', ['part_id' => 'required']);
            }
            $part = null;
            if (!empty($it['part_id'])) {
                $part = row('SELECT id, part_no, name_en, name_mr, unit, gst_rate, hsn FROM parts WHERE id = ?', [$it['part_id']]);
                if (!$part) {
                    throw new ApiError(422, 'validation_failed', 'Unknown part', ['part_id' => 'invalid_choice']);
                }
            }
            $rate = $it['gst_rate'] ?? ($part ? (float) $part['gst_rate'] : (float) ($newPart['gst_rate'] ?? setting_num('default_part_gst_rate')));
            check_gst_rate((float) $rate);
            $lines[] = [
                'part_id' => $part ? (int) $part['id'] : null,
                'new_part' => $part ? null : $newPart,
                'part_no' => $part['part_no'] ?? strtoupper((string) ($newPart['part_no'] ?? '')),
                'name_en' => $part['name_en'] ?? (string) ($newPart['name_en'] ?? ''),
                'name_mr' => $part['name_mr'] ?? ($newPart['name_mr'] ?? null),
                'qty' => (float) $it['qty'],
                'unit_price' => (float) $it['price'],
                'disc_pct' => (float) $it['disc_pct'],
                'gst_rate' => (float) $rate,
                'mrp' => isset($it['mrp']) && (float) $it['mrp'] > 0 ? (float) $it['mrp'] : null,
            ];
        } catch (ApiError $e) {
            $errors["items.$i"] = $e->fields ?: ['_' => $e->getMessage()];
        }
    }
    if ($errors) {
        fail(422, 'validation_failed', 'Some lines need attention', $errors);
    }

    $interstate = supplier_interstate($supplier['gstin'], $supplier['state_code']);
    $bill = gst_bill($lines, $inclusive, $interstate, 0, (float) $hdr['other_charges']);
    foreach ($bill['lines'] as &$l) {
        $l['net_cost'] = purchase_net_cost($l['unit_price'], $l['disc_pct'], $l['gst_rate'], $inclusive);
    }
    unset($l);
    return ['header' => $hdr, 'supplier' => $supplier, 'interstate' => $interstate, 'inclusive' => $inclusive] + $bill;
}

/** Strip internal keys for the preview response. */
function purchase_preview_view(array $calc): array
{
    return [
        'interstate' => $calc['interstate'],
        'price_mode' => $calc['header']['price_mode'],
        'lines' => array_map(static fn ($l) => pick($l, ['part_id', 'part_no', 'name_en', 'name_mr', 'qty', 'unit_price', 'disc_pct', 'mrp', 'gst_rate', 'net_cost', 'gross', 'disc_amount', 'taxable', 'cgst', 'sgst', 'igst', 'tax_amount', 'line_total']), $calc['lines']),
        'totals' => $calc['totals'],
        'by_rate' => $calc['by_rate'],
    ];
}

function purchase_by_id(int $id): array
{
    $p = row(
        'SELECT p.*, s.name AS supplier_name, s.contact_person AS supplier_contact, s.phone AS supplier_phone, s.gstin AS supplier_gstin, s.state_code AS supplier_state, u.name AS user_name
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?',
        [$id]
    ) ?? not_found('Purchase bill');
    $p['items'] = rows(
        'SELECT i.*, pt.part_no, pt.name_en, pt.name_mr, pt.unit, pt.hsn FROM purchase_items i JOIN parts pt ON pt.id = i.part_id WHERE i.purchase_id = ? ORDER BY i.id',
        [$id]
    );
    $p['payments'] = rows('SELECT sp.*, u.name AS user_name FROM supplier_payments sp LEFT JOIN users u ON u.id = sp.user_id WHERE sp.purchase_id = ? ORDER BY sp.paid_on, sp.id', [$id]);
    $p['paid'] = r2(array_sum(array_column($p['payments'], 'amount')));
    $p['cancelled_by_name'] = $p['cancelled_by'] ? val('SELECT name FROM users WHERE id = ?', [$p['cancelled_by']]) : null;
    $p['replaced_by_bill'] = $p['replaced_by'] ? row('SELECT id, bill_no FROM purchases WHERE id = ?', [$p['replaced_by']]) : null;
    $p['replaces_bill'] = row('SELECT id, bill_no FROM purchases WHERE replaced_by = ?', [$p['id']]);
    return $p;
}

route('POST', '/purchases/preview', function () {
    return purchase_preview_view(purchase_calc(body(), false));
}, ['perm' => 'purchases']);

route('GET', '/purchases', function () {
    [$limit, $offset] = paging(50, 500);
    $where = [];
    $params = [];
    if (($term = qp('q')) !== null && $term !== '') {
        $like = like($term);
        $where[] = '(p.bill_no LIKE ? OR s.name LIKE ?)';
        array_push($params, $like, $like);
    }
    if ($sid = qp_int('supplier')) {
        $where[] = 'p.supplier_id = ?';
        $params[] = $sid;
    }
    if ($from = qp_date('from')) {
        $where[] = 'p.bill_date >= ?';
        $params[] = $from;
    }
    if ($to = qp_date('to')) {
        $where[] = 'p.bill_date <= ?';
        $params[] = $to;
    }
    if (($mode = qp('mode')) && in_array($mode, ['cash', 'upi', 'bank', 'credit'], true)) {
        $where[] = 'p.payment_mode = ?';
        $params[] = $mode;
    }
    if (qp('status') === 'cancelled') {
        $where[] = "p.status = 'cancelled'";
    } elseif (qp('status') !== 'all') {
        $where[] = "p.status <> 'cancelled'";
    }
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $base = "FROM purchases p JOIN suppliers s ON s.id = p.supplier_id $w";
    $sum = row("SELECT COUNT(*) AS n, COALESCE(SUM(p.total), 0) AS total $base", $params);
    $items = rows(
        "SELECT p.id, p.bill_no, p.bill_date, p.total, p.taxable_total, p.cgst, p.sgst, p.igst, p.payment_mode, p.status, p.supplier_id, s.name AS supplier_name,
                (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = p.id) AS line_count
         $base ORDER BY p.bill_date DESC, p.id DESC LIMIT $limit OFFSET $offset",
        $params
    );
    return ['items' => $items, 'total' => (int) $sum['n'], 'sum_total' => (float) $sum['total']];
}, ['perm' => 'purchases']);

route('GET', '/purchases/{id}', function ($p) {
    return ['item' => purchase_by_id((int) $p['id'])];
}, ['perm' => 'purchases']);

route('POST', '/purchases/{id}/cancel', function ($p) {
    $in = clean(body(), ['reason' => 'str|req|max:255']);
    tx(function () use ($p, $in) {
        $pu = row('SELECT * FROM purchases WHERE id = ? FOR UPDATE', [(int) $p['id']]) ?? not_found('Purchase bill');
        if ($pu['status'] !== 'final') {
            fail(409, 'purchase_cancelled', 'This bill is already cancelled');
        }
        cancel_purchase($pu, $in['reason']);
    });
    return ['item' => purchase_by_id((int) $p['id'])];
}, ['perm' => 'purchases']);

/**
 * Cancel a purchase bill inside tx(): its parts leave stock at their purchase cost (refused when they are
 * already used), the last purchase price falls back to the previous bill, and money already paid stays with
 * the supplier as an advance (unless a correction moves it to the new bill).
 */
function cancel_purchase(array $p, string $reason, ?int $replacedBy = null): void
{
    foreach (rows('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id', [$p['id']]) as $it) {
        stock_move((int) $it['part_id'], -(float) $it['qty'], 'purchase_cancel', 'purchase', (int) $p['id'], (float) $it['net_cost'], 'Cancelled bill ' . $p['bill_no']);
        $prev = row(
            "SELECT pi.price, pi.disc_pct, pi.gst_rate, pu.price_mode FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.part_id = ? AND pu.status = 'final' AND pu.id <> ? ORDER BY pu.bill_date DESC, pu.id DESC LIMIT 1",
            [$it['part_id'], $p['id']]
        );
        if ($prev) {
            $price = purchase_ex_price((float) $prev['price'], (float) $prev['gst_rate'], $prev['price_mode'] === 'mrp');
            q('UPDATE parts SET last_purchase_price = ?, last_purchase_disc_pct = ?, updated_at = ? WHERE id = ?', [$price, $prev['disc_pct'], now(), $it['part_id']]);
        }
    }
    update_row('purchases', (int) $p['id'], ['status' => 'cancelled', 'cancel_reason' => $reason, 'cancelled_by' => uid(), 'cancelled_at' => now(), 'replaced_by' => $replacedBy]);
    audit('purchase_cancel', 'purchase', (int) $p['id'], ['bill_no' => $p['bill_no'], 'total' => (float) $p['total']], ['reason' => $reason, 'replaced_by' => $replacedBy]);
}

route('POST', '/purchases', function () {
    $body = body();
    $calc = purchase_calc($body, true);
    $h = $calc['header'];
    $t = $calc['totals'];
    // A correction: the new bill replaces an earlier one (same supplier), in one step.
    $old = null;
    if (!empty($body['replaces_id'])) {
        $old = row('SELECT * FROM purchases WHERE id = ?', [(int) $body['replaces_id']]) ?? not_found('Purchase bill');
        if ($old['status'] !== 'final') {
            fail(409, 'purchase_cancelled', 'This bill is already cancelled');
        }
        if ((int) $old['supplier_id'] !== (int) $h['supplier_id']) {
            fail(422, 'validation_failed', 'A correction must be for the same supplier', ['supplier_id' => 'invalid_choice']);
        }
    }
    if ((int) val("SELECT COUNT(*) FROM purchases WHERE supplier_id = ? AND bill_no = ? AND status <> 'cancelled' AND id <> ?", [$h['supplier_id'], $h['bill_no'], $old['id'] ?? 0])) {
        fail(409, 'duplicate_bill', 'This bill number is already entered for this supplier', ['bill_no' => 'duplicate']);
    }

    $id = tx(function () use ($calc, $h, $t, $old) {
        $pid = insert('purchases', [
            'supplier_id' => $h['supplier_id'],
            'bill_no' => $h['bill_no'],
            'bill_date' => $h['bill_date'],
            'is_interstate' => $calc['interstate'] ? 1 : 0,
            'price_mode' => $h['price_mode'],
            'taxable_total' => $t['taxable_total'],
            'cgst' => $t['cgst'],
            'sgst' => $t['sgst'],
            'igst' => $t['igst'],
            'other_charges' => $t['other_charges'],
            'round_off' => $t['round_off'],
            'total' => $t['grand_total'],
            'payment_mode' => $h['payment_mode'],
            'notes' => $h['notes'] ?? null,
            'user_id' => uid(),
        ]);
        foreach ($calc['lines'] as $i => $l) {
            $partId = $l['part_id'];
            if (!$partId) {
                // New part created inline from the purchase screen; the line's MRP is its selling price.
                if ($l['mrp'] !== null && !isset($l['new_part']['selling_price'])) {
                    $l['new_part']['selling_price'] = $l['mrp'];
                }
                // From a supplier's Excel without part numbers: the next automatic number.
                if (trim((string) ($l['new_part']['part_no'] ?? '')) === '') {
                    $l['new_part']['part_no'] = next_auto_part_no();
                }
                try {
                    $np = clean($l['new_part'], PART_RULES);
                } catch (ApiError $e) {
                    throw new ApiError(422, 'validation_failed', 'New part details are incomplete', ["items.$i.new_part" => $e->fields]);
                }
                $np['gst_rate'] = $np['gst_rate'] ?? $l['gst_rate'];
                $np = prepare_part_input($np);
                $np['active'] = $np['active'] ?? 1;
                $np['current_stock'] = 0;
                $partId = insert('parts', $np);
            }
            insert('purchase_items', [
                'purchase_id' => $pid,
                'part_id' => $partId,
                'qty' => $l['qty'],
                'price' => $l['unit_price'],
                'disc_pct' => $l['disc_pct'],
                'mrp' => $l['mrp'],
                'net_cost' => $l['net_cost'],
                'gst_rate' => $l['gst_rate'],
                'taxable' => $l['taxable'],
                'cgst' => $l['cgst'],
                'sgst' => $l['sgst'],
                'igst' => $l['igst'],
                'tax_amount' => $l['tax_amount'],
                'line_total' => $l['line_total'],
            ]);
            stock_move($partId, $l['qty'], 'purchase', 'purchase', $pid, $l['net_cost'], 'Bill ' . $h['bill_no']);
            q('UPDATE parts SET last_purchase_price = ?, last_purchase_disc_pct = ?, updated_at = ? WHERE id = ?', [purchase_ex_price($l['unit_price'], $l['gst_rate'], $calc['inclusive']), $l['disc_pct'], now(), $partId]);
            // The MRP printed on the supplier's bill is what we sell at (for people who may edit part prices).
            if ($l['mrp'] !== null && can('edit_parts')) {
                $was = (float) val('SELECT selling_price FROM parts WHERE id = ?', [$partId]);
                if (abs($was - $l['mrp']) >= 0.005) {
                    q('UPDATE parts SET selling_price = ?, updated_at = ? WHERE id = ?', [$l['mrp'], now(), $partId]);
                    audit('price_change', 'part', $partId, ['selling_price' => $was], ['selling_price' => $l['mrp'], 'purchase_bill' => $h['bill_no']]);
                }
            }
        }
        $alreadyPaid = 0.0;
        if ($old) {
            // New stock is in first, so parts already used from the old bill can still be corrected
            // as long as the new bill brings them back in.
            $old = row('SELECT * FROM purchases WHERE id = ? FOR UPDATE', [$old['id']]);
            if ($old['status'] !== 'final') {
                fail(409, 'purchase_cancelled', 'This bill is already cancelled');
            }
            $alreadyPaid = (float) val('SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE purchase_id = ?', [$old['id']]);
            q('UPDATE supplier_payments SET purchase_id = ?, updated_at = ? WHERE purchase_id = ?', [$pid, now(), $old['id']]);
            cancel_purchase($old, 'Corrected – replaced by bill ' . $h['bill_no'], $pid);
        }
        $toPay = r2($t['grand_total'] - $alreadyPaid);
        if ($h['payment_mode'] !== 'credit' && $toPay > 0) {
            insert('supplier_payments', [
                'supplier_id' => $h['supplier_id'],
                'purchase_id' => $pid,
                'amount' => $toPay,
                'mode' => $h['payment_mode'],
                'reference' => 'Bill ' . $h['bill_no'],
                'paid_on' => $h['bill_date'],
                'note' => null,
                'user_id' => uid(),
            ]);
        }
        return $pid;
    });
    return ['item' => purchase_by_id($id)];
}, ['perm' => 'purchases']);
