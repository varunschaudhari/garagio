<?php
declare(strict_types=1);

/* Excel downloads (decision 34): reports as real .xlsx, data exports, one workbook of everything. */

/**
 * Reads the .xlsx files the API writes (stored, uncompressed zip) without ZipArchive:
 * sheet name => rows (0-based) => column letter => ['v' => value, 's' => style id].
 */
function test_xlsx(string $body): array
{
    $files = [];
    $o = 0;
    while (substr($body, $o, 4) === "PK\x03\x04") {
        $h = unpack('vver/vflag/vmethod/vtime/vdate/Vcrc/Vcsize/Vsize/vnlen/vxlen', substr($body, $o + 4, 26));
        $name = substr($body, $o + 30, $h['nlen']);
        $files[$name] = substr($body, $o + 30 + $h['nlen'] + $h['xlen'], $h['csize']);
        $o += 30 + $h['nlen'] + $h['xlen'] + $h['csize'];
    }
    preg_match_all('/<sheet name="([^"]*)"/', $files['xl/workbook.xml'] ?? '', $m);
    $out = [];
    foreach ($m[1] as $i => $name) {
        $xml = $files['xl/worksheets/sheet' . ($i + 1) . '.xml'];
        $rows = ['_xml' => $xml];
        preg_match_all('/<row r="(\d+)">(.*?)<\/row>/s', $xml, $rm, PREG_SET_ORDER);
        foreach ($rm as [, $r, $cells]) {
            preg_match_all('/<c r="([A-Z]+)\d+"(?: s="(\d+)")?(?: t="inlineStr")?(?: s="(\d+)")?>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/s', $cells, $cm, PREG_SET_ORDER);
            foreach ($cm as $c) {
                $v = ($c[4] ?? '') !== '' ? $c[4] : html_entity_decode($c[5] ?? '', ENT_QUOTES | ENT_XML1, 'UTF-8');
                $rows[(int) $r - 1][$c[1]] = ['v' => $v, 's' => (int) (($c[2] ?? '') !== '' ? $c[2] : ($c[3] ?? 0))];
            }
        }
        $out[html_entity_decode($name, ENT_QUOTES | ENT_XML1, 'UTF-8')] = $rows;
    }
    return $out;
}

/** GET an Excel download (must be 200) and read it. */
function test_get_xlsx(string $path, string $as): array
{
    $r = get($path, $as);
    if ($r['status'] !== 200) {
        throw new AssertionFailed("$path as $as: expected HTTP 200, got {$r['status']}: " . substr($r['body'], 0, 300));
    }
    ok(str_contains($r['type'], 'spreadsheetml'), 'Excel content type');
    return test_xlsx($r['body']);
}

/** A sheet's heading texts. */
function test_heads(array $sheet): array
{
    return array_values(array_map(static fn ($c) => $c['v'], $sheet[0] ?? []));
}

test('excel: reports download as real Excel - numbers, real dates, totals row, filter buttons, frozen heading', function () {
    $r = get('/reports/sales?from=2020-01-01&to=' . date('Y-m-d') . '&format=xlsx', 'admin');
    eq(200, $r['status']);
    eq("PK\x03\x04", substr($r['body'], 0, 4), 'an Excel (zip) file');
    $x = test_xlsx($r['body']);
    ok(isset($x['Sales bills']), 'sheet named after the report');
    $s = $x['Sales bills'];
    eq(['Date', 'Invoice no', 'Type', 'Customer', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round off', 'Total', 'Paid', 'Balance'], test_heads($s));
    eq(1, $s[0]['A']['s'], 'heading style');
    eq(3, $s[1]['A']['s'], 'date cell in DD-MM-YYYY style');
    ok(is_numeric($s[1]['A']['v']) && (float) $s[1]['A']['v'] > 45000, 'a real Excel date (day number)');
    eq(2, $s[1]['K']['s'], 'money format on the total');
    $last = max(array_filter(array_keys($s), 'is_int'));
    eq('Total', $s[$last]['A']['v'], 'totals row');
    eq(4, $s[$last]['K']['s'], 'bold money on the totals row');
    ok(str_contains($s['_xml'], '<autoFilter') && str_contains($s['_xml'], 'state="frozen"'), 'filter buttons and a frozen heading row');

    $csv = get('/reports/sales?from=2020-01-01&format=csv', 'admin');
    ok(str_contains($csv['type'], 'text/csv'), 'CSV still works');
    eq(200, get('/reports/stock?format=xlsx', 'stock')['status'], 'inventory: stock report');
    eq(403, get('/reports/sales?format=xlsx', 'stock')['status'], 'inventory: no money reports');
    eq(403, get('/reports/stock?format=xlsx', 'desk')['status']);
});

test('excel: the parts list downloads in the import layout and uploads back unchanged', function () {
    $p = test_get_xlsx('/exports/parts', 'stock')['Parts'];
    eq(['Part No', 'Part Name', 'Marathi Name', 'MRP', 'Purchase Rate', 'Discount %', 'GST %', 'Available Qty', 'Min Qty', 'Category', 'Brand', 'Bike Models', 'Unit', 'HSN', 'Location', 'Rack'], test_heads($p));
    $active = (int) tval('SELECT COUNT(*) FROM parts WHERE active = 1');
    eq($active, count(array_filter(array_keys($p), 'is_int')) - 1, 'one row per part');

    // Back in through the import with "sheet qty = stock": nothing changes.
    $letters = array_keys($p[0]);
    $table = [];
    foreach (array_filter(array_keys($p), 'is_int') as $i) {
        $table[] = array_map(static fn ($l) => $p[$i][$l]['v'] ?? '', $letters);
    }
    $before = [tval('SELECT ROUND(SUM(current_stock), 2) FROM parts'), tval('SELECT COUNT(*) FROM stock_movements'), tval('SELECT COUNT(*) FROM parts')];
    $imp = status(200, post('/parts/import', ['table' => $table, 'set_stock' => true], 'stock'));
    eq(0, (int) $imp['created'], 'no new parts');
    eq([], $imp['errors']);
    eq($before, [tval('SELECT ROUND(SUM(current_stock), 2) FROM parts'), tval('SELECT COUNT(*) FROM stock_movements'), tval('SELECT COUNT(*) FROM parts')], 'stock and parts unchanged');

    eq(403, get('/exports/parts', 'desk')['status'], 'front desk cannot');
    eq(403, get('/exports/parts', 'ramesh')['status']);
});

test('excel: customers, sold and bought items, job cards, cash book - each needs its permission', function () {
    $c = test_get_xlsx('/exports/customers', 'desk')['Customers'];
    ok(in_array('Bike no', test_heads($c), true) && !in_array('Balance due', test_heads($c), true), 'front desk: bikes, no money');
    ok(in_array('Balance due', test_heads(test_get_xlsx('/exports/customers', 'admin')['Customers']), true), 'owner sees dues');
    eq(403, get('/exports/customers', 'stock')['status']);

    $items = test_get_xlsx('/exports/sale-items?from=2020-01-01', 'admin')['Sale items'];
    $n = (int) tval("SELECT COUNT(*) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'final'");
    eq($n + 2, count(array_filter(array_keys($items), 'is_int')), 'every line of every final bill, plus heading and totals');
    ok(in_array('Margin', test_heads($items), true), 'owner sees cost and margin');
    eq(403, get('/exports/sale-items', 'desk')['status']);

    eq(200, get('/exports/purchase-items?from=2020-01-01', 'stock')['status']);
    $jobs = test_get_xlsx('/exports/jobs?from=2020-01-01', 'desk')['Job cards'];
    ok(str_contains($jobs['_xml'], 'Delivered'), 'status in words');
    ok(!in_array('Bill total', test_heads($jobs), true), 'front desk: no bill money');
    eq(403, get('/exports/jobs', 'stock')['status']);

    $cash = test_get_xlsx('/exports/cash?from=2020-01-01', 'desk');
    eq(['Cash book', 'Expenses', 'Payments received', 'Supplier payments'], array_keys($cash));
    // The Excel cash book (one query per kind for the range) agrees with the cash book screen, day by day.
    $book = $cash['Cash book'];
    $days = array_filter(array_keys($book), static fn ($k) => is_int($k) && $k > 0 && ($book[$k]['A']['s'] ?? 0) === 3);
    ok(count($days) > 0, 'days with money');
    foreach ($days as $i) {
        $d = gmdate('Y-m-d', (int) round(((float) $book[$i]['A']['v'] - 25569) * 86400));
        $day = status(200, get("/cash/day?date=$d", 'desk'));
        eq([(float) $day['opening'], (float) $day['in']['customer_payments'], (float) $day['out']['expenses'], (float) $day['expected']],
            [(float) ($book[$i]['B']['v'] ?? 0), (float) ($book[$i]['C']['v'] ?? 0), (float) ($book[$i]['F']['v'] ?? 0), (float) ($book[$i]['H']['v'] ?? 0)], "cash book $d");
    }
    eq(403, get('/exports/cash', 'stock')['status']);
});

test('excel: one workbook of everything, with only the sheets the person may see', function () {
    $all = test_get_xlsx('/exports/workbook?from=2020-01-01', 'admin');
    eq(['Sales bills', 'Sale items', 'Purchases', 'Purchase items', 'Cash book', 'Expenses', 'Payments received', 'Supplier payments', 'Job cards', 'Customers',
        'Customer dues', 'Supplier payables', 'Stock value', 'Parts', 'GST summary', 'Mechanics', 'Profit'], array_keys($all));
    $inv = test_get_xlsx('/exports/workbook?from=2020-01-01', 'stock');
    eq(['Purchases', 'Purchase items', 'Supplier payables', 'Stock value', 'Parts'], array_keys($inv), 'inventory manager: stock and purchases only');
    eq(403, get('/exports/workbook', 'desk')['status']);
});
