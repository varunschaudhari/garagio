<?php
declare(strict_types=1);

/** Run a cron script with the test config; returns [exit code, output]. */
function run_cron(string $script, array $args = []): array
{
    $root = dirname(__DIR__, 2);
    $env = getenv();
    $env['GM_CONFIG'] = __DIR__ . '/../config.test.php';
    $proc = proc_open([PHP_BINARY, "$root/public_html/api/cron/$script", ...$args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $root, $env, ['bypass_shell' => true]);
    $out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return [proc_close($proc), $out];
}

test('mechanics: daily summary from today\'s job bills; owner records pay and advances', function () {
    $jid = $GLOBALS['T_JOB']; // ready again after its bill was cancelled
    $inv = status(200, post('/invoices', ['job_card_id' => $jid], 'desk'))['item'];
    status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $inv['grand_total']]]], 'desk'));
    $ramesh = uid_of('ramesh');
    eq(403, get('/mechanics/daily', 'desk')['status']);
    $d = status(200, get('/mechanics/daily?date=' . date('Y-m-d'), 'admin'));
    $r = array_values(array_filter($d['items'], static fn ($x) => $x['id'] === $ramesh))[0];
    ok($r['jobs_count'] >= 1, 'Ramesh has a billed job today');
    $labour = (float) tval("SELECT COALESCE(SUM(line_total),0) FROM invoice_items WHERE invoice_id = ? AND item_type = 'labour'", [$inv['id']]);
    ok($r['labour_billed'] >= $labour - 0.01, 'labour billed counted');
    status(200, post("/mechanics/$ramesh/payments", ['amount' => 500, 'note' => 'Today'], 'admin'));
    status(200, post("/mechanics/$ramesh/payments", ['amount' => 200, 'kind' => 'advance'], 'admin'));
    $d = status(200, get('/mechanics/daily', 'admin'));
    $r = array_values(array_filter($d['items'], static fn ($x) => $x['id'] === $ramesh))[0];
    eq(500.0, $r['paid_daily']);
    eq(200.0, $r['paid_advance']);
    $p = status(200, get("/mechanics/$ramesh/payments", 'admin'));
    eq(700.0, $p['totals']['total']);
    $s = status(200, get('/mechanics/summary', 'admin'));
    eq(700.0, array_values(array_filter($s['items'], static fn ($x) => $x['id'] === $ramesh))[0]['paid_total']);
});

test('reports (acceptance): profit = sales − parts cost − mechanic payments for the range', function () {
    $today = date('Y-m-d');
    $j = status(200, get("/reports/profit?from=$today&to=$today", 'admin'));
    $sales = (float) tval("SELECT COALESCE(SUM(ii.taxable),0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'final' AND i.invoice_date = ?", [$today]);
    $cost = (float) tval("SELECT COALESCE(SUM(ii.qty * ii.unit_cost),0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'final' AND i.invoice_date = ? AND ii.item_type = 'part'", [$today]);
    $mech = (float) tval('SELECT COALESCE(SUM(amount),0) FROM mechanic_payments WHERE work_date = ?', [$today]);
    ok($sales > 0 && $cost > 0 && $mech > 0, 'there is data to check');
    eq(round($sales, 2), $j['summary']['sales']);
    eq(round($cost, 2), $j['summary']['parts_cost']);
    eq(round($mech, 2), $j['summary']['mechanic_payments']);
    eq(round($sales - $cost - $mech, 2), $j['summary']['profit']);
    eq(403, get('/reports/profit', 'stock')['status']);
});

test('reports (acceptance): GST summary output − input matches bill and purchase totals', function () {
    $today = date('Y-m-d');
    $g = status(200, get("/reports/gst?from=$today&to=$today", 'admin'));
    $out = trows("SELECT COALESCE(SUM(cgst),0) c, COALESCE(SUM(sgst),0) s, COALESCE(SUM(igst),0) i, COALESCE(SUM(taxable_total),0) t FROM invoices WHERE status = 'final' AND invoice_date = ?", [$today])[0];
    $in = trows('SELECT COALESCE(SUM(cgst),0) c, COALESCE(SUM(sgst),0) s, COALESCE(SUM(igst),0) i, COALESCE(SUM(taxable_total),0) t FROM purchases WHERE bill_date = ?', [$today])[0];
    eq(round((float) $out['c'], 2), $g['totals']['out_cgst']);
    eq(round((float) $out['s'], 2), $g['totals']['out_sgst']);
    eq(round((float) $out['i'], 2), $g['totals']['out_igst']);
    eq(round((float) $out['t'], 2), $g['totals']['out_taxable']);
    eq(round((float) $in['c'], 2), $g['totals']['in_cgst']);
    eq(round((float) $in['i'], 2), $g['totals']['in_igst'], 'inter-state purchase IGST');
    eq(round((float) $out['c'] + (float) $out['s'] + (float) $out['i'] - (float) $in['c'] - (float) $in['s'] - (float) $in['i'], 2), $g['totals']['net_total']);
});

test('reports: sales / purchase registers, stock valuation, dues, payables; CSV export; roles', function () {
    $today = date('Y-m-d');
    $s = status(200, get("/reports/sales?from=$today&to=$today", 'admin'));
    eq((int) tval("SELECT COUNT(*) FROM invoices WHERE status = 'final' AND invoice_date = ?", [$today]), count($s['rows']));
    $csv = get("/reports/sales?from=$today&to=$today&format=csv", 'admin');
    eq(200, $csv['status']);
    ok(str_contains($csv['type'], 'text/csv'), 'CSV content type');
    ok(str_contains($csv['body'], '"Invoice no",Type,Customer'), 'CSV header');
    $st = status(200, get('/reports/stock', 'stock'));
    eq(round((float) tval('SELECT SUM(ROUND(current_stock * avg_cost, 2)) FROM parts WHERE active = 1 AND current_stock <> 0'), 2), $st['totals']['value']);
    eq(403, get('/reports/sales', 'stock')['status'], 'inventory sees stock reports only');
    status(200, get('/reports/purchases', 'stock'));
    status(200, get('/reports/payables', 'stock'));
    eq(403, get('/reports/stock', 'desk')['status']);
    $dues = status(200, get('/reports/dues', 'admin'));
    $owed = "SELECT c.opening_balance + COALESCE((SELECT SUM(i.grand_total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'final'), 0) - COALESCE((SELECT SUM(p.amount) FROM customer_payments p WHERE p.customer_id = c.id), 0) AS b FROM customers c";
    eq(round((float) tval("SELECT COALESCE(SUM(b),0) FROM ($owed) x WHERE b > 0.004"), 2), $dues['totals']['total']);
    status(200, get('/reports/mechanics', 'admin'));
});

test('reminders: service due by days, payment due; sending removes them from the list', function () {
    tdb()->prepare('UPDATE vehicles SET last_service_on = ? WHERE reg_no = ?')->execute([date('Y-m-d', strtotime('-100 days')), 'MH12AB1234']);
    $due = status(200, get('/messages/due', 'desk'));
    $svc = array_values(array_filter($due['service'], static fn ($x) => $x['reg_no'] === 'MH12AB1234'));
    eq(1, count($svc), 'bike due for service');
    ok(str_starts_with($svc[0]['url'], 'https://wa.me/919000000001'));
    ok(str_contains($svc[0]['text'], '100'), 'message says how long ago');
    $amit = array_values(array_filter($due['payment'], static fn ($x) => $x['customer_id'] === 3));
    eq(1, count($amit), 'old dues → payment reminder');
    status(200, post('/messages/log', $svc[0]['log'] + ['payload' => $svc[0]['text']], 'desk'));
    $again = status(200, get('/messages/due', 'desk'));
    eq(0, count(array_filter($again['service'], static fn ($x) => $x['reg_no'] === 'MH12AB1234')), 'not listed again after sending');
    eq(403, get('/messages/due', 'ramesh')['status']);
});

test('cron (acceptance): reminders cron notifies; backup cron writes a gzipped dump', function () {
    [$code, $out] = run_cron('reminders.php');
    eq(0, $code, $out);
    ok(str_contains($out, 'reminders: service='), $out);
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE type = 'reminders_due' AND user_id = ?", [uid_of('desk')]) >= 1, 'desk told about reminders');

    [$code, $out] = run_cron('backup.php');
    eq(0, $code, $out);
    preg_match('/backup: (\S+\.sql\.gz)/', $out, $m);
    ok(isset($m[1]) && is_file($m[1]), 'backup file exists: ' . $out);
    $sql = (string) gzdecode((string) file_get_contents($m[1]));
    ok(str_contains($sql, 'CREATE TABLE `parts`') && str_contains($sql, 'INSERT INTO `parts`'), 'dump has structure and data');
    $list = status(200, get('/backups', 'admin'));
    ok(count($list['items']) >= 1);
    $dl = get('/backups/latest', 'admin');
    eq(200, $dl['status']);
    ok(str_contains($dl['type'], 'gzip'));
    eq(403, get('/backups', 'desk')['status']);
});

test('cron: refuses to run over the web', function () {
    $ch = curl_init($GLOBALS['T_BASE'] . '/api/cron/backup.php');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_exec($ch);
    eq(403, (int) curl_getinfo($ch, CURLINFO_HTTP_CODE));
    curl_close($ch);
});
