<?php
declare(strict_types=1);

/*
 * Excel downloads of the shop's data (decision 34). Each export_* function returns sheets (sheet name => table,
 * see lib/xlsx.php); GET /exports/workbook puts everything the person may see into one file for a date range.
 * Headings are in English (for the CA); names and items keep their Marathi text.
 */

/** "cash" → "Cash", "upi" → "UPI"... */
function export_mode(?string $m): string
{
    return $m ? tr("pay.$m", 'en') : '';
}

/** Rows with one key mapped through a function. */
function export_map(array $rows, string $key, callable $fn): array
{
    foreach ($rows as &$r) {
        $r[$key] = $fn($r[$key] ?? null, $r);
    }
    unset($r);
    return $rows;
}

/** [from, to] as datetimes covering whole days. */
function export_day_bounds(string $from, string $to): array
{
    return [$from . ' 00:00:00', date('Y-m-d', strtotime($to . ' +1 day')) . ' 00:00:00'];
}

/** The parts list in the same layout as the import sheet: change it in Excel and upload it back. */
function export_parts(): array
{
    $cost = can('see_costs');
    $rows = rows(
        'SELECT p.part_no, p.name_en, p.name_mr, p.selling_price, p.last_purchase_price, p.last_purchase_disc_pct, p.gst_rate,
                p.current_stock, p.min_stock, c.name_en AS category, p.brand, p.compatible_models, p.unit, p.hsn, l.name_en AS location, p.rack
         FROM parts p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN storage_locations l ON l.id = p.location_id
         WHERE p.active = 1 ORDER BY p.part_no'
    );
    $cols = ['part_no' => 'Part No', 'name_en' => 'Part Name', 'name_mr' => 'Marathi Name', 'selling_price' => 'MRP'];
    if ($cost) {
        $cols += ['last_purchase_price' => 'Purchase Rate', 'last_purchase_disc_pct' => 'Discount %'];
    }
    $cols += ['gst_rate' => 'GST %', 'current_stock' => 'Available Qty', 'min_stock' => 'Min Qty', 'category' => 'Category', 'brand' => 'Brand',
        'compatible_models' => 'Bike Models', 'unit' => 'Unit', 'hsn' => 'HSN', 'location' => 'Location', 'rack' => 'Rack'];
    $types = ['selling_price' => 'money', 'last_purchase_price' => 'money', 'last_purchase_disc_pct' => 'num', 'gst_rate' => 'num', 'current_stock' => 'num', 'min_stock' => 'num'];
    return ['Parts' => ['columns' => $cols, 'rows' => $rows, 'types' => $types + array_fill_keys(['name_en', 'name_mr', 'category', 'brand', 'compatible_models', 'unit', 'location'], 'text')]];
}

/** Customers with their bikes (one row per bike; a customer without a bike gets one row). */
function export_customers(): array
{
    $money = can('see_money');
    $rows = rows(
        'SELECT c.name, c.phone, c.alt_phone, c.address, c.gstin, c.language, c.is_trusted, c.credit_limit, ROUND(' . CUSTOMER_BALANCE_SQL . ', 2) AS balance,
                DATE(c.created_at) AS since, v.reg_no, v.make, v.model, v.year, v.last_odometer, v.last_service_on, v.next_service_on, v.next_service_km
         FROM customers c LEFT JOIN vehicles v ON v.customer_id = c.id ORDER BY c.name, c.id, v.reg_no'
    );
    $rows = export_map($rows, 'language', static fn ($v) => $v === 'en' ? 'English' : 'Marathi');
    $rows = export_map($rows, 'is_trusted', static fn ($v) => (int) $v ? 'Yes' : '');
    $cols = ['name' => 'Customer', 'phone' => 'Phone', 'alt_phone' => 'Other phone', 'address' => 'Address', 'gstin' => 'GSTIN', 'language' => 'Language'];
    if ($money) {
        $cols += ['is_trusted' => 'Credit allowed', 'credit_limit' => 'Credit limit', 'balance' => 'Balance due'];
    }
    $cols += ['since' => 'Customer since', 'reg_no' => 'Bike no', 'make' => 'Make', 'model' => 'Model', 'year' => 'Year', 'last_odometer' => 'Last km',
        'last_service_on' => 'Last service', 'next_service_on' => 'Next service', 'next_service_km' => 'Next service km'];
    $types = ['credit_limit' => 'money', 'balance' => 'money', 'year' => 'num', 'last_odometer' => 'num', 'next_service_km' => 'num', 'since' => 'date',
        'last_service_on' => 'date', 'next_service_on' => 'date'];
    return ['Customers' => ['columns' => $cols, 'rows' => $rows, 'types' => $types + array_fill_keys(['name', 'address', 'language', 'is_trusted', 'make', 'model'], 'text')]];
}

/** Every line of the final sales bills: which parts and labour were sold, at what rate. */
function export_sale_items(string $from, string $to): array
{
    $cost = can('see_costs');
    $rows = rows(
        "SELECT i.invoice_date AS date, i.invoice_no, COALESCE(c.name, i.cust_name) AS customer, v.reg_no, ii.item_type, p.part_no,
                ii.description_en, ii.description_mr, ii.hsn, ii.qty, ii.unit_price, ii.disc_pct,
                CASE WHEN ii.qty > 0 THEN ROUND(ii.line_total / ii.qty, 2) END AS net_rate, ii.line_total, ii.gst_rate, ii.taxable, ii.tax_amount,
                ROUND(ii.qty * ii.unit_cost, 2) AS cost
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN job_cards j ON j.id = i.job_card_id LEFT JOIN vehicles v ON v.id = j.vehicle_id LEFT JOIN parts p ON p.id = ii.part_id
         WHERE i.status = 'final' AND i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date, i.invoice_no, ii.id",
        [$from, $to]
    );
    foreach ($rows as &$r) {
        $r['item_type'] = $r['item_type'] === 'labour' ? 'Labour' : 'Part';
        if ($r['item_type'] === 'Labour') {
            $r['cost'] = null;
        }
        $r['margin'] = $r['cost'] !== null ? r2((float) $r['taxable'] - (float) $r['cost']) : null;
    }
    unset($r);
    $cols = ['date' => 'Date', 'invoice_no' => 'Bill no', 'customer' => 'Customer', 'reg_no' => 'Bike no', 'item_type' => 'Type', 'part_no' => 'Part no',
        'description_en' => 'Item', 'description_mr' => 'Item (Marathi)', 'hsn' => 'HSN', 'qty' => 'Qty', 'unit_price' => 'MRP', 'disc_pct' => 'Disc %',
        'net_rate' => 'Rate', 'line_total' => 'Amount', 'gst_rate' => 'GST %', 'taxable' => 'Taxable', 'tax_amount' => 'GST'];
    if ($cost) {
        $cols += ['cost' => 'Parts cost', 'margin' => 'Margin'];
    }
    $types = ['date' => 'date', 'qty' => 'num', 'unit_price' => 'money', 'disc_pct' => 'num', 'net_rate' => 'money', 'line_total' => 'money', 'gst_rate' => 'num',
        'taxable' => 'money', 'tax_amount' => 'money', 'cost' => 'money', 'margin' => 'money'];
    return ['Sale items' => ['columns' => $cols, 'rows' => $rows, 'types' => $types + array_fill_keys(['customer', 'item_type', 'description_en', 'description_mr'], 'text'),
        'totals' => sum_cols($rows, ['line_total', 'taxable', 'tax_amount', 'cost', 'margin'])]];
}

/** Every line of the purchase bills (cancelled bills left out). */
function export_purchase_items(string $from, string $to): array
{
    $rows = rows(
        "SELECT p.bill_date AS date, p.bill_no, s.name AS supplier, pt.part_no, pt.name_en AS item, pi.qty, pi.mrp, pi.price, pi.disc_pct,
                pi.gst_rate, pi.taxable, pi.tax_amount, pi.line_total
         FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id JOIN suppliers s ON s.id = p.supplier_id JOIN parts pt ON pt.id = pi.part_id
         WHERE p.status <> 'cancelled' AND p.bill_date BETWEEN ? AND ? ORDER BY p.bill_date, p.id, pi.id",
        [$from, $to]
    );
    $cols = ['date' => 'Date', 'bill_no' => 'Bill no', 'supplier' => 'Supplier', 'part_no' => 'Part no', 'item' => 'Item', 'qty' => 'Qty', 'mrp' => 'MRP',
        'price' => 'Price', 'disc_pct' => 'Disc %', 'gst_rate' => 'GST %', 'taxable' => 'Taxable', 'tax_amount' => 'GST', 'line_total' => 'Amount'];
    $types = ['date' => 'date', 'qty' => 'num', 'mrp' => 'money', 'price' => 'money', 'disc_pct' => 'num', 'gst_rate' => 'num', 'taxable' => 'money',
        'tax_amount' => 'money', 'line_total' => 'money', 'supplier' => 'text', 'item' => 'text'];
    return ['Purchase items' => ['columns' => $cols, 'rows' => $rows, 'types' => $types, 'totals' => sum_cols($rows, ['taxable', 'tax_amount', 'line_total'])]];
}

/** Job cards opened in the range. */
function export_jobs(string $from, string $to): array
{
    $money = can('see_money');
    [$a, $b] = export_day_bounds($from, $to);
    $rows = rows(
        "SELECT j.job_no, j.created_at AS opened, v.reg_no, CONCAT_WS(' ', v.make, v.model) AS bike, c.name AS customer, c.phone, j.complaint,
                m.name AS mechanic, j.status, j.odometer, i.invoice_no, i.grand_total AS bill_total, j.delivered_at
         FROM job_cards j JOIN customers c ON c.id = j.customer_id JOIN vehicles v ON v.id = j.vehicle_id
         LEFT JOIN users m ON m.id = j.mechanic_id LEFT JOIN invoices i ON i.id = j.invoice_id AND i.status = 'final'
         WHERE j.created_at >= ? AND j.created_at < ? ORDER BY j.id",
        [$a, $b]
    );
    $rows = export_map($rows, 'status', static fn ($s) => tr("status.$s", 'en'));
    $cols = ['job_no' => 'Job no', 'opened' => 'Opened', 'reg_no' => 'Bike no', 'bike' => 'Bike', 'customer' => 'Customer', 'phone' => 'Phone',
        'complaint' => 'Complaint', 'mechanic' => 'Mechanic', 'status' => 'Status', 'odometer' => 'Km', 'invoice_no' => 'Bill no'];
    if ($money) {
        $cols['bill_total'] = 'Bill total';
    }
    $cols['delivered_at'] = 'Delivered';
    $types = ['opened' => 'datetime', 'delivered_at' => 'datetime', 'odometer' => 'num', 'bill_total' => 'money'];
    return ['Job cards' => ['columns' => $cols, 'rows' => $rows, 'types' => $types + array_fill_keys(['bike', 'customer', 'complaint', 'mechanic', 'status'], 'text')]];
}

/** Cash book day by day, expenses, payments received from customers and paid to suppliers. */
function export_cash(string $from, string $to): array
{
    $days = cash_days($from, $to);
    $cashCols = ['date' => 'Date', 'opening' => 'Opening cash', 'received' => 'Cash received', 'refunds' => 'Cash refunds', 'supplier_payments' => 'Paid to suppliers',
        'expenses' => 'Expenses (cash)', 'mechanic_payments' => 'Mechanic pay', 'expected' => 'Expected in drawer', 'counted' => 'Counted', 'difference' => 'Difference',
        'taken_out' => 'Taken out', 'upi' => 'UPI received', 'card' => 'Card received', 'bank' => 'Bank transfer received'];

    $expenses = rows(EXPENSE_SELECT . ' WHERE e.spent_on BETWEEN ? AND ? ORDER BY e.spent_on, e.id', [$from, $to]);
    $expenses = export_map($expenses, 'mode', static fn ($m) => export_mode($m));
    $received = rows(
        'SELECT cp.received_on AS date, COALESCE(c.name, i.cust_name) AS customer, c.phone, i.invoice_no, cp.mode, cp.amount, cp.reference, cp.note
         FROM customer_payments cp LEFT JOIN customers c ON c.id = cp.customer_id LEFT JOIN invoices i ON i.id = cp.invoice_id
         WHERE cp.received_on BETWEEN ? AND ? ORDER BY cp.received_on, cp.id',
        [$from, $to]
    );
    $received = export_map($received, 'mode', static fn ($m) => export_mode($m));
    $paid = rows(
        'SELECT sp.paid_on AS date, s.name AS supplier, p.bill_no, sp.mode, sp.amount, sp.reference, sp.note
         FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id LEFT JOIN purchases p ON p.id = sp.purchase_id
         WHERE sp.paid_on BETWEEN ? AND ? ORDER BY sp.paid_on, sp.id',
        [$from, $to]
    );
    $paid = export_map($paid, 'mode', static fn ($m) => export_mode($m));
    $text = ['customer' => 'text', 'supplier' => 'text', 'mode' => 'text', 'category_en' => 'text', 'user_name' => 'text'];
    return [
        'Cash book' => ['columns' => $cashCols, 'rows' => $days, 'types' => ['date' => 'date'] + array_fill_keys(array_slice(array_keys($cashCols), 1), 'money'),
            'totals' => sum_cols($days, ['received', 'refunds', 'supplier_payments', 'expenses', 'mechanic_payments', 'upi', 'card', 'bank'])],
        'Expenses' => ['columns' => ['spent_on' => 'Date', 'category_en' => 'Type', 'amount' => 'Amount', 'mode' => 'Paid by', 'note' => 'Note', 'user_name' => 'Entered by'],
            'rows' => $expenses, 'types' => ['spent_on' => 'date', 'amount' => 'money'] + $text, 'totals' => sum_cols($expenses, ['amount'])],
        'Payments received' => ['columns' => ['date' => 'Date', 'customer' => 'Customer', 'phone' => 'Phone', 'invoice_no' => 'Bill no', 'mode' => 'Mode', 'amount' => 'Amount', 'reference' => 'Reference', 'note' => 'Note'],
            'rows' => $received, 'types' => ['date' => 'date', 'amount' => 'money'] + $text, 'totals' => sum_cols($received, ['amount'])],
        'Supplier payments' => ['columns' => ['date' => 'Date', 'supplier' => 'Supplier', 'bill_no' => 'Bill no', 'mode' => 'Mode', 'amount' => 'Amount', 'reference' => 'Reference', 'note' => 'Note'],
            'rows' => $paid, 'types' => ['date' => 'date', 'amount' => 'money'] + $text, 'totals' => sum_cols($paid, ['amount'])],
    ];
}

/** A report from routes/reports.php as a sheet. */
function export_report(string $name): array
{
    return [REPORT_TITLES[$name] => report_for_excel(('report_' . $name)())];
}

route('GET', '/exports/parts', fn () => xlsx_response('parts-list-' . today() . '.xlsx', export_parts()), ['perm' => ['edit_parts', 'reports']]);

route('GET', '/exports/customers', fn () => xlsx_response('customers-' . today() . '.xlsx', export_customers()), ['perm' => 'customers']);

route('GET', '/exports/sale-items', function () {
    [$from, $to] = report_range();
    return xlsx_response("sale-items-$from-to-$to.xlsx", export_sale_items($from, $to));
}, ['perm' => 'reports', 'also' => 'see_money']);

route('GET', '/exports/purchase-items', function () {
    [$from, $to] = report_range();
    return xlsx_response("purchase-items-$from-to-$to.xlsx", export_purchase_items($from, $to));
}, ['perm' => 'purchases']);

route('GET', '/exports/jobs', function () {
    [$from, $to] = report_range();
    return xlsx_response("job-cards-$from-to-$to.xlsx", export_jobs($from, $to));
}, ['perm' => 'jobs']);

route('GET', '/exports/cash', function () {
    [$from, $to] = report_range();
    return xlsx_response("cash-book-$from-to-$to.xlsx", export_cash($from, $to));
}, ['perm' => 'cash_book']);

/* Everything the person may see, one sheet each, for the date range (lists such as parts and customers as of today). */
route('GET', '/exports/workbook', function () {
    [$from, $to] = report_range();
    $money = can('see_money');
    $purchases = can('purchases');
    $cash = can('cash_book');
    $s = [];
    if ($money) {
        $s += export_report('sales') + export_sale_items($from, $to);
    }
    if ($purchases) {
        $s += export_report('purchases') + export_purchase_items($from, $to);
    }
    if ($cash) {
        $s += export_cash($from, $to);
    }
    if (can('jobs')) {
        $s += export_jobs($from, $to);
    }
    if (can('customers')) {
        $s += export_customers();
    }
    if ($money) {
        $s += export_report('dues');
    }
    if ($purchases) {
        $s += export_report('payables');
    }
    if (can('see_costs')) {
        $s += export_report('stock');
    }
    $s += export_parts();
    if ($money) {
        $s += export_report('gst') + export_report('mechanics') + export_report('profit');
    }
    return xlsx_response("trimurti-garage-$from-to-$to.xlsx", $s);
}, ['perm' => 'reports']);
