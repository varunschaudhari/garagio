<?php
declare(strict_types=1);

/*
 * Reports. All accept from, to (YYYY-MM-DD) and format=xlsx (Excel) or format=csv.
 * Owner: everything. Inventory manager: stock, purchases, payables (decision 13).
 * Each report is a function returning its table (report_sales() ...), so the Excel workbook of everything
 * (routes/exports.php) can put them on sheets.
 */

/** Sheet titles in Excel downloads. */
const REPORT_TITLES = ['sales' => 'Sales bills', 'purchases' => 'Purchases', 'stock' => 'Stock value', 'profit' => 'Profit',
    'dues' => 'Customer dues', 'payables' => 'Supplier payables', 'gst' => 'GST summary', 'mechanics' => 'Mechanics'];

function report_range(): array
{
    return [qp_date('from', date('Y-m-01')), qp_date('to', today())];
}

/** A report's table. $columns: [key => English heading]. Also an Excel table sheet (lib/xlsx.php). */
function report_spec(string $name, array $columns, array $rows, array $totals = [], array $extra = []): array
{
    return ['name' => $name, 'columns' => $columns, 'rows' => $rows, 'totals' => $totals, 'extra' => $extra];
}

/** A report for Excel: codes in words (the screens translate them themselves). */
function report_for_excel(array $spec): array
{
    $words = ['job' => 'Job bill', 'counter' => 'Counter sale', 'return' => 'Return'];
    foreach ($spec['rows'] as &$r) {
        if (isset($r['type'])) {
            $r['type'] = $words[$r['type']] ?? $r['type'];
        }
        if (isset($r['mode'])) {
            $r['mode'] = tr('pay.' . $r['mode'], 'en');
        }
    }
    unset($r);
    return $spec;
}

/** Send a report as JSON ({columns, rows, totals}), Excel (format=xlsx) or CSV (format=csv). */
function report_send(array $spec)
{
    [$from, $to] = report_range();
    ['name' => $name, 'columns' => $columns, 'rows' => $rows, 'totals' => $totals] = $spec;
    if (qp('format') === 'xlsx') {
        return xlsx_response("$name-$from-to-$to.xlsx", [REPORT_TITLES[$name] ?? $name => report_for_excel($spec)]);
    }
    if (qp('format') === 'csv') {
        $data = array_map(static fn ($r) => array_map(static fn ($k) => $r[$k] ?? '', array_keys($columns)), $rows);
        if ($totals) {
            $data[] = array_map(static fn ($k) => $totals[$k] ?? '', array_keys($columns));
        }
        return csv_response("$name-$from-to-$to.csv", array_values($columns), $data);
    }
    return ['report' => $name, 'from' => $from, 'to' => $to, 'columns' => array_keys($columns), 'rows' => $rows, 'totals' => $totals] + $spec['extra'];
}

function sum_cols(array $rows, array $keys): array
{
    $t = [];
    foreach ($keys as $k) {
        $t[$k] = r2(array_sum(array_map(static fn ($r) => (float) ($r[$k] ?? 0), $rows)));
    }
    return $t;
}

/** Profit for a range: sales (taxable, ex-GST) − cost of parts sold − mechanic payments − shop expenses. */
function profit_figures(string $from, string $to): array
{
    $sales = row(
        "SELECT COALESCE(SUM(ii.taxable), 0) AS taxable,
                COALESCE(SUM(CASE WHEN ii.item_type = 'part' THEN ii.taxable END), 0) AS parts_sales,
                COALESCE(SUM(CASE WHEN ii.item_type = 'labour' THEN ii.taxable END), 0) AS labour_sales,
                COALESCE(SUM(CASE WHEN ii.item_type = 'part' THEN ii.qty * ii.unit_cost END), 0) AS parts_cost
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
         WHERE i.status = 'final' AND i.invoice_date BETWEEN ? AND ?",
        [$from, $to]
    );
    // Returns in the range take their value back off sales; parts put back in stock take their cost back too.
    $ret = row(
        "SELECT COALESCE(SUM(ri.taxable), 0) AS taxable,
                COALESCE(SUM(CASE WHEN ii.item_type = 'part' THEN ri.taxable END), 0) AS parts_sales,
                COALESCE(SUM(CASE WHEN ii.item_type = 'labour' THEN ri.taxable END), 0) AS labour_sales,
                COALESCE(SUM(CASE WHEN ii.item_type = 'part' AND ri.restock = 1 THEN ri.qty * ri.unit_cost END), 0) AS parts_cost
         FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id JOIN invoice_items ii ON ii.id = ri.invoice_item_id
         WHERE r.return_date BETWEEN ? AND ?",
        [$from, $to]
    );
    foreach (['taxable', 'parts_sales', 'labour_sales', 'parts_cost'] as $k) {
        $sales[$k] = (float) $sales[$k] - (float) $ret[$k];
    }
    $mech = (float) val('SELECT COALESCE(SUM(amount), 0) FROM mechanic_payments WHERE work_date BETWEEN ? AND ?', [$from, $to]);
    $out = [
        'sales' => r2((float) $sales['taxable']),
        'parts_sales' => r2((float) $sales['parts_sales']),
        'labour_sales' => r2((float) $sales['labour_sales']),
        'parts_cost' => r2((float) $sales['parts_cost']),
        'mechanic_payments' => r2($mech),
        'expenses' => r2((float) val('SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE spent_on BETWEEN ? AND ?', [$from, $to])),
    ];
    $out['gross_margin'] = r2($out['sales'] - $out['parts_cost']);
    $out['profit'] = r2($out['sales'] - $out['parts_cost'] - $out['mechanic_payments'] - $out['expenses']);
    return $out;
}

function report_sales(): array
{
    [$from, $to] = report_range();
    $rows = rows(
        "SELECT i.invoice_date AS date, i.invoice_no, i.inv_type AS type, COALESCE(c.name, i.cust_name) AS customer, i.cust_gstin AS gstin,
                i.taxable_total AS taxable, i.cgst, i.sgst, i.igst, i.round_off, i.grand_total AS total, i.paid_total AS paid, i.balance
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
         WHERE i.status = 'final' AND i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date, i.invoice_no",
        [$from, $to]
    );
    // Returns (credit notes) as minus rows on the day they happened.
    $returns = rows(
        "SELECT r.return_date AS date, r.return_no AS invoice_no, 'return' AS type, COALESCE(c.name, i.cust_name) AS customer, i.cust_gstin AS gstin,
                -r.taxable_total AS taxable, -r.cgst AS cgst, -r.sgst AS sgst, -r.igst AS igst, -r.round_off AS round_off, -r.total AS total, -r.refund_amount AS paid, 0 AS balance
         FROM sale_returns r JOIN invoices i ON i.id = r.invoice_id LEFT JOIN customers c ON c.id = r.customer_id
         WHERE r.return_date BETWEEN ? AND ?",
        [$from, $to]
    );
    if ($returns) {
        $rows = array_merge($rows, $returns);
        usort($rows, static fn ($a, $b) => [$a['date'], $a['type'] === 'return', $a['invoice_no']] <=> [$b['date'], $b['type'] === 'return', $b['invoice_no']]);
    }
    return report_spec('sales', ['date' => 'Date', 'invoice_no' => 'Invoice no', 'type' => 'Type', 'customer' => 'Customer', 'gstin' => 'GSTIN', 'taxable' => 'Taxable', 'cgst' => 'CGST', 'sgst' => 'SGST', 'igst' => 'IGST', 'round_off' => 'Round off', 'total' => 'Total', 'paid' => 'Paid', 'balance' => 'Balance'],
        $rows, sum_cols($rows, ['taxable', 'cgst', 'sgst', 'igst', 'round_off', 'total', 'paid', 'balance']));
}

route('GET', '/reports/sales', fn () => report_send(report_sales()), ['perm' => 'reports', 'also' => 'see_money']);

function report_purchases(): array
{
    [$from, $to] = report_range();
    $rows = rows(
        "SELECT p.bill_date AS date, p.bill_no, s.name AS supplier, s.gstin, p.taxable_total AS taxable, p.cgst, p.sgst, p.igst,
                p.other_charges, p.round_off, p.total, p.payment_mode AS mode
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status <> 'cancelled' AND p.bill_date BETWEEN ? AND ? ORDER BY p.bill_date, p.id",
        [$from, $to]
    );
    return report_spec('purchases', ['date' => 'Date', 'bill_no' => 'Bill no', 'supplier' => 'Supplier', 'gstin' => 'GSTIN', 'taxable' => 'Taxable', 'cgst' => 'CGST', 'sgst' => 'SGST', 'igst' => 'IGST', 'other_charges' => 'Other', 'round_off' => 'Round off', 'total' => 'Total', 'mode' => 'Payment'],
        $rows, sum_cols($rows, ['taxable', 'cgst', 'sgst', 'igst', 'other_charges', 'round_off', 'total']));
}

route('GET', '/reports/purchases', fn () => report_send(report_purchases()), ['perm' => 'reports', 'also' => 'purchases']);

/* Stock valuation at net (weighted-average) cost, as of now. */
function report_stock(): array
{
    $params = [];
    $w = 'p.active = 1 AND p.current_stock <> 0';
    if ($loc = qp_int('location')) {
        $w .= ' AND p.location_id = ?';
        $params[] = $loc;
    }
    $rows = rows(
        "SELECT p.part_no, p.name_en AS name, c.name_en AS category, l.name_en AS location, p.rack, p.current_stock AS stock, p.unit,
                ROUND(p.avg_cost, 2) AS avg_cost, ROUND(p.current_stock * p.avg_cost, 2) AS value, p.selling_price AS mrp,
                ROUND(p.current_stock * p.selling_price, 2) AS mrp_value
         FROM parts p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN storage_locations l ON l.id = p.location_id
         WHERE $w ORDER BY l.sort_order, p.rack, p.part_no",
        $params
    );
    return report_spec('stock', ['part_no' => 'Part no', 'name' => 'Name', 'category' => 'Category', 'location' => 'Location', 'rack' => 'Rack', 'stock' => 'Stock', 'unit' => 'Unit', 'avg_cost' => 'Net cost', 'value' => 'Value', 'mrp' => 'MRP', 'mrp_value' => 'Value at MRP'],
        $rows, sum_cols($rows, ['value', 'mrp_value']));
}

route('GET', '/reports/stock', fn () => report_send(report_stock()), ['perm' => 'reports', 'also' => 'see_costs']);

function report_profit(): array
{
    [$from, $to] = report_range();
    $f = profit_figures($from, $to);
    // Month by month inside the range
    $rows = [];
    $cur = strtotime(date('Y-m-01', strtotime($from)));
    while ($cur <= strtotime($to)) {
        $mFrom = max($from, date('Y-m-01', $cur));
        $mTo = min($to, date('Y-m-t', $cur));
        $rows[] = ['month' => date('Y-m', $cur)] + profit_figures($mFrom, $mTo);
        $cur = strtotime('+1 month', $cur);
    }
    return report_spec('profit', ['month' => 'Month', 'sales' => 'Sales (taxable)', 'parts_sales' => 'Parts sales', 'labour_sales' => 'Labour sales', 'parts_cost' => 'Parts cost', 'gross_margin' => 'Gross margin', 'mechanic_payments' => 'Mechanic payments', 'expenses' => 'Expenses', 'profit' => 'Profit'],
        $rows, $f, ['summary' => $f]);
}

route('GET', '/reports/profit', fn () => report_send(report_profit()), ['perm' => 'reports', 'also' => 'see_money']);

/* Customer dues by age of the unpaid bills; dues older than any bill (opening / unallocated) are "old". */
function report_dues(): array
{
    $today = today();
    $rows = [];
    foreach (rows("SELECT c.id, c.name, c.phone, ROUND(" . CUSTOMER_BALANCE_SQL . ", 2) AS balance FROM customers c HAVING balance > 0.004 ORDER BY balance DESC") as $c) {
        $b = ['d0_30' => 0.0, 'd31_60' => 0.0, 'd61_90' => 0.0, 'd90' => 0.0];
        $inBills = 0.0;
        foreach (rows("SELECT invoice_date, balance FROM invoices WHERE customer_id = ? AND status = 'final' AND balance > 0", [$c['id']]) as $i) {
            $age = (strtotime($today) - strtotime($i['invoice_date'])) / 86400;
            $k = $age <= 30 ? 'd0_30' : ($age <= 60 ? 'd31_60' : ($age <= 90 ? 'd61_90' : 'd90'));
            $b[$k] += (float) $i['balance'];
            $inBills += (float) $i['balance'];
        }
        $rows[] = ['customer' => $c['name'], 'phone' => $c['phone'], 'customer_id' => (int) $c['id']] + array_map('r2', $b) + ['old' => r2(max(0, (float) $c['balance'] - $inBills)), 'total' => (float) $c['balance']];
    }
    return report_spec('dues', ['customer' => 'Customer', 'phone' => 'Phone', 'd0_30' => '0–30 days', 'd31_60' => '31–60 days', 'd61_90' => '61–90 days', 'd90' => 'Over 90 days', 'old' => 'Old dues', 'total' => 'Total'],
        $rows, sum_cols($rows, ['d0_30', 'd31_60', 'd61_90', 'd90', 'old', 'total']));
}

route('GET', '/reports/dues', fn () => report_send(report_dues()), ['perm' => 'reports', 'also' => 'see_money']);

function report_payables(): array
{
    $rows = rows(
        "SELECT s.id AS supplier_id, s.name AS supplier, s.phone, ROUND(" . SUPPLIER_BALANCE_SQL . ", 2) AS balance,
                (SELECT MAX(bill_date) FROM purchases p WHERE p.supplier_id = s.id AND p.status <> 'cancelled') AS last_bill,
                (SELECT MAX(paid_on) FROM supplier_payments sp WHERE sp.supplier_id = s.id) AS last_payment
         FROM suppliers s HAVING balance > 0.004 ORDER BY balance DESC"
    );
    return report_spec('payables', ['supplier' => 'Supplier', 'phone' => 'Phone', 'last_bill' => 'Last bill', 'last_payment' => 'Last payment', 'balance' => 'Payable'], $rows, sum_cols($rows, ['balance']));
}

route('GET', '/reports/payables', fn () => report_send(report_payables()), ['perm' => 'reports', 'also' => 'purchases']);

/* Monthly GST summary: output tax (sales) − input tax (purchases), by rate and head. */
function report_gst(): array
{
    [$from, $to] = report_range();
    $out = rows(
        "SELECT ii.gst_rate AS rate, SUM(ii.taxable) AS taxable, SUM(ii.cgst) AS cgst, SUM(ii.sgst) AS sgst, SUM(ii.igst) AS igst
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'final' AND i.invoice_date BETWEEN ? AND ? GROUP BY ii.gst_rate",
        [$from, $to]
    );
    // Returns lower the output tax of the month they happen in.
    $back = rows(
        "SELECT ii.gst_rate AS rate, SUM(ri.taxable) AS taxable, SUM(ri.cgst) AS cgst, SUM(ri.sgst) AS sgst, SUM(ri.igst) AS igst
         FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id JOIN invoice_items ii ON ii.id = ri.invoice_item_id
         WHERE r.return_date BETWEEN ? AND ? GROUP BY ii.gst_rate",
        [$from, $to]
    );
    foreach ($back as $b) {
        $found = false;
        foreach ($out as &$o) {
            if (abs((float) $o['rate'] - (float) $b['rate']) < 0.001) {
                foreach (['taxable', 'cgst', 'sgst', 'igst'] as $f) {
                    $o[$f] = (float) $o[$f] - (float) $b[$f];
                }
                $found = true;
            }
        }
        unset($o);
        if (!$found) {
            $out[] = ['rate' => $b['rate'], 'taxable' => -(float) $b['taxable'], 'cgst' => -(float) $b['cgst'], 'sgst' => -(float) $b['sgst'], 'igst' => -(float) $b['igst']];
        }
    }
    $in = rows(
        "SELECT pi.gst_rate AS rate, SUM(pi.taxable) AS taxable, SUM(pi.cgst) AS cgst, SUM(pi.sgst) AS sgst, SUM(pi.igst) AS igst
         FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id WHERE p.status <> 'cancelled' AND p.bill_date BETWEEN ? AND ? GROUP BY pi.gst_rate",
        [$from, $to]
    );
    $rates = [];
    foreach ([['out', $out], ['in', $in]] as [$side, $list]) {
        foreach ($list as $r) {
            $k = number_format((float) $r['rate'], 2, '.', '');
            $rates[$k] ??= ['rate' => (float) $r['rate'], 'out_taxable' => 0.0, 'out_cgst' => 0.0, 'out_sgst' => 0.0, 'out_igst' => 0.0, 'in_taxable' => 0.0, 'in_cgst' => 0.0, 'in_sgst' => 0.0, 'in_igst' => 0.0];
            foreach (['taxable', 'cgst', 'sgst', 'igst'] as $f) {
                $rates[$k]["{$side}_$f"] = r2((float) $r[$f]);
            }
        }
    }
    ksort($rates, SORT_NUMERIC);
    $rows = array_values($rates);
    foreach ($rows as &$r) {
        $r['net_cgst'] = r2($r['out_cgst'] - $r['in_cgst']);
        $r['net_sgst'] = r2($r['out_sgst'] - $r['in_sgst']);
        $r['net_igst'] = r2($r['out_igst'] - $r['in_igst']);
        $r['net_total'] = r2($r['net_cgst'] + $r['net_sgst'] + $r['net_igst']);
    }
    unset($r);
    $keys = ['out_taxable', 'out_cgst', 'out_sgst', 'out_igst', 'in_taxable', 'in_cgst', 'in_sgst', 'in_igst', 'net_cgst', 'net_sgst', 'net_igst', 'net_total'];
    return report_spec('gst', ['rate' => 'GST %', 'out_taxable' => 'Sales taxable', 'out_cgst' => 'Output CGST', 'out_sgst' => 'Output SGST', 'out_igst' => 'Output IGST',
        'in_taxable' => 'Purchase taxable', 'in_cgst' => 'Input CGST', 'in_sgst' => 'Input SGST', 'in_igst' => 'Input IGST', 'net_cgst' => 'Net CGST', 'net_sgst' => 'Net SGST', 'net_igst' => 'Net IGST', 'net_total' => 'Net GST payable'],
        $rows, sum_cols($rows, $keys));
}

route('GET', '/reports/gst', fn () => report_send(report_gst()), ['perm' => 'reports', 'also' => 'see_money']);

function report_mechanics(): array
{
    [$from, $to] = report_range();
    $work = mechanic_work($from, $to);
    $paid = mechanic_paid($from, $to);
    $rows = [];
    foreach (rows("SELECT id, name FROM users WHERE role = 'mechanic' ORDER BY name") as $m) {
        $id = (int) $m['id'];
        $jobs = $work[$id] ?? [];
        $rows[] = [
            'mechanic' => $m['name'], 'jobs' => count($jobs),
            'labour' => r2(array_sum(array_column($jobs, 'labour'))), 'parts' => r2(array_sum(array_column($jobs, 'parts'))),
            'paid_daily' => r2($paid[$id]['daily'] ?? 0), 'paid_advance' => r2($paid[$id]['advance'] ?? 0),
        ];
    }
    return report_spec('mechanics', ['mechanic' => 'Mechanic', 'jobs' => 'Jobs billed', 'labour' => 'Labour billed', 'parts' => 'Parts fitted', 'paid_daily' => 'Paid (daily)', 'paid_advance' => 'Advances'],
        $rows, sum_cols($rows, ['jobs', 'labour', 'parts', 'paid_daily', 'paid_advance']));
}

route('GET', '/reports/mechanics', fn () => report_send(report_mechanics()), ['perm' => 'reports', 'also' => 'see_money']);
