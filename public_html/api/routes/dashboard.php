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

    return $out + dashboard_money($role);
});

/** Owner-only money figures: today's sales by payment mode, dues, payables, 30-day sales. */
function dashboard_money(string $role): array
{
    if ($role !== ROLE_OWNER) {
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
