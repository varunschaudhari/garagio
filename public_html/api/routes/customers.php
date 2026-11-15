<?php
declare(strict_types=1);

const CUSTOMER_RULES = [
    'name' => 'str|req|max:120',
    'phone' => 'phone|req',
    'alt_phone' => 'phone',
    'address' => 'str|max:255',
    'gstin' => 'gstin',
    'state_code' => 'state',
    'language' => 'lang',
    'notes' => 'str|max:255',
];

const VEHICLE_RULES = [
    'reg_no' => 'regno|req',
    'make' => 'str|max:40',
    'model' => 'str|max:60',
    'year' => 'int|min:1950|max:2100',
    'last_odometer' => 'int|min:0|max:9999999',
];

/** Amount the customer owes (positive) - opening dues + final invoices − payments. */
const CUSTOMER_BALANCE_SQL = "c.opening_balance
    + COALESCE((SELECT SUM(i.grand_total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'final'), 0)
    - COALESCE((SELECT SUM(p.amount) FROM customer_payments p WHERE p.customer_id = c.id), 0)";

function customer_by_id(int $id): array
{
    $c = row('SELECT c.*, ROUND(' . CUSTOMER_BALANCE_SQL . ', 2) AS balance FROM customers c WHERE c.id = ?', [$id]) ?? not_found('Customer');
    $c['vehicles'] = rows('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY id', [$id]);
    return $c;
}

function prepare_customer_input(array $in): array
{
    if (!empty($in['gstin'])) {
        $in['state_code'] = substr($in['gstin'], 0, 2);
    }
    if (array_key_exists('state_code', $in) && empty($in['state_code'])) {
        $in['state_code'] = setting('shop_state_code', '27');
    }
    return $in;
}

function create_vehicle(int $customerId, array $raw): int
{
    $v = clean($raw, VEHICLE_RULES);
    if (val('SELECT id FROM vehicles WHERE reg_no = ?', [$v['reg_no']])) {
        fail(409, 'duplicate_vehicle', 'This bike number is already registered', ['reg_no' => 'duplicate']);
    }
    return insert('vehicles', ['customer_id' => $customerId] + $v);
}

/* Lookup by phone or bike number - the single search box on the new job card. */
route('GET', '/lookup', function () {
    $term = trim((string) qp('q', ''));
    if (mb_strlen($term) < 3) {
        return ['customers' => []];
    }
    $digits = preg_replace('/\D+/', '', $term);
    $reg = normalize_reg_no($term);
    $ids = [];
    if (strlen($digits) >= 4) {
        foreach (rows('SELECT id FROM customers WHERE phone LIKE ? OR alt_phone LIKE ? LIMIT 10', ['%' . $digits . '%', '%' . $digits . '%']) as $r) {
            $ids[(int) $r['id']] = true;
        }
    }
    if (strlen($reg) >= 3) {
        foreach (rows('SELECT customer_id FROM vehicles WHERE reg_no LIKE ? LIMIT 10', ['%' . $reg . '%']) as $r) {
            $ids[(int) $r['customer_id']] = true;
        }
    }
    foreach (rows('SELECT id FROM customers WHERE name LIKE ? LIMIT 10', [like($term)]) as $r) {
        $ids[(int) $r['id']] = true;
    }
    $out = [];
    foreach (array_slice(array_keys($ids), 0, 10) as $id) {
        $c = customer_by_id($id);
        $c['open_job'] = row("SELECT id, job_no, status, vehicle_id FROM job_cards WHERE customer_id = ? AND status NOT IN ('delivered','cancelled') ORDER BY id DESC LIMIT 1", [$id]);
        $out[] = $c;
    }
    return ['customers' => $out, 'reg_no' => strlen($reg) >= 4 ? $reg : null, 'phone' => normalize_phone($term)];
}, ['perm' => ['jobs', 'customers']]);

route('GET', '/customers', function () {
    [$limit, $offset] = paging(50, 500);
    $where = [];
    $params = [];
    if (($term = qp('q')) !== null && $term !== '') {
        $like = like($term);
        $reg = like(normalize_reg_no($term));
        $where[] = '(c.name LIKE ? OR c.phone LIKE ? OR c.alt_phone LIKE ? OR EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id AND v.reg_no LIKE ?))';
        array_push($params, $like, $like, $like, $reg);
    }
    if (qp('trusted')) {
        $where[] = 'c.is_trusted = 1';
    }
    if (qp('due')) {
        $where[] = '(' . CUSTOMER_BALANCE_SQL . ') > 0.004';
    }
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $total = (int) val("SELECT COUNT(*) FROM customers c $w", $params);
    $items = rows(
        "SELECT c.*, ROUND(" . CUSTOMER_BALANCE_SQL . ", 2) AS balance,
                (SELECT GROUP_CONCAT(v.reg_no ORDER BY v.id SEPARATOR ', ') FROM vehicles v WHERE v.customer_id = c.id) AS reg_nos
         FROM customers c $w ORDER BY c.name LIMIT $limit OFFSET $offset",
        $params
    );
    return ['items' => $items, 'total' => $total];
}, ['perm' => 'customers']);

route('GET', '/customers/{id}', function ($p) {
    $c = customer_by_id((int) $p['id']);
    $c['jobs'] = rows(
        'SELECT j.id, j.job_no, j.status, j.created_at, j.delivered_at, j.odometer, v.reg_no, i.grand_total AS invoice_total, i.invoice_no
         FROM job_cards j JOIN vehicles v ON v.id = j.vehicle_id LEFT JOIN invoices i ON i.id = j.invoice_id
         WHERE j.customer_id = ? ORDER BY j.id DESC LIMIT 50',
        [$c['id']]
    );
    return ['item' => $c];
}, ['perm' => ['customers', 'jobs', 'make_bills']]);

route('POST', '/customers', function () {
    $body = body();
    $in = prepare_customer_input(clean($body, CUSTOMER_RULES + ['opening_balance' => 'num|min:-10000000|max:10000000']));
    if (val('SELECT id FROM customers WHERE phone = ?', [$in['phone']])) {
        fail(409, 'duplicate_phone', 'A customer with this phone number already exists', ['phone' => 'duplicate']);
    }
    // Opening dues are money: owner only.
    if (!is_role(ROLE_OWNER)) {
        unset($in['opening_balance']);
    }
    $in['language'] = $in['language'] ?? 'mr';
    $in['state_code'] = $in['state_code'] ?? setting('shop_state_code', '27');
    $id = tx(function () use ($in, $body) {
        $id = insert('customers', $in);
        foreach ((array) ($body['vehicles'] ?? []) as $v) {
            create_vehicle($id, is_array($v) ? $v : []);
        }
        if (!empty($in['opening_balance'])) {
            audit('customer_opening_balance', 'customer', $id, null, ['opening_balance' => $in['opening_balance']]);
        }
        return $id;
    });
    return ['item' => customer_by_id($id)];
}, ['perm' => ['customers', 'jobs']]);

route('PUT', '/customers/{id}', function ($p) {
    $id = (int) $p['id'];
    $before = customer_by_id($id);
    $in = prepare_customer_input(clean(body(), CUSTOMER_RULES + ['opening_balance' => 'num|min:-10000000|max:10000000'], true));
    if (!is_role(ROLE_OWNER)) {
        unset($in['opening_balance']);
    }
    if (isset($in['phone']) && val('SELECT id FROM customers WHERE phone = ? AND id <> ?', [$in['phone'], $id])) {
        fail(409, 'duplicate_phone', 'A customer with this phone number already exists', ['phone' => 'duplicate']);
    }
    update_row('customers', $id, $in);
    if (array_key_exists('opening_balance', $in) && (float) $in['opening_balance'] !== (float) $before['opening_balance']) {
        audit('customer_opening_balance', 'customer', $id, ['opening_balance' => $before['opening_balance']], ['opening_balance' => $in['opening_balance']]);
    }
    return ['item' => customer_by_id($id)];
}, ['perm' => 'customers']);

/* Trusted-for-credit flag and limit: owner only, audited. */
route('PUT', '/customers/{id}/credit', function ($p) {
    $id = (int) $p['id'];
    $before = customer_by_id($id);
    $in = clean(body(), ['is_trusted' => 'bool', 'credit_limit' => 'num|min:0|max:10000000|def:0'], true);
    update_row('customers', $id, $in);
    $after = customer_by_id($id);
    audit('credit_change', 'customer', $id, pick($before, ['is_trusted', 'credit_limit']), pick($after, ['is_trusted', 'credit_limit']));
    return ['item' => $after];
}, ['roles' => [ROLE_OWNER]]);

/* ------------------------------------------------------------------ vehicles */

route('POST', '/customers/{id}/vehicles', function ($p) {
    $cid = (int) $p['id'];
    customer_by_id($cid);
    $vid = create_vehicle($cid, body());
    return ['item' => row('SELECT * FROM vehicles WHERE id = ?', [$vid])];
}, ['perm' => ['customers', 'jobs']]);

route('PUT', '/vehicles/{id}', function ($p) {
    $id = (int) $p['id'];
    row('SELECT id FROM vehicles WHERE id = ?', [$id]) ?? not_found('Vehicle');
    $in = clean(body(), VEHICLE_RULES, true);
    if (isset($in['reg_no']) && val('SELECT id FROM vehicles WHERE reg_no = ? AND id <> ?', [$in['reg_no'], $id])) {
        fail(409, 'duplicate_vehicle', 'This bike number is already registered', ['reg_no' => 'duplicate']);
    }
    update_row('vehicles', $id, $in);
    return ['item' => row('SELECT * FROM vehicles WHERE id = ?', [$id])];
}, ['perm' => 'customers']);

route('GET', '/vehicles/{id}/history', function ($p) {
    $v = row('SELECT v.*, c.name AS customer_name, c.phone AS customer_phone FROM vehicles v JOIN customers c ON c.id = v.customer_id WHERE v.id = ?', [(int) $p['id']]) ?? not_found('Vehicle');
    $mechanic = is_role(ROLE_MECHANIC);
    // Mechanics see the history of bikes they work on, without the customer's phone or bill amounts.
    if ($mechanic && !val('SELECT 1 FROM job_cards WHERE vehicle_id = ? AND mechanic_id = ? LIMIT 1', [$v['id'], uid()])) {
        fail(403, 'not_your_job', 'This bike is not on one of your jobs');
    }
    $v['jobs'] = rows(
        "SELECT j.id, j.job_no, j.status, j.odometer, j.complaint, j.created_at, j.delivered_at, m.name AS mechanic_name, i.invoice_no, i.grand_total AS invoice_total
         FROM job_cards j LEFT JOIN users m ON m.id = j.mechanic_id LEFT JOIN invoices i ON i.id = j.invoice_id
         WHERE j.vehicle_id = ? ORDER BY j.id DESC",
        [$v['id']]
    );
    if ($mechanic) {
        unset($v['customer_phone']);
        foreach ($v['jobs'] as &$jr) {
            unset($jr['invoice_total']);
        }
        unset($jr);
    }
    return ['item' => $v];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);
