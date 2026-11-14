<?php
declare(strict_types=1);

/*
 * Billing. Invoices start as drafts (decision 3): front desk builds the draft, the owner may add
 * discounts, finalising assigns the number, posts counter-sale stock and takes payment.
 * All money is calculated here.
 */

const PAY_IN_MODES = ['cash', 'upi', 'card', 'bank'];

function invoice_row(int $id): array
{
    $inv = row(
        'SELECT i.*, j.job_no, j.status AS job_status, j.odometer, v.reg_no, v.make, v.model, c.name AS customer_name, c.phone AS customer_phone,
                c.is_trusted, c.credit_limit, c.language AS customer_language, u.name AS created_by_name
         FROM invoices i LEFT JOIN job_cards j ON j.id = i.job_card_id LEFT JOIN vehicles v ON v.id = j.vehicle_id
         LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN users u ON u.id = i.created_by WHERE i.id = ?',
        [$id]
    ) ?? not_found('Invoice');
    $inv['items'] = rows('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_type DESC, id', [$id]);
    $inv['payments'] = rows(
        'SELECT p.id, p.mode, p.reference, p.received_on, a.amount, u.name AS user_name FROM payment_allocations a
         JOIN customer_payments p ON p.id = a.payment_id LEFT JOIN users u ON u.id = p.user_id WHERE a.invoice_id = ? ORDER BY p.id',
        [$id]
    );
    return $inv;
}

function invoice_view(int $id): array
{
    $inv = invoice_row($id);
    $inv['by_rate'] = invoice_tax_summary($inv['items']);
    return strip_cost($inv);
}

function invoice_tax_summary(array $items): array
{
    $by = [];
    foreach ($items as $it) {
        $k = number_format((float) $it['gst_rate'], 2, '.', '');
        $by[$k] ??= ['gst_rate' => (float) $it['gst_rate'], 'taxable' => 0.0, 'cgst' => 0.0, 'sgst' => 0.0, 'igst' => 0.0, 'tax' => 0.0];
        foreach (['taxable', 'cgst', 'sgst', 'igst'] as $f) {
            $by[$k][$f] = r2($by[$k][$f] + (float) $it[$f]);
        }
        $by[$k]['tax'] = r2($by[$k]['tax'] + (float) $it['tax_amount']);
    }
    ksort($by, SORT_NUMERIC);
    return array_values($by);
}

/** Customer balance (positive = owes us). */
function customer_balance(int $customerId): float
{
    return r2((float) val('SELECT ' . CUSTOMER_BALANCE_SQL . ' FROM customers c WHERE c.id = ?', [$customerId]));
}

/**
 * Source lines for a draft: from the job (issued parts + labour) or from posted counter-sale items.
 * Discounts are taken from $discounts keyed by "part:<job_part_id>" / "labour:<job_labour_id>" / "line:<n>".
 */
function invoice_source_lines(array $inv, array $counterItems, array $discounts): array
{
    if ($inv['inv_type'] === 'job') {
        $lines = job_bill_lines((int) $inv['job_card_id']);
        foreach ($lines as &$l) {
            $key = $l['item_type'] === 'part' ? 'part:' . $l['job_part_id'] : 'labour:' . $l['job_labour_id'];
            $l['disc_pct'] = (float) ($discounts[$key] ?? 0);
            $l['line_key'] = $key;
        }
        unset($l);
        return $lines;
    }
    $lines = [];
    foreach (array_values($counterItems) as $n => $raw) {
        $it = clean(is_array($raw) ? $raw : [], ['part_id' => 'int|req', 'qty' => 'num|req|min:0.01|max:10000', 'disc_pct' => 'num|min:0|max:100|def:0']);
        $p = row('SELECT id, part_no, name_en, name_mr, hsn, gst_rate, selling_price FROM parts WHERE id = ? AND active = 1', [$it['part_id']]) ?? not_found('Part');
        $lines[] = ['item_type' => 'part', 'job_part_id' => null, 'part_id' => (int) $p['id'], 'qty' => (float) $it['qty'], 'unit_price' => (float) $p['selling_price'],
            'disc_pct' => (float) $it['disc_pct'], 'gst_rate' => (float) $p['gst_rate'], 'hsn' => $p['hsn'], 'description_en' => $p['name_en'], 'description_mr' => $p['name_mr'],
            'part_no' => $p['part_no'], 'unit_cost' => 0.0, 'line_key' => 'line:' . $n];
    }
    return $lines;
}

/** Recompute and store the items and totals of a draft. Runs inside tx(). */
function rebuild_draft(int $invoiceId, array $counterItems = [], ?array $discounts = null, ?float $billDisc = null): void
{
    $inv = row('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [$invoiceId]);
    if ($discounts === null) {
        $discounts = [];
        // Keep the discounts already on the draft
        foreach (rows('SELECT job_part_id, job_labour_id, disc_pct FROM invoice_items WHERE invoice_id = ?', [$invoiceId]) as $old) {
            if ($old['job_part_id']) {
                $discounts['part:' . $old['job_part_id']] = (float) $old['disc_pct'];
            } elseif ($old['job_labour_id']) {
                $discounts['labour:' . $old['job_labour_id']] = (float) $old['disc_pct'];
            }
        }
    }
    if ($inv['inv_type'] === 'counter' && !$counterItems) {
        $counterItems = array_map(static fn ($r) => ['part_id' => (int) $r['part_id'], 'qty' => (float) $r['qty'], 'disc_pct' => (float) $r['disc_pct']],
            rows("SELECT part_id, qty, disc_pct FROM invoice_items WHERE invoice_id = ? AND item_type = 'part' ORDER BY id", [$invoiceId]));
    }
    $billDisc ??= (float) $inv['bill_disc_pct'];
    $lines = invoice_source_lines($inv, $counterItems, $discounts);
    $gstin = $inv['customer_id'] ? val('SELECT gstin FROM customers WHERE id = ?', [$inv['customer_id']]) : $inv['cust_gstin'];
    $inter = gst_registered() && is_interstate($gstin ?: null);
    $bill = $lines ? sale_bill($lines, $inter, $billDisc) : ['lines' => [], 'totals' => ['discount_total' => 0, 'taxable_total' => 0, 'cgst' => 0, 'sgst' => 0, 'igst' => 0, 'round_off' => 0, 'grand_total' => 0]];
    q('DELETE FROM invoice_items WHERE invoice_id = ?', [$invoiceId]);
    foreach ($bill['lines'] as $l) {
        insert('invoice_items', [
            'invoice_id' => $invoiceId,
            'item_type' => $l['item_type'],
            'part_id' => $l['part_id'],
            'job_part_id' => $l['job_part_id'] ?? null,
            'job_labour_id' => $l['job_labour_id'] ?? null,
            'description_en' => mb_substr((string) $l['description_en'], 0, 150),
            'description_mr' => $l['description_mr'] ? mb_substr((string) $l['description_mr'], 0, 150) : null,
            'hsn' => $l['hsn'],
            'qty' => $l['qty'],
            'unit_price' => $l['unit_price'],
            'disc_pct' => $l['disc_pct'],
            'disc_amount' => $l['disc_amount'],
            'gst_rate' => $l['gst_rate'],
            'taxable' => $l['taxable'],
            'cgst' => $l['cgst'],
            'sgst' => $l['sgst'],
            'igst' => $l['igst'],
            'tax_amount' => $l['tax_amount'],
            'line_total' => $l['line_total'],
            'unit_cost' => $l['unit_cost'] ?? 0,
        ]);
    }
    $t = $bill['totals'];
    update_row('invoices', $invoiceId, [
        'is_interstate' => $inter ? 1 : 0,
        'gst_registered' => gst_registered() ? 1 : 0,
        'bill_disc_pct' => $billDisc,
        'discount_total' => $t['discount_total'],
        'taxable_total' => $t['taxable_total'],
        'cgst' => $t['cgst'],
        'sgst' => $t['sgst'],
        'igst' => $t['igst'],
        'round_off' => $t['round_off'],
        'grand_total' => $t['grand_total'],
        'balance' => $t['grand_total'],
    ]);
}

/** Recompute paid / balance / pay_status from allocations. */
function refresh_invoice_payments(int $invoiceId): void
{
    $inv = row('SELECT grand_total, status FROM invoices WHERE id = ?', [$invoiceId]);
    $paid = r2((float) val('SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE invoice_id = ?', [$invoiceId]));
    $bal = r2((float) $inv['grand_total'] - $paid);
    $status = $paid <= 0.004 ? 'unpaid' : ($bal <= 0.004 ? 'paid' : 'partial');
    update_row('invoices', $invoiceId, ['paid_total' => $paid, 'balance' => max(0, $bal), 'pay_status' => $status]);
}

/** Record a payment and allocate it (one invoice, or oldest unpaid first). Inside tx(). Returns allocations. */
function record_customer_payment(?int $customerId, float $amount, string $mode, ?string $reference, ?int $invoiceId, ?string $note = null): array
{
    $pid = insert('customer_payments', [
        'customer_id' => $customerId,
        'invoice_id' => $invoiceId,
        'amount' => r2($amount),
        'mode' => $mode,
        'reference' => $reference,
        'received_on' => today(),
        'note' => $note,
        'user_id' => uid(),
    ]);
    $left = r2($amount);
    $allocs = [];
    $targets = $invoiceId
        ? rows("SELECT id, balance FROM invoices WHERE id = ? AND status = 'final' FOR UPDATE", [$invoiceId])
        : rows("SELECT id, balance FROM invoices WHERE customer_id = ? AND status = 'final' AND balance > 0 ORDER BY invoice_date, id FOR UPDATE", [$customerId]);
    foreach ($targets as $t) {
        if ($left <= 0.004) {
            break;
        }
        $a = r2(min($left, (float) $t['balance']));
        if ($a <= 0) {
            continue;
        }
        insert('payment_allocations', ['payment_id' => $pid, 'invoice_id' => $t['id'], 'amount' => $a]);
        refresh_invoice_payments((int) $t['id']);
        $allocs[] = ['invoice_id' => (int) $t['id'], 'amount' => $a];
        $left = r2($left - $a);
    }
    // Anything left reduces old (opening) dues or stays as an advance - the balance formula covers both.
    return ['payment_id' => $pid, 'allocations' => $allocs, 'unallocated' => $left];
}

/** Line discounts keyed "part:<job_part_id>" / "labour:<job_labour_id>" / "line:<n>", each 0–100 %. */
function clean_discounts($raw): array
{
    $out = [];
    $errors = [];
    foreach (is_array($raw) ? $raw : [] as $k => $v) {
        $k = (string) $k;
        if (!preg_match('/^(part|labour|line):\d+$/', $k)) {
            $errors["discounts.$k"] = 'invalid';
        } elseif ($v === '' || $v === null) {
            $out[$k] = 0.0;
        } elseif (!is_numeric($v)) {
            $errors["discounts.$k"] = 'not_number';
        } elseif ((float) $v < 0 || (float) $v > 100) {
            $errors["discounts.$k"] = 'out_of_range';
        } else {
            $out[$k] = (float) $v;
        }
    }
    if ($errors) {
        fail(422, 'validation_failed', 'Discounts must be between 0 and 100 %', $errors);
    }
    return $out;
}

/**
 * Money a customer has paid that no bill uses goes to their open bills, oldest bill first. The opening
 * balance is the oldest due, so unallocated money covers it before anything else. Inside tx().
 * Called after a bill is finalised or cancelled (a cancel frees the money that paid it).
 */
function apply_customer_advance(int $customerId): void
{
    $opening = max(0.0, (float) val('SELECT opening_balance FROM customers WHERE id = ? FOR UPDATE', [$customerId]));
    $payments = rows(
        'SELECT p.id, p.amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0) AS free
         FROM customer_payments p WHERE p.customer_id = ? ORDER BY p.id',
        [$customerId]
    );
    $sources = [];
    foreach ($payments as $p) {
        $free = r2((float) $p['free']);
        $use = r2(min($free, $opening)); // the oldest money pays the opening balance
        $opening = r2($opening - $use);
        if ($free - $use > 0.004) {
            $sources[] = ['id' => (int) $p['id'], 'left' => r2($free - $use)];
        }
    }
    if (!$sources) {
        return;
    }
    $bills = rows("SELECT id, balance FROM invoices WHERE customer_id = ? AND status = 'final' AND balance > 0 ORDER BY invoice_date, id FOR UPDATE", [$customerId]);
    foreach ($bills as $b) {
        $due = r2((float) $b['balance']);
        foreach ($sources as &$src) {
            if ($due <= 0.004) {
                break;
            }
            $a = r2(min($due, $src['left']));
            if ($a <= 0.004) {
                continue;
            }
            insert('payment_allocations', ['payment_id' => $src['id'], 'invoice_id' => $b['id'], 'amount' => $a]);
            $src['left'] = r2($src['left'] - $a);
            $due = r2($due - $a);
        }
        unset($src);
        refresh_invoice_payments((int) $b['id']);
    }
}

function check_discount_rights(array $in): void
{
    $hasDisc = !empty($in['bill_disc_pct']);
    foreach (clean_discounts($in['discounts'] ?? []) as $d) {
        if ($d > 0) {
            $hasDisc = true;
        }
    }
    foreach ((array) ($in['items'] ?? []) as $it) {
        if (is_array($it) && !empty($it['disc_pct'])) {
            $hasDisc = true;
        }
    }
    if ($hasDisc && !is_role(ROLE_OWNER)) {
        fail(403, 'discount_owner_only', 'Only the owner can give a discount');
    }
}

/* ------------------------------------------------------------------ list / read */

route('GET', '/invoices', function () {
    [$limit, $offset] = paging(50, 500);
    $where = [];
    $params = [];
    if (($term = qp('q')) !== null && $term !== '') {
        $like = like($term);
        $where[] = '(i.invoice_no LIKE ? OR i.cust_name LIKE ? OR i.cust_phone LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR v.reg_no LIKE ?)';
        array_push($params, $like, $like, $like, $like, $like, like(normalize_reg_no($term)));
    }
    if (($s = qp('status')) && in_array($s, ['draft', 'final', 'cancelled'], true)) {
        $where[] = 'i.status = ?';
        $params[] = $s;
    }
    if (($ps = qp('pay_status')) && in_array($ps, ['paid', 'partial', 'unpaid'], true)) {
        $where[] = "i.pay_status = ? AND i.status = 'final'";
        $params[] = $ps;
    }
    if (($ty = qp('type')) && in_array($ty, ['job', 'counter'], true)) {
        $where[] = 'i.inv_type = ?';
        $params[] = $ty;
    }
    if ($cid = qp_int('customer')) {
        $where[] = 'i.customer_id = ?';
        $params[] = $cid;
    }
    if ($from = qp_date('from')) {
        $where[] = 'COALESCE(i.invoice_date, DATE(i.created_at)) >= ?';
        $params[] = $from;
    }
    if ($to = qp_date('to')) {
        $where[] = 'COALESCE(i.invoice_date, DATE(i.created_at)) <= ?';
        $params[] = $to;
    }
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $base = "FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN job_cards j ON j.id = i.job_card_id LEFT JOIN vehicles v ON v.id = j.vehicle_id $w";
    $sum = row("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN i.status = 'final' THEN i.grand_total END), 0) AS total, COALESCE(SUM(CASE WHEN i.status = 'final' THEN i.balance END), 0) AS due $base", $params);
    $items = rows("SELECT i.id, i.invoice_no, i.invoice_date, i.inv_type, i.status, i.pay_status, i.grand_total, i.paid_total, i.balance, i.created_at,
                          COALESCE(c.name, i.cust_name) AS customer_name, COALESCE(c.phone, i.cust_phone) AS customer_phone, j.job_no, v.reg_no
                   $base ORDER BY i.status = 'draft' DESC, COALESCE(i.invoice_date, DATE(i.created_at)) DESC, i.id DESC LIMIT $limit OFFSET $offset", $params);
    return ['items' => $items, 'total' => (int) $sum['n'], 'sum_total' => (float) $sum['total'], 'sum_due' => (float) $sum['due']];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

route('GET', '/invoices/{id}', function ($p) {
    return ['item' => invoice_view((int) $p['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* ------------------------------------------------------------------ preview (no writes) */

route('POST', '/invoices/preview', function () {
    $body = body();
    check_discount_rights($body);
    $in = clean($body, ['job_card_id' => 'int', 'customer_id' => 'int', 'bill_disc_pct' => 'num|min:0|max:100|def:0']);
    $inv = ['inv_type' => !empty($in['job_card_id']) ? 'job' : 'counter', 'job_card_id' => $in['job_card_id'] ?? null];
    $lines = invoice_source_lines($inv, (array) ($body['items'] ?? []), clean_discounts($body['discounts'] ?? []));
    $gstin = !empty($in['customer_id']) ? val('SELECT gstin FROM customers WHERE id = ?', [$in['customer_id']]) : null;
    if (!$lines) {
        return ['lines' => [], 'totals' => null];
    }
    $bill = sale_bill($lines, is_interstate($gstin ?: null), (float) $in['bill_disc_pct']);
    return strip_cost(['lines' => $bill['lines'], 'totals' => $bill['totals'], 'by_rate' => $bill['by_rate']]);
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* ------------------------------------------------------------------ create draft */

route('POST', '/invoices', function () {
    $body = body();
    check_discount_rights($body);
    $in = clean($body, ['job_card_id' => 'int', 'customer_id' => 'int', 'cust_name' => 'str|max:120', 'cust_phone' => 'phone', 'bill_disc_pct' => 'num|min:0|max:100|def:0']);

    if (!empty($in['job_card_id'])) {
        $job = job_row((int) $in['job_card_id']);
        if ($job['invoice_id']) {
            $existing = row('SELECT id, status FROM invoices WHERE id = ?', [$job['invoice_id']]);
            if ($existing && $existing['status'] === 'draft') {
                return ['item' => invoice_view((int) $existing['id'])];
            }
            if ($existing && $existing['status'] === 'final') {
                fail(409, 'already_billed', 'This job already has a final bill');
            }
        }
        if (!in_array($job['status'], ['in_progress', 'waiting_parts', 'ready'], true)) {
            fail(409, 'job_not_billable', 'Bill the job once work has started');
        }
        $money = job_money($job);
        if ($money['revision_pending']) {
            fail(409, 'revision_pending', 'A revised estimate is waiting for the customer\'s approval');
        }
        if (!job_bill_lines((int) $job['id'])) {
            fail(409, 'nothing_to_bill', 'Add labour or issue parts before billing');
        }
        $id = tx(function () use ($job, $in, $body) {
            // Re-check under a row lock: two people may press "Create bill" at the same moment.
            $current = val('SELECT invoice_id FROM job_cards WHERE id = ? FOR UPDATE', [$job['id']]);
            if ($current) {
                if (val('SELECT status FROM invoices WHERE id = ?', [$current]) === 'final') {
                    fail(409, 'already_billed', 'This job already has a final bill');
                }
                return (int) $current;
            }
            $id = insert('invoices', ['inv_type' => 'job', 'job_card_id' => $job['id'], 'customer_id' => $job['customer_id'], 'status' => 'draft', 'created_by' => uid()]);
            update_row('job_cards', (int) $job['id'], ['invoice_id' => $id]);
            rebuild_draft($id, [], clean_discounts($body['discounts'] ?? []), (float) $in['bill_disc_pct']);
            job_event((int) $job['id'], 'invoice_draft', ['invoice_id' => $id]);
            return $id;
        });
        return ['item' => invoice_view($id)];
    }

    // Counter sale (walk-in or known customer)
    $items = (array) ($body['items'] ?? []);
    if (!$items) {
        fail(422, 'validation_failed', 'Add at least one part', ['items' => 'required']);
    }
    if (!empty($in['customer_id']) && !val('SELECT id FROM customers WHERE id = ?', [$in['customer_id']])) {
        fail(422, 'validation_failed', 'Unknown customer', ['customer_id' => 'invalid_choice']);
    }
    $id = tx(function () use ($in, $items) {
        $id = insert('invoices', [
            'inv_type' => 'counter',
            'customer_id' => $in['customer_id'] ?? null,
            'cust_name' => $in['cust_name'] ?? null,
            'cust_phone' => $in['cust_phone'] ?? null,
            'status' => 'draft',
            'created_by' => uid(),
        ]);
        rebuild_draft($id, $items, [], (float) $in['bill_disc_pct']);
        return $id;
    });
    return ['item' => invoice_view($id)];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* Update a draft: discounts (owner), counter items / customer (desk, owner), or refresh job lines. */
route('PUT', '/invoices/{id}', function ($p) {
    $id = (int) $p['id'];
    $inv = invoice_row($id);
    if ($inv['status'] !== 'draft') {
        fail(409, 'invoice_final', 'Only a draft bill can be changed');
    }
    $body = body();
    check_discount_rights($body);
    $in = clean($body, ['customer_id' => 'int', 'cust_name' => 'str|max:120', 'cust_phone' => 'phone', 'bill_disc_pct' => 'num|min:0|max:100'], true);
    tx(function () use ($id, $inv, $in, $body) {
        if ($inv['inv_type'] === 'counter') {
            update_row('invoices', $id, pick($in, ['customer_id', 'cust_name', 'cust_phone']));
        }
        $discounts = array_key_exists('discounts', $body) ? clean_discounts($body['discounts']) : null;
        $items = $inv['inv_type'] === 'counter' && array_key_exists('items', $body) ? (array) $body['items'] : [];
        rebuild_draft($id, $items, $discounts, array_key_exists('bill_disc_pct', $in) ? (float) ($in['bill_disc_pct'] ?? 0) : null);
    });
    return ['item' => invoice_view($id)];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

route('DELETE', '/invoices/{id}', function ($p) {
    $inv = invoice_row((int) $p['id']);
    if ($inv['status'] !== 'draft') {
        fail(409, 'invoice_final', 'Only a draft bill can be deleted');
    }
    tx(function () use ($inv) {
        if ($inv['job_card_id']) {
            q('UPDATE job_cards SET invoice_id = NULL, updated_at = ? WHERE id = ? AND invoice_id = ?', [now(), $inv['job_card_id'], $inv['id']]);
        }
        q('DELETE FROM invoice_items WHERE invoice_id = ?', [$inv['id']]);
        q('DELETE FROM invoices WHERE id = ?', [$inv['id']]);
    });
    return ['ok' => true];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* ------------------------------------------------------------------ finalise: number, stock, payment, credit check */

route('POST', '/invoices/{id}/finalize', function ($p) {
    $id = (int) $p['id'];
    $body = body();
    $in = clean($body, ['invoice_date' => 'date']);
    $pays = [];
    foreach ((array) ($body['payments'] ?? []) as $i => $raw) {
        try {
            $pay = clean(is_array($raw) ? $raw : [], ['mode' => 'enum:cash,upi,card,bank,credit|req', 'amount' => 'num|req|min:0|max:10000000', 'reference' => 'str|max:60']);
        } catch (ApiError $e) {
            fail(422, 'validation_failed', 'Check the payment lines', ["payments.$i" => $e->fields]);
        }
        if ($pay['mode'] !== 'credit' && $pay['amount'] > 0) {
            $pays[] = $pay; // "credit" is simply the unpaid part
        }
    }

    tx(function () use ($id, $in, $pays) {
        $inv = row('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [$id]) ?? not_found('Invoice');
        if ($inv['status'] !== 'draft') {
            fail(409, 'invoice_final', 'This bill is already final');
        }
        if ($inv['inv_type'] === 'job') {
            $job = job_row((int) $inv['job_card_id']);
            if (job_money($job)['revision_pending']) {
                fail(409, 'revision_pending', 'A revised estimate is waiting for the customer\'s approval');
            }
            // Pick up any change on the job since the draft was made (keeps discounts).
            rebuild_draft($id);
            $inv = row('SELECT * FROM invoices WHERE id = ?', [$id]);
        } elseif ((int) $inv['gst_registered'] !== (gst_registered() ? 1 : 0)) {
            // GST registration changed while this counter draft was open: recompute with today's rule.
            rebuild_draft($id);
            $inv = row('SELECT * FROM invoices WHERE id = ?', [$id]);
        }
        $total = (float) $inv['grand_total'];
        if ($total <= 0) {
            fail(409, 'nothing_to_bill', 'The bill is empty');
        }
        $paid = r2(array_sum(array_map(static fn ($x) => (float) $x['amount'], $pays)));
        if ($paid > $total + 0.004) {
            fail(422, 'overpaid', 'Payments are more than the bill total', ['payments' => 'out_of_range']);
        }
        $unpaid = r2($total - $paid);
        $customerId = $inv['customer_id'] ? (int) $inv['customer_id'] : null;
        if ($unpaid > 0.004) {
            // Credit (or part payment) only for trusted customers within their limit.
            $c = $customerId ? row('SELECT is_trusted, credit_limit FROM customers WHERE id = ?', [$customerId]) : null;
            if (!$c || !(int) $c['is_trusted']) {
                fail(409, 'credit_not_allowed', 'Credit is allowed only for customers the owner has marked as trusted');
            }
            $limit = (float) $c['credit_limit'];
            $newBalance = r2(customer_balance($customerId) + $unpaid);
            if ($limit > 0 && $newBalance > $limit + 0.004) {
                fail(409, 'credit_limit_exceeded', 'This bill would take the customer over the credit limit of ' . inr($limit) . ' (dues would be ' . inr($newBalance) . ')');
            }
        }

        $date = $in['invoice_date'] ?? today();
        if ($date > today()) {
            fail(422, 'validation_failed', 'The bill date cannot be in the future', ['invoice_date' => 'future_date']);
        }
        $lastDate = val("SELECT MAX(invoice_date) FROM invoices WHERE status <> 'draft' AND invoice_no IS NOT NULL");
        if ($lastDate && $date < $lastDate) {
            fail(422, 'validation_failed', 'The bill date cannot be earlier than the last bill (' . $lastDate . ')', ['invoice_date' => 'before_last_bill']);
        }
        $cust = $customerId ? row('SELECT name, phone, gstin, state_code FROM customers WHERE id = ?', [$customerId]) : null;
        $data = [
            'invoice_no' => next_invoice_no($date),
            'invoice_date' => $date,
            'status' => 'final',
            'finalized_at' => now(),
            'cust_name' => $cust['name'] ?? $inv['cust_name'],
            'cust_phone' => $cust['phone'] ?? $inv['cust_phone'],
            'cust_gstin' => $cust['gstin'] ?? null,
            'cust_state_code' => $cust['state_code'] ?? setting('shop_state_code', '27'),
        ];
        update_row('invoices', $id, $data);

        // Counter sale: stock leaves now. Record the cost for the profit report.
        foreach (rows('SELECT * FROM invoice_items WHERE invoice_id = ?', [$id]) as $it) {
            if ($inv['inv_type'] === 'counter' && $it['part_id']) {
                $mv = stock_move((int) $it['part_id'], -(float) $it['qty'], 'counter_sale', 'invoice', $id, null, $data['invoice_no']);
                q('UPDATE invoice_items SET unit_cost = ? WHERE id = ?', [$mv['unit_cost'], $it['id']]);
            }
        }
        foreach ($pays as $pay) {
            record_customer_payment($customerId, (float) $pay['amount'], $pay['mode'], $pay['reference'] ?? null, $id);
        }
        refresh_invoice_payments($id);
        if ($customerId) {
            apply_customer_advance($customerId);
        }
        if ((float) $inv['discount_total'] > 0) {
            audit('invoice_discount', 'invoice', $id, null, ['invoice_no' => $data['invoice_no'], 'discount_total' => (float) $inv['discount_total'], 'bill_disc_pct' => (float) $inv['bill_disc_pct']]);
        }
        if ($inv['job_card_id']) {
            job_event((int) $inv['job_card_id'], 'invoice_final', ['invoice_no' => $data['invoice_no'], 'total' => $total]);
        }
    });
    return ['item' => invoice_view($id)];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* Later payment against one bill. */
route('POST', '/invoices/{id}/payments', function ($p) {
    $id = (int) $p['id'];
    $in = clean(body(), ['amount' => 'num|req|min:0.01|max:10000000', 'mode' => 'enum:cash,upi,card,bank|req', 'reference' => 'str|max:60']);
    tx(function () use ($id, $in) {
        $inv = row('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [$id]) ?? not_found('Invoice');
        if ($inv['status'] !== 'final') {
            fail(409, 'invoice_not_final', 'Finalise the bill first');
        }
        if ((float) $in['amount'] > (float) $inv['balance'] + 0.004) {
            fail(422, 'overpaid', 'Amount is more than the balance of ' . inr((float) $inv['balance']), ['amount' => 'out_of_range']);
        }
        record_customer_payment($inv['customer_id'] ? (int) $inv['customer_id'] : null, (float) $in['amount'], $in['mode'], $in['reference'] ?? null, $id);
    });
    return ['item' => invoice_view($id)];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* Cancel a final bill (owner only): counter-sale stock comes back, the job reopens. */
route('POST', '/invoices/{id}/cancel', function ($p) {
    $id = (int) $p['id'];
    $in = clean(body(), ['reason' => 'str|req|max:255']);
    tx(function () use ($id, $in) {
        $inv = row('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [$id]) ?? not_found('Invoice');
        if ($inv['status'] !== 'final') {
            fail(409, 'invoice_not_final', 'Only a final bill can be cancelled');
        }
        if ($inv['inv_type'] === 'counter') {
            foreach (rows("SELECT * FROM invoice_items WHERE invoice_id = ? AND part_id IS NOT NULL", [$id]) as $it) {
                stock_move((int) $it['part_id'], (float) $it['qty'], 'sale_cancel', 'invoice', $id, (float) $it['unit_cost'], 'Cancelled ' . $inv['invoice_no']);
            }
        }
        // Money received stays with the customer as an advance; it no longer pays this bill.
        q('DELETE FROM payment_allocations WHERE invoice_id = ?', [$id]);
        update_row('invoices', $id, ['status' => 'cancelled', 'cancel_reason' => $in['reason'], 'cancelled_by' => uid(), 'cancelled_at' => now(), 'paid_total' => 0, 'balance' => 0]);
        if ($inv['customer_id']) {
            apply_customer_advance((int) $inv['customer_id']);
        }
        if ($inv['job_card_id']) {
            $job = row('SELECT status FROM job_cards WHERE id = ?', [$inv['job_card_id']]);
            update_row('job_cards', (int) $inv['job_card_id'], ['invoice_id' => null, 'status' => 'ready', 'delivered_at' => null]);
            job_event((int) $inv['job_card_id'], 'job_status', ['from' => $job['status'], 'to' => 'ready', 'note' => 'Bill ' . $inv['invoice_no'] . ' cancelled']);
        }
        audit('invoice_cancel', 'invoice', $id, ['invoice_no' => $inv['invoice_no'], 'total' => (float) $inv['grand_total']], ['reason' => $in['reason']]);
    });
    return ['item' => invoice_view($id)];
}, ['roles' => [ROLE_OWNER]]);

/* ------------------------------------------------------------------ printable bilingual tax invoice */

route('GET', '/invoices/{id}/html', function ($p) {
    $inv = invoice_row((int) $p['id']);
    $lang = in_array(qp('lang'), ['mr', 'en'], true) ? qp('lang') : ($inv['customer_language'] ?: 'mr');
    $byRate = invoice_tax_summary($inv['items']);
    ob_start();
    include API_DIR . '/templates/invoice.php';
    return html_response((string) ob_get_clean());
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* The same bill as a thermal receipt (58 / 80 mm) for phone printing; ?width= overrides the setting. */
route('GET', '/invoices/{id}/receipt', function ($p) {
    $inv = invoice_row((int) $p['id']);
    $lang = in_array(qp('lang'), ['mr', 'en'], true) ? qp('lang') : ($inv['customer_language'] ?: 'mr');
    $paper = (int) (in_array(qp('width'), ['58', '80'], true) ? qp('width') : setting('receipt_width', '58'));
    $paper = $paper === 80 ? 80 : 58;
    $byRate = invoice_tax_summary($inv['items']);
    ob_start();
    include API_DIR . '/templates/receipt.php';
    return html_response((string) ob_get_clean());
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

route('POST', '/invoices/{id}/whatsapp', function ($p) {
    $inv = invoice_row((int) $p['id']);
    $phone = $inv['customer_phone'] ?: $inv['cust_phone'];
    if (!$phone) {
        fail(409, 'no_phone', 'This bill has no phone number');
    }
    $lang = $inv['customer_language'] ?: 'mr';
    $text = wa_text('bill', [
        'name' => $inv['customer_name'] ?: $inv['cust_name'],
        'no' => $inv['invoice_no'] ?? '',
        'reg' => $inv['reg_no'] ?? '',
        'total' => inr((float) $inv['grand_total']),
        'paid' => inr((float) $inv['paid_total']),
        'balance' => inr((float) $inv['balance']),
        'shop' => shop_name_for($lang),
    ], $lang);
    log_message($inv['customer_id'] ? (int) $inv['customer_id'] : null, 'bill', 'invoice', (int) $inv['id'], $text);
    return ['url' => wa_url($phone, $text), 'text' => $text];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* ------------------------------------------------------------------ customer ledger and payments */

route('GET', '/customers/{id}/ledger', function ($p) {
    $c = customer_by_id((int) $p['id']);
    $entries = [];
    if ((float) $c['opening_balance'] != 0.0) {
        $entries[] = ['date' => substr((string) $c['created_at'], 0, 10), 'seq' => 0, 'type' => 'opening', 'ref' => null, 'ref_id' => null, 'debit' => max(0, (float) $c['opening_balance']), 'credit' => max(0, -(float) $c['opening_balance']), 'mode' => null];
    }
    foreach (rows("SELECT id, invoice_no, invoice_date, grand_total, finalized_at FROM invoices WHERE customer_id = ? AND status = 'final'", [$c['id']]) as $r) {
        $entries[] = ['date' => $r['invoice_date'], 'seq' => strtotime((string) $r['finalized_at']), 'type' => 'invoice', 'ref' => $r['invoice_no'], 'ref_id' => (int) $r['id'], 'debit' => (float) $r['grand_total'], 'credit' => 0.0, 'mode' => null];
    }
    foreach (rows('SELECT * FROM customer_payments WHERE customer_id = ?', [$c['id']]) as $r) {
        $entries[] = ['date' => $r['received_on'], 'seq' => strtotime((string) $r['created_at']) + 1, 'type' => 'payment', 'ref' => $r['reference'], 'ref_id' => $r['invoice_id'] ? (int) $r['invoice_id'] : null, 'debit' => 0.0, 'credit' => (float) $r['amount'], 'mode' => $r['mode']];
    }
    usort($entries, static fn ($a, $b) => [$a['date'], $a['seq']] <=> [$b['date'], $b['seq']]);
    $bal = 0.0;
    foreach ($entries as &$e) {
        $bal = r2($bal + $e['debit'] - $e['credit']);
        $e['balance'] = $bal;
        unset($e['seq']);
    }
    unset($e);
    $open = rows("SELECT id, invoice_no, invoice_date, grand_total, balance FROM invoices WHERE customer_id = ? AND status = 'final' AND balance > 0 ORDER BY invoice_date, id", [$c['id']]);
    return ['customer' => $c, 'items' => $entries, 'balance' => (float) $c['balance'], 'open_invoices' => $open];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* Payment from a customer: against one bill, or the oldest unpaid bills first. */
route('POST', '/customers/{id}/payments', function ($p) {
    $c = customer_by_id((int) $p['id']);
    $in = clean(body(), ['amount' => 'num|req|min:0.01|max:10000000', 'mode' => 'enum:cash,upi,card,bank|req', 'reference' => 'str|max:60', 'invoice_id' => 'int', 'note' => 'str|max:255']);
    if (!empty($in['invoice_id']) && !val("SELECT id FROM invoices WHERE id = ? AND customer_id = ? AND status = 'final'", [$in['invoice_id'], $c['id']])) {
        fail(422, 'validation_failed', 'Bill does not belong to this customer', ['invoice_id' => 'invalid_choice']);
    }
    $res = tx(fn () => record_customer_payment((int) $c['id'], (float) $in['amount'], $in['mode'], $in['reference'] ?? null, $in['invoice_id'] ?? null, $in['note'] ?? null));
    return $res + ['balance' => customer_balance((int) $c['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);
