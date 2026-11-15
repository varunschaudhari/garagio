<?php
declare(strict_types=1);

/*
 * Role-aware dashboard. Money figures are only computed for the owner.
 */
route('GET', '/dashboard', function () {
    $u = current_user();
    $role = $u['role'];
    $out = ['role' => $role];

    $out['stock'] = [
        'parts' => (int) val('SELECT COUNT(*) FROM parts WHERE active = 1'),
        'low_stock_count' => (int) val('SELECT COUNT(*) FROM parts WHERE active = 1 AND current_stock <= min_stock'),
        'out_of_stock' => (int) val('SELECT COUNT(*) FROM parts WHERE active = 1 AND current_stock <= 0'),
    ];
    if (can_see_cost()) {
        $out['stock']['stock_value'] = r2((float) val('SELECT COALESCE(SUM(current_stock * avg_cost), 0) FROM parts WHERE active = 1 AND current_stock > 0'));
    }
    $out['low_stock'] = rows(
        'SELECT p.id, p.part_no, p.name_en, p.name_mr, p.current_stock, p.min_stock, p.rack, l.name_en AS location_en, l.name_mr AS location_mr
         FROM parts p LEFT JOIN storage_locations l ON l.id = p.location_id
         WHERE p.active = 1 AND p.current_stock <= p.min_stock
         ORDER BY (p.current_stock - p.min_stock), p.name_en LIMIT 10'
    );

    $jobFilter = $role === ROLE_MECHANIC ? ' AND mechanic_id = ' . (int) $u['id'] : '';
    $byStatus = [];
    foreach (rows("SELECT status, COUNT(*) AS n FROM job_cards WHERE status NOT IN ('delivered','cancelled') $jobFilter GROUP BY status") as $r) {
        $byStatus[$r['status']] = (int) $r['n'];
    }
    $out['jobs_by_status'] = $byStatus;
    $out['delivered_today'] = (int) val("SELECT COUNT(*) FROM job_cards WHERE status = 'delivered' AND delivered_at >= ? $jobFilter", [today() . ' 00:00:00']);

    $out['open_requests'] = (int) val(
        "SELECT COUNT(DISTINCT r.id) FROM part_requests r JOIN part_request_items i ON i.request_id = r.id
         WHERE r.status = 'open' AND i.status IN ('requested','approved')"
    );
    $out['approvals_waiting'] = (int) val("SELECT COUNT(*) FROM part_request_items i JOIN part_requests r ON r.id = i.request_id WHERE r.status = 'open' AND i.status = 'needs_approval'");

    return $out + dashboard_money() + dashboard_bills();
});

/** Bill counts / totals (today, this month) and the latest bills: sales for the owner, purchases for owner + inventory. */
function dashboard_bills(): array
{
    $today = today();
    $month = date('Y-m-01');
    $sum = static function (string $sql, array $p): array {
        $r = row($sql, $p);
        return ['count' => (int) ($r['n'] ?? 0), 'total' => r2((float) ($r['t'] ?? 0))];
    };
    $out = [];
    if (can('see_money')) {
        $sales = "SELECT COUNT(*) AS n, COALESCE(SUM(grand_total), 0) AS t FROM invoices WHERE status = 'final' AND invoice_date ";
        $out['sales'] = [
            'today' => $sum($sales . '= ?', [$today]),
            'month' => $sum($sales . '>= ?', [$month]),
            'latest' => rows(
                "SELECT i.id, i.invoice_no, i.invoice_date, i.inv_type, i.grand_total, i.balance, i.pay_status, COALESCE(c.name, i.cust_name) AS customer_name, v.reg_no
                 FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN job_cards j ON j.id = i.job_card_id LEFT JOIN vehicles v ON v.id = j.vehicle_id
                 WHERE i.status = 'final' ORDER BY i.finalized_at DESC, i.id DESC LIMIT 8"
            ),
        ];
    }
    if (can('purchases')) {
        $purch = "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM purchases WHERE status <> 'cancelled' AND bill_date ";
        $out['purchases'] = [
            'today' => $sum($purch . '= ?', [$today]),
            'month' => $sum($purch . '>= ?', [$month]),
            'latest' => rows(
                'SELECT p.id, p.bill_no, p.bill_date, p.total, p.payment_mode, s.name AS supplier_name,
                        p.total - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0) AS due
                 FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status <> \'cancelled\' ORDER BY p.bill_date DESC, p.id DESC LIMIT 8'
            ),
        ];
    }
    return $out;
}

/** Money figures (permission see_money): today's sales by payment mode, dues, payables, 30-day sales. */
function dashboard_money(): array
{
    if (!can('see_money')) {
        return [];
    }
    $today = today();
    $byMode = ['cash' => 0.0, 'upi' => 0.0, 'card' => 0.0, 'bank' => 0.0];
    foreach (rows("SELECT p.mode, SUM(a.amount) AS amt FROM payment_allocations a JOIN customer_payments p ON p.id = a.payment_id
                   JOIN invoices i ON i.id = a.invoice_id WHERE i.status = 'final' AND i.invoice_date = ? GROUP BY p.mode", [$today]) as $r) {
        $byMode[$r['mode']] = r2((float) $r['amt']);
    }
    $sales = (float) val("SELECT COALESCE(SUM(grand_total), 0) FROM invoices WHERE status = 'final' AND invoice_date = ?", [$today]);
    $credit = (float) val("SELECT COALESCE(SUM(balance), 0) FROM invoices WHERE status = 'final' AND invoice_date = ?", [$today]);
    $series = [];
    for ($i = 29; $i >= 0; $i--) {
        $series[date('Y-m-d', strtotime("-$i days"))] = 0.0;
    }
    foreach (rows("SELECT invoice_date AS d, SUM(grand_total) AS t FROM invoices WHERE status = 'final' AND invoice_date >= ? GROUP BY invoice_date", [array_key_first($series)]) as $r) {
        $series[$r['d']] = r2((float) $r['t']);
    }
    return ['money' => [
        'sales_today' => r2($sales),
        'by_mode' => $byMode,
        'credit_today' => r2($credit),
        'customer_dues' => r2((float) val('SELECT COALESCE(SUM(b), 0) FROM (SELECT ' . CUSTOMER_BALANCE_SQL . ' AS b FROM customers c) x WHERE b > 0')),
        'supplier_payables' => r2((float) val('SELECT COALESCE(SUM(b), 0) FROM (SELECT ' . SUPPLIER_BALANCE_SQL . ' AS b FROM suppliers s) x WHERE b > 0')),
        'sales_30d' => array_map(static fn ($day, $tot) => ['date' => $day, 'total' => $tot], array_keys($series), array_values($series)),
    ]];
}
