<?php
declare(strict_types=1);

const SUPPLIER_RULES = [
    'name' => 'str|req|max:120',
    'contact_person' => 'str|max:100',
    'phone' => 'phone',
    'gstin' => 'gstin',
    'state_code' => 'state',
    'address' => 'str|max:255',
    'opening_balance' => 'num|min:-10000000|max:10000000|def:0',
    'active' => 'bool',
];

/** SQL expression: amount payable to the supplier (positive = we owe them). */
const SUPPLIER_BALANCE_SQL = "s.opening_balance
    + COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id = s.id AND p.status <> 'cancelled'), 0)
    - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0)";

function supplier_by_id(int $id): array
{
    $s = row('SELECT s.*, ROUND(' . SUPPLIER_BALANCE_SQL . ', 2) AS balance FROM suppliers s WHERE s.id = ?', [$id]) ?? not_found('Supplier');
    $s['state_name'] = GST_STATES[$s['state_code']] ?? '';
    return $s;
}

function prepare_supplier_input(array $in): array
{
    // State follows the GSTIN when one is given.
    if (!empty($in['gstin'])) {
        $in['state_code'] = substr($in['gstin'], 0, 2);
    }
    if (array_key_exists('state_code', $in) && empty($in['state_code'])) {
        $in['state_code'] = setting('shop_state_code', '27');
    }
    if (!empty($in['state_code']) && !isset(GST_STATES[$in['state_code']])) {
        fail(422, 'validation_failed', 'Unknown state', ['state_code' => 'invalid_state']);
    }
    return $in;
}

route('GET', '/suppliers', function () {
    [$limit, $offset] = paging(100, 500);
    $where = [];
    $params = [];
    if (!qp('all')) {
        $where[] = 's.active = 1';
    }
    if (($term = qp('q')) !== null && $term !== '') {
        $like = like($term);
        $where[] = '(s.name LIKE ? OR s.contact_person LIKE ? OR s.phone LIKE ? OR s.gstin LIKE ?)';
        array_push($params, $like, $like, $like, $like);
    }
    if (qp('due')) {
        $where[] = '(' . SUPPLIER_BALANCE_SQL . ') > 0.004';
    }
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $total = (int) val("SELECT COUNT(*) FROM suppliers s $w", $params);
    $items = rows("SELECT s.*, ROUND(" . SUPPLIER_BALANCE_SQL . ", 2) AS balance FROM suppliers s $w ORDER BY s.name LIMIT $limit OFFSET $offset", $params);
    $payable = (float) val('SELECT COALESCE(SUM(b), 0) FROM (SELECT ' . SUPPLIER_BALANCE_SQL . ' AS b FROM suppliers s) x WHERE b > 0');
    return ['items' => $items, 'total' => $total, 'payable_total' => r2($payable)];
}, ['perm' => 'purchases']);

route('GET', '/suppliers/{id}', function ($p) {
    return ['item' => supplier_by_id((int) $p['id'])];
}, ['perm' => 'purchases']);

route('POST', '/suppliers', function () {
    $in = prepare_supplier_input(clean(body(), SUPPLIER_RULES));
    $in['state_code'] = $in['state_code'] ?? setting('shop_state_code', '27');
    $in['active'] = $in['active'] ?? 1;
    $id = insert('suppliers', $in);
    return ['item' => supplier_by_id($id)];
}, ['perm' => 'purchases']);

route('PUT', '/suppliers/{id}', function ($p) {
    $id = (int) $p['id'];
    $before = supplier_by_id($id);
    $in = prepare_supplier_input(clean(body(), SUPPLIER_RULES, true));
    update_row('suppliers', $id, $in);
    if (array_key_exists('opening_balance', $in) && (float) $in['opening_balance'] !== (float) $before['opening_balance']) {
        audit('supplier_opening_balance', 'supplier', $id, ['opening_balance' => $before['opening_balance']], ['opening_balance' => $in['opening_balance']]);
    }
    return ['item' => supplier_by_id($id)];
}, ['perm' => 'purchases']);

/*
 * Delete a supplier entered by mistake. A supplier with bills, payments or an opening balance keeps its history:
 * it is hidden from the lists instead (active = 0) and can be shown again by editing it.
 */
route('DELETE', '/suppliers/{id}', function ($p) {
    $id = (int) $p['id'];
    $s = supplier_by_id($id);
    $used = (int) val('SELECT COUNT(*) FROM purchases WHERE supplier_id = ?', [$id])
        + (int) val('SELECT COUNT(*) FROM supplier_payments WHERE supplier_id = ?', [$id]);
    if ($used || abs((float) $s['opening_balance']) >= 0.005) {
        update_row('suppliers', $id, ['active' => 0]);
        audit('supplier_hide', 'supplier', $id, ['name' => $s['name'], 'active' => (int) $s['active']], ['active' => 0]);
        return ['deleted' => false, 'hidden' => true];
    }
    q('DELETE FROM suppliers WHERE id = ?', [$id]);
    audit('supplier_delete', 'supplier', $id, ['name' => $s['name'], 'phone' => $s['phone'], 'gstin' => $s['gstin']], null);
    return ['deleted' => true, 'hidden' => false];
}, ['perm' => 'purchases']);

/*
 * Supplier ledger: opening balance, bills (add to payable) and payments (reduce it), with a running balance.
 * ?from=&to= limits the rows; the balance before "from" is shown as "brought forward".
 */
route('GET', '/suppliers/{id}/ledger', function ($p) {
    $id = (int) $p['id'];
    $s = supplier_by_id($id);
    $from = qp_date('from');
    $to = qp_date('to');

    $entries = [];
    $entries[] = ['date' => substr((string) $s['created_at'], 0, 10), 'seq' => 0, 'type' => 'opening', 'ref' => null, 'ref_id' => null, 'bill' => max(0, (float) $s['opening_balance']), 'paid' => max(0, -(float) $s['opening_balance']), 'note' => null, 'mode' => null];
    foreach (rows('SELECT id, bill_no, bill_date, total, payment_mode, notes, created_at FROM purchases WHERE supplier_id = ? AND status <> \'cancelled\'', [$id]) as $r) {
        $entries[] = ['date' => $r['bill_date'], 'seq' => strtotime((string) $r['created_at']), 'type' => 'bill', 'ref' => $r['bill_no'], 'ref_id' => (int) $r['id'], 'bill' => (float) $r['total'], 'paid' => 0.0, 'note' => $r['notes'], 'mode' => $r['payment_mode']];
    }
    foreach (rows('SELECT sp.*, p.bill_no FROM supplier_payments sp LEFT JOIN purchases p ON p.id = sp.purchase_id WHERE sp.supplier_id = ?', [$id]) as $r) {
        $entries[] = ['date' => $r['paid_on'], 'seq' => strtotime((string) $r['created_at']) + 1, 'type' => 'payment', 'ref' => $r['reference'] ?: $r['bill_no'], 'ref_id' => $r['purchase_id'] ? (int) $r['purchase_id'] : null, 'bill' => 0.0, 'paid' => (float) $r['amount'], 'note' => $r['note'], 'mode' => $r['mode']];
    }
    usort($entries, static fn ($a, $b) => [$a['date'], $a['seq']] <=> [$b['date'], $b['seq']]);

    $bal = 0.0;
    $broughtForward = 0.0;
    $out = [];
    foreach ($entries as $e) {
        $bal = r2($bal + $e['bill'] - $e['paid']);
        if ($from && $e['date'] < $from) {
            $broughtForward = $bal;
            continue;
        }
        if ($to && $e['date'] > $to) {
            continue;
        }
        if ($e['type'] === 'opening' && $e['bill'] == 0.0 && $e['paid'] == 0.0) {
            continue;
        }
        $e['balance'] = $bal;
        unset($e['seq']);
        $out[] = $e;
    }
    return ['supplier' => $s, 'items' => $out, 'brought_forward' => $broughtForward, 'balance' => (float) $s['balance']];
}, ['perm' => 'purchases']);

/* Record a payment to a supplier (full or part). */
route('POST', '/suppliers/{id}/payments', function ($p) {
    $id = (int) $p['id'];
    supplier_by_id($id);
    $in = clean(body(), [
        'amount' => 'num|req|min:0.01|max:10000000',
        'mode' => 'enum:cash,upi,bank,card|req',
        'reference' => 'str|max:60',
        'paid_on' => 'date',
        'note' => 'str|max:255',
        'purchase_id' => 'int',
    ]);
    if (!empty($in['purchase_id']) && !val('SELECT id FROM purchases WHERE id = ? AND supplier_id = ?', [$in['purchase_id'], $id])) {
        fail(422, 'validation_failed', 'Bill does not belong to this supplier', ['purchase_id' => 'invalid_choice']);
    }
    $payId = insert('supplier_payments', [
        'supplier_id' => $id,
        'purchase_id' => $in['purchase_id'] ?? null,
        'amount' => r2((float) $in['amount']),
        'mode' => $in['mode'],
        'reference' => $in['reference'] ?? null,
        'paid_on' => $in['paid_on'] ?? today(),
        'note' => $in['note'] ?? null,
        'user_id' => uid(),
    ]);
    return ['payment_id' => $payId, 'item' => supplier_by_id($id)];
}, ['perm' => 'purchases']);
