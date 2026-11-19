<?php
declare(strict_types=1);

/*
 * Sale returns (credit notes, decision 20): parts or labour taken back from a final bill. Parts go back into
 * stock at the cost they left at (untick "back to stock" for a faulty part), the bill needs less, and money
 * the customer already paid beyond that stays as advance or is refunded. Numbered RET/… (CN/… on a GST bill).
 */

/** Lines of a bill with what earlier returns already took back. */
function returnable_items(int $invoiceId): array
{
    $items = rows('SELECT ii.*, p.part_no FROM invoice_items ii LEFT JOIN parts p ON p.id = ii.part_id WHERE ii.invoice_id = ? ORDER BY ii.item_type DESC, ii.id', [$invoiceId]);
    $done = [];
    foreach (rows(
        'SELECT ri.invoice_item_id, SUM(ri.qty) AS qty, SUM(ri.taxable) AS taxable, SUM(ri.cgst) AS cgst, SUM(ri.sgst) AS sgst, SUM(ri.igst) AS igst,
                SUM(ri.tax_amount) AS tax_amount, SUM(ri.line_total) AS line_total
         FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id WHERE r.invoice_id = ? GROUP BY ri.invoice_item_id',
        [$invoiceId]
    ) as $d) {
        $done[(int) $d['invoice_item_id']] = $d;
    }
    foreach ($items as &$it) {
        $it['returned'] = $done[(int) $it['id']] ?? [];
        $it['returned_qty'] = r2((float) ($it['returned']['qty'] ?? 0));
    }
    unset($it);
    return $items;
}

/**
 * Work out a return: each chosen line reversed in proportion to the bill line, the total, and how much may
 * (or, for a walk-in customer, must) be refunded now.
 */
function return_calc(array $inv, array $body): array
{
    $raw = $body['items'] ?? null;
    if (!is_array($raw) || !$raw) {
        fail(422, 'validation_failed', 'Choose what comes back', ['items' => 'required']);
    }
    $items = [];
    foreach (returnable_items((int) $inv['id']) as $it) {
        $items[(int) $it['id']] = $it;
    }
    $lines = [];
    $errors = [];
    $taken = [];
    foreach (array_values($raw) as $i => $r) {
        $r = is_array($r) ? $r : [];
        $qty = is_numeric($r['qty'] ?? null) ? r2((float) $r['qty']) : 0.0;
        if ($qty == 0.0) {
            continue;
        }
        $it = $items[(int) ($r['invoice_item_id'] ?? 0)] ?? null;
        if (!$it || isset($taken[(int) $it['id']])) {
            $errors["items.$i.invoice_item_id"] = 'invalid_choice';
            continue;
        }
        $left = r2((float) $it['qty'] - $it['returned_qty']);
        if ($qty < 0 || $qty > $left + 0.004) {
            $errors["items.$i.qty"] = 'out_of_range';
            continue;
        }
        $taken[(int) $it['id']] = $qty;
        $restock = $it['part_id'] !== null && !in_array($r['restock'] ?? true, [false, 0, '0', 'false'], true);
        $lines[] = ['invoice_item_id' => (int) $it['id'], 'part_id' => $it['part_id'] !== null ? (int) $it['part_id'] : null, 'qty' => $qty,
            'restock' => $restock, 'unit_cost' => (float) $it['unit_cost'], 'description_en' => $it['description_en'], 'description_mr' => $it['description_mr'],
            'part_no' => $it['part_no']] + return_line($it, $qty, $it['returned']);
    }
    if ($errors) {
        fail(422, 'validation_failed', 'Check the quantities', $errors);
    }
    if (!$lines) {
        fail(422, 'validation_failed', 'Choose what comes back', ['items' => 'required']);
    }
    $everything = true;
    foreach ($items as $id => $it) {
        if (r2($it['returned_qty'] + ($taken[$id] ?? 0)) < (float) $it['qty'] - 0.004) {
            $everything = false;
        }
    }
    $room = r2((float) $inv['grand_total'] - (float) $inv['returned_total']);
    $totals = return_totals($lines, $room, $everything);
    // What the customer gets back now: walk-in → everything paid beyond what the bill still needs;
    // a known customer → only money they are owed after all their bills (the rest stays as advance).
    $paidOver = max(0.0, r2((float) $inv['paid_total'] - ($room - $totals['total'])));
    $maxRefund = $inv['customer_id']
        ? max(0.0, r2(-(customer_balance((int) $inv['customer_id']) - $totals['total'])))
        : $paidOver;
    return ['lines' => $lines, 'totals' => $totals, 'max_refund' => $maxRefund, 'must_refund' => $inv['customer_id'] ? 0.0 : $paidOver];
}

function return_view(int $id): array
{
    $r = row(
        'SELECT r.*, i.invoice_no, i.invoice_date, i.cust_name, i.cust_phone, i.cust_gstin, i.is_interstate, c.name AS customer_name, c.phone AS customer_phone,
                c.language AS customer_language, u.name AS user_name
         FROM sale_returns r JOIN invoices i ON i.id = r.invoice_id LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?',
        [$id]
    ) ?? not_found('Return');
    $r['items'] = rows(
        'SELECT ri.*, ii.description_en, ii.description_mr, ii.hsn, ii.unit_price, ii.gst_rate, ii.item_type, p.part_no,
                ii.qty AS sold_qty, ii.disc_amount AS sold_disc_amount
         FROM sale_return_items ri JOIN invoice_items ii ON ii.id = ri.invoice_item_id LEFT JOIN parts p ON p.id = ri.part_id WHERE ri.return_id = ? ORDER BY ri.id',
        [$id]
    );
    foreach ($r['items'] as &$it) {
        $it['rate'] = line_rate(['qty' => $it['sold_qty'], 'unit_price' => $it['unit_price'], 'disc_amount' => $it['sold_disc_amount']]);
        unset($it['sold_qty'], $it['sold_disc_amount']);
    }
    unset($it);
    return $r;
}

function final_invoice_for_return(int $id, bool $lock = false): array
{
    $inv = row('SELECT * FROM invoices WHERE id = ?' . ($lock ? ' FOR UPDATE' : ''), [$id]) ?? not_found('Invoice');
    if ($inv['status'] !== 'final') {
        fail(409, 'invoice_not_final', 'Only a final bill can take a return');
    }
    return $inv;
}

route('POST', '/invoices/{id}/returns/preview', function ($p) {
    $c = return_calc(final_invoice_for_return((int) $p['id']), body());
    return ['lines' => array_map(static fn ($l) => array_diff_key($l, ['unit_cost' => 1]), $c['lines']), 'totals' => $c['totals'], 'max_refund' => $c['max_refund'], 'must_refund' => $c['must_refund']];
}, ['perm' => 'cancel_bills']);

route('POST', '/invoices/{id}/returns', function ($p) {
    $body = body();
    $in = clean($body, ['reason' => 'str|req|max:255', 'refund' => 'num|min:0|max:10000000|def:0', 'refund_mode' => 'enum:cash,upi,bank']);
    $rid = tx(function () use ($p, $body, $in) {
        $inv = final_invoice_for_return((int) $p['id'], true);
        if ($inv['customer_id']) {
            q('SELECT id FROM customers WHERE id = ? FOR UPDATE', [$inv['customer_id']]);
        }
        $c = return_calc($inv, $body);
        $refund = r2((float) $in['refund']);
        if ($refund > $c['max_refund'] + 0.004) {
            fail(422, 'refund_too_much', 'Refund is more than ' . inr($c['max_refund']), ['refund' => 'out_of_range']);
        }
        if ($refund < $c['must_refund'] - 0.004) {
            fail(422, 'refund_required', 'Walk-in customer: give back ' . inr($c['must_refund']), ['refund' => 'out_of_range']);
        }
        if ($refund > 0 && empty($in['refund_mode'])) {
            fail(422, 'validation_failed', 'How is the money given back?', ['refund_mode' => 'required']);
        }
        $t = $c['totals'];
        $no = next_return_no((int) $inv['gst_registered'] === 1);
        $rid = insert('sale_returns', [
            'return_no' => $no,
            'invoice_id' => $inv['id'],
            'customer_id' => $inv['customer_id'],
            'return_date' => today(),
            'gst_registered' => (int) $inv['gst_registered'],
            'taxable_total' => $t['taxable_total'],
            'cgst' => $t['cgst'],
            'sgst' => $t['sgst'],
            'igst' => $t['igst'],
            'round_off' => $t['round_off'],
            'total' => $t['total'],
            'refund_amount' => $refund,
            'refund_mode' => $refund > 0 ? $in['refund_mode'] : null,
            'reason' => $in['reason'],
            'user_id' => uid(),
        ]);
        foreach ($c['lines'] as $l) {
            insert('sale_return_items', [
                'return_id' => $rid,
                'invoice_item_id' => $l['invoice_item_id'],
                'part_id' => $l['part_id'],
                'qty' => $l['qty'],
                'taxable' => $l['taxable'],
                'cgst' => $l['cgst'],
                'sgst' => $l['sgst'],
                'igst' => $l['igst'],
                'tax_amount' => $l['tax_amount'],
                'line_total' => $l['line_total'],
                'unit_cost' => $l['unit_cost'],
                'restock' => $l['restock'] ? 1 : 0,
            ]);
            if ($l['restock']) {
                stock_move($l['part_id'], $l['qty'], 'sale_return', 'sale_return', $rid, $l['unit_cost'], 'Return ' . $no . ' (' . $inv['invoice_no'] . ')');
            }
        }
        // The bill now needs less; money paid beyond that comes off it (latest payment first) and is free again.
        $returned = r2((float) $inv['returned_total'] + $t['total']);
        update_row('invoices', (int) $inv['id'], ['returned_total' => $returned]);
        $excess = r2((float) val('SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE invoice_id = ?', [$inv['id']]) - ((float) $inv['grand_total'] - $returned));
        foreach (rows('SELECT id, amount FROM payment_allocations WHERE invoice_id = ? ORDER BY id DESC', [$inv['id']]) as $a) {
            if ($excess <= 0.004) {
                break;
            }
            $take = r2(min($excess, (float) $a['amount']));
            if ($take >= (float) $a['amount'] - 0.004) {
                q('DELETE FROM payment_allocations WHERE id = ?', [$a['id']]);
            } else {
                q('UPDATE payment_allocations SET amount = amount - ?, updated_at = ? WHERE id = ?', [$take, now(), $a['id']]);
            }
            $excess = r2($excess - $take);
        }
        refresh_invoice_payments((int) $inv['id']);
        if ($inv['customer_id']) {
            apply_customer_advance((int) $inv['customer_id']);
        }
        audit('sale_return', 'invoice', (int) $inv['id'], ['invoice_no' => $inv['invoice_no'], 'grand_total' => (float) $inv['grand_total']],
            ['return_no' => $no, 'total' => $t['total'], 'refund' => $refund, 'refund_mode' => $refund > 0 ? $in['refund_mode'] : null, 'reason' => $in['reason']]);
        return $rid;
    });
    return ['item' => strip_cost(return_view($rid)), 'invoice' => invoice_view((int) $p['id'])];
}, ['perm' => 'cancel_bills']);

route('GET', '/returns/{id}', function ($p) {
    return ['item' => strip_cost(return_view((int) $p['id']))];
}, ['perm' => 'make_bills']);

/* The return note as a thermal receipt (same paper setting as bills). */
route('GET', '/returns/{id}/receipt', function ($p) {
    $ret = return_view((int) $p['id']);
    $lang = in_array(qp('lang'), ['mr', 'en'], true) ? qp('lang') : ($ret['customer_language'] ?: 'mr');
    $paper = (int) (in_array(qp('width'), ['58', '80'], true) ? qp('width') : setting('receipt_width', '58'));
    $paper = $paper === 80 ? 80 : 58;
    ob_start();
    include API_DIR . '/templates/return.php';
    return html_response((string) ob_get_clean());
}, ['perm' => 'make_bills']);
