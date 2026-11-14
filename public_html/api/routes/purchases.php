<?php
declare(strict_types=1);

/*
 * Purchase bills. Supplier prices are ex-GST; GST is added per line (input tax).
 * Saving a bill adds stock at the net cost (price − discount), updates the part's last purchase
 * price / discount and weighted-average cost, and - unless bought on credit - records the payment.
 */

const PURCHASE_ITEM_RULES = [
    'part_id' => 'int',
    'qty' => 'num|req|min:0.01|max:100000',
    'price' => 'num|req|min:0|max:10000000',
    'disc_pct' => 'num|min:0|max:100|def:0',
    'gst_rate' => 'num|min:0|max:40',
];

/** Validate the header + items and compute every line and total (no writes). */
function purchase_calc(array $body, bool $forSave): array
{
    $hdr = clean($body, [
        'supplier_id' => 'int|req',
        'bill_no' => $forSave ? 'str|req|max:40' : 'str|max:40',
        'bill_date' => $forSave ? 'date|req' : 'date',
        'payment_mode' => $forSave ? 'enum:cash,upi,bank,credit|req' : 'enum:cash,upi,bank,credit',
        'other_charges' => 'num|min:-1000000|max:1000000|def:0',
        'notes' => 'str|max:255',
    ]);
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
            ];
        } catch (ApiError $e) {
            $errors["items.$i"] = $e->fields ?: ['_' => $e->getMessage()];
        }
    }
    if ($errors) {
        fail(422, 'validation_failed', 'Some lines need attention', $errors);
    }

    $interstate = supplier_interstate($supplier['gstin'], $supplier['state_code']);
    $bill = gst_bill($lines, false, $interstate, 0, (float) $hdr['other_charges']);
    foreach ($bill['lines'] as &$l) {
        $l['net_cost'] = net_cost($l['unit_price'], $l['disc_pct']);
    }
    unset($l);
    return ['header' => $hdr, 'supplier' => $supplier, 'interstate' => $interstate] + $bill;
}

/** Strip internal keys for the preview response. */
function purchase_preview_view(array $calc): array
{
    return [
        'interstate' => $calc['interstate'],
        'lines' => array_map(static fn ($l) => pick($l, ['part_id', 'part_no', 'name_en', 'name_mr', 'qty', 'unit_price', 'disc_pct', 'gst_rate', 'net_cost', 'gross', 'disc_amount', 'taxable', 'cgst', 'sgst', 'igst', 'tax_amount', 'line_total']), $calc['lines']),
        'totals' => $calc['totals'],
        'by_rate' => $calc['by_rate'],
    ];
}

function purchase_by_id(int $id): array
{
    $p = row(
        'SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, s.gstin AS supplier_gstin, s.state_code AS supplier_state, u.name AS user_name
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?',
        [$id]
    ) ?? not_found('Purchase bill');
    $p['items'] = rows(
        'SELECT i.*, pt.part_no, pt.name_en, pt.name_mr, pt.unit, pt.hsn FROM purchase_items i JOIN parts pt ON pt.id = i.part_id WHERE i.purchase_id = ? ORDER BY i.id',
        [$id]
    );
    $p['payments'] = rows('SELECT sp.*, u.name AS user_name FROM supplier_payments sp LEFT JOIN users u ON u.id = sp.user_id WHERE sp.purchase_id = ? ORDER BY sp.paid_on, sp.id', [$id]);
    $p['paid'] = r2(array_sum(array_column($p['payments'], 'amount')));
    return $p;
}

route('POST', '/purchases/preview', function () {
    return purchase_preview_view(purchase_calc(body(), false));
}, ['roles' => [ROLE_OWNER, ROLE_INVENTORY]]);

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
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $base = "FROM purchases p JOIN suppliers s ON s.id = p.supplier_id $w";
    $sum = row("SELECT COUNT(*) AS n, COALESCE(SUM(p.total), 0) AS total $base", $params);
    $items = rows(
        "SELECT p.id, p.bill_no, p.bill_date, p.total, p.taxable_total, p.cgst, p.sgst, p.igst, p.payment_mode, p.supplier_id, s.name AS supplier_name,
                (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = p.id) AS line_count
         $base ORDER BY p.bill_date DESC, p.id DESC LIMIT $limit OFFSET $offset",
        $params
    );
    return ['items' => $items, 'total' => (int) $sum['n'], 'sum_total' => (float) $sum['total']];
}, ['roles' => [ROLE_OWNER, ROLE_INVENTORY]]);

route('GET', '/purchases/{id}', function ($p) {
    return ['item' => purchase_by_id((int) $p['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_INVENTORY]]);

route('POST', '/purchases', function () {
    $calc = purchase_calc(body(), true);
    $h = $calc['header'];
    $t = $calc['totals'];
    if ((int) val('SELECT COUNT(*) FROM purchases WHERE supplier_id = ? AND bill_no = ?', [$h['supplier_id'], $h['bill_no']])) {
        fail(409, 'duplicate_bill', 'This bill number is already entered for this supplier', ['bill_no' => 'duplicate']);
    }

    $id = tx(function () use ($calc, $h, $t) {
        $pid = insert('purchases', [
            'supplier_id' => $h['supplier_id'],
            'bill_no' => $h['bill_no'],
            'bill_date' => $h['bill_date'],
            'is_interstate' => $calc['interstate'] ? 1 : 0,
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
                // New part created inline from the purchase screen.
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
            q('UPDATE parts SET last_purchase_price = ?, last_purchase_disc_pct = ?, updated_at = ? WHERE id = ?', [$l['unit_price'], $l['disc_pct'], now(), $partId]);
        }
        if ($h['payment_mode'] !== 'credit' && $t['grand_total'] > 0) {
            insert('supplier_payments', [
                'supplier_id' => $h['supplier_id'],
                'purchase_id' => $pid,
                'amount' => $t['grand_total'],
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
}, ['roles' => [ROLE_OWNER, ROLE_INVENTORY]]);
