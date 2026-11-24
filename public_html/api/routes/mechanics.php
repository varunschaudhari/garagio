<?php
declare(strict_types=1);

/*
 * Mechanic daily summary (owner only): per mechanic, the jobs billed that day with labour and
 * parts value. The owner types what he pays each mechanic (his decision) - stored in mechanic_payments.
 */

/** Work done per mechanic in a date range, taken from final bills of their jobs. */
function mechanic_work(string $from, string $to, ?int $mechanicId = null): array
{
    $params = [$from, $to];
    $extra = '';
    if ($mechanicId) {
        $extra = ' AND j.mechanic_id = ?';
        $params[] = $mechanicId;
    }
    $rows = rows(
        "SELECT j.mechanic_id, j.id AS job_id, j.job_no, v.reg_no, i.invoice_no, i.invoice_date,
                COALESCE(SUM(CASE WHEN ii.item_type = 'labour' THEN ii.line_total END), 0) AS labour,
                COALESCE(SUM(CASE WHEN ii.item_type = 'part' THEN ii.line_total END), 0) AS parts
         FROM invoices i JOIN job_cards j ON j.id = i.job_card_id JOIN vehicles v ON v.id = j.vehicle_id
         JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE i.status = 'final' AND i.invoice_date BETWEEN ? AND ? AND j.mechanic_id IS NOT NULL $extra
         GROUP BY j.mechanic_id, j.id, j.job_no, v.reg_no, i.invoice_no, i.invoice_date
         ORDER BY i.invoice_date, j.id",
        $params
    );
    $by = [];
    foreach ($rows as $r) {
        $by[(int) $r['mechanic_id']][] = $r;
    }
    return $by;
}

function mechanic_paid(string $from, string $to): array
{
    $out = [];
    foreach (rows('SELECT mechanic_id, kind, SUM(amount) AS amt FROM mechanic_payments WHERE work_date BETWEEN ? AND ? GROUP BY mechanic_id, kind', [$from, $to]) as $r) {
        $out[(int) $r['mechanic_id']][$r['kind']] = (float) $r['amt'];
    }
    return $out;
}

route('GET', '/mechanics/daily', function () {
    $date = qp_date('date', today());
    $work = mechanic_work($date, $date);
    $paid = mechanic_paid($date, $date);
    $out = [];
    foreach (rows("SELECT id, name, phone, username, active, password_hash IS NOT NULL AS login FROM users WHERE role = 'mechanic' ORDER BY active DESC, name") as $m) {
        $id = (int) $m['id'];
        $jobs = $work[$id] ?? [];
        if (!(int) $m['active'] && !$jobs && empty($paid[$id])) {
            continue;
        }
        $out[] = [
            'id' => $id,
            'name' => $m['name'],
            'phone' => $m['phone'],
            'username' => $m['username'],
            'login' => (bool) $m['login'],
            'active' => (int) $m['active'],
            'jobs' => $jobs,
            'jobs_count' => count($jobs),
            'labour_billed' => r2(array_sum(array_column($jobs, 'labour'))),
            'parts_value' => r2(array_sum(array_column($jobs, 'parts'))),
            'paid_daily' => r2($paid[$id]['daily'] ?? 0),
            'paid_advance' => r2($paid[$id]['advance'] ?? 0),
            'payments' => rows('SELECT id, amount, kind, note, created_at FROM mechanic_payments WHERE mechanic_id = ? AND work_date = ? ORDER BY id', [$id, $date]),
        ];
    }
    return ['date' => $date, 'items' => $out];
}, ['roles' => [ROLE_OWNER]]);

/* Weekly / monthly totals per mechanic, including advances. */
route('GET', '/mechanics/summary', function () {
    $from = qp_date('from', date('Y-m-01'));
    $to = qp_date('to', today());
    $work = mechanic_work($from, $to);
    $paid = mechanic_paid($from, $to);
    $out = [];
    foreach (rows("SELECT id, name, active FROM users WHERE role = 'mechanic' ORDER BY active DESC, name") as $m) {
        $id = (int) $m['id'];
        $jobs = $work[$id] ?? [];
        // A removed (hidden) mechanic still shows when he worked or was paid in the period.
        if (!(int) $m['active'] && !$jobs && empty($paid[$id])) {
            continue;
        }
        $out[] = [
            'id' => $id, 'name' => $m['name'], 'active' => (int) $m['active'], 'jobs_count' => count($jobs),
            'labour_billed' => r2(array_sum(array_column($jobs, 'labour'))),
            'parts_value' => r2(array_sum(array_column($jobs, 'parts'))),
            'paid_daily' => r2($paid[$id]['daily'] ?? 0),
            'paid_advance' => r2($paid[$id]['advance'] ?? 0),
            'paid_total' => r2(($paid[$id]['daily'] ?? 0) + ($paid[$id]['advance'] ?? 0)),
        ];
    }
    return ['from' => $from, 'to' => $to, 'items' => $out];
}, ['roles' => [ROLE_OWNER]]);

route('POST', '/mechanics/{id}/payments', function ($p) {
    $mid = (int) $p['id'];
    if (!val("SELECT id FROM users WHERE id = ? AND role = 'mechanic'", [$mid])) {
        not_found('Mechanic');
    }
    $in = clean(body(), ['work_date' => 'date', 'amount' => 'num|req|min:0.01|max:1000000', 'kind' => 'enum:daily,advance', 'note' => 'str|max:255']);
    $id = insert('mechanic_payments', [
        'mechanic_id' => $mid,
        'work_date' => $in['work_date'] ?? today(),
        'amount' => r2((float) $in['amount']),
        'kind' => $in['kind'] ?? 'daily',
        'note' => $in['note'] ?? null,
        'paid_by' => uid(),
    ]);
    return ['item' => row('SELECT * FROM mechanic_payments WHERE id = ?', [$id])];
}, ['roles' => [ROLE_OWNER]]);

route('GET', '/mechanics/{id}/payments', function ($p) {
    $from = qp_date('from', date('Y-m-01'));
    $to = qp_date('to', today());
    $items = rows('SELECT mp.*, u.name AS paid_by_name FROM mechanic_payments mp LEFT JOIN users u ON u.id = mp.paid_by WHERE mp.mechanic_id = ? AND mp.work_date BETWEEN ? AND ? ORDER BY mp.work_date DESC, mp.id DESC', [(int) $p['id'], $from, $to]);
    $daily = array_sum(array_map(static fn ($x) => $x['kind'] === 'daily' ? (float) $x['amount'] : 0, $items));
    $adv = array_sum(array_map(static fn ($x) => $x['kind'] === 'advance' ? (float) $x['amount'] : 0, $items));
    return ['items' => $items, 'totals' => ['daily' => r2($daily), 'advance' => r2($adv), 'total' => r2($daily + $adv)]];
}, ['roles' => [ROLE_OWNER]]);

route('DELETE', '/mechanics/payments/{pid}', function ($p) {
    $row = row('SELECT * FROM mechanic_payments WHERE id = ?', [(int) $p['pid']]) ?? not_found('Payment');
    q('DELETE FROM mechanic_payments WHERE id = ?', [$row['id']]);
    audit('mechanic_payment_delete', 'mechanic_payment', (int) $row['id'], $row, null);
    return ['ok' => true];
}, ['roles' => [ROLE_OWNER]]);
