<?php
declare(strict_types=1);

/* Runs last: the go-live reset wipes every transaction the earlier files created. */

test('admin: health check is owner-only and reports schema, secret and https', function () {
    eq(403, get('/admin/health', 'desk')['status']);
    $h = status(200, get('/admin/health', 'admin'));
    $by = array_column($h['checks'], null, 'key');
    eq('ok', $by['php_version']['status']);
    eq('ok', $by['db_schema']['status']);
    eq('ok', $by['jwt_secret']['status']);
    eq('ok', $by['storage_writable']['status']);
    eq('warn', $by['app_url_https']['status'], 'test server is plain http');
    eq('warn', $by['demo_data']['status'], 'seeded demo contacts are still there');
    eq('fail', $by['shop_gstin']['status'], 'no GSTIN yet: billing would print "Tax Invoice" without one');
    eq('fail', $h['status']);
    ok(in_array($h['status'], ['ok', 'warn', 'fail'], true));
});

/** Upload a tiny image to the job card reader (the canned Gemini answer is tests/fixtures/gemini-jobcard.json). */
function scan_card(string $as, bool $withPhoto = true): array
{
    $file = tempnam(sys_get_temp_dir(), 'gm') . '.png';
    file_put_contents($file, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $ch = curl_init($GLOBALS['T_BASE'] . '/api/jobs/scan-card');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $withPhoto ? ['photo' => new CURLFile($file, 'image/png', 'card.png')] : ['x' => '1'],
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . token($as), 'Accept: application/json'],
        CURLOPT_RETURNTRANSFER => true,
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    @unlink($file);
    return ['status' => $code, 'json' => json_decode($out, true), 'body' => $out];
}

test('job card scan: photo of a paper card → cleaned fields, unclear list, no match for a new customer', function () {
    eq('1', status(200, get('/settings', 'desk'))['settings']['job_card_scan'], 'feature switched on (stub)');
    eq(403, scan_card('ramesh')['status'], 'mechanics cannot scan');
    eq('required', scan_card('desk', false)['json']['fields']['photo']);
    $r = status(200, scan_card('desk'));
    ok((bool) preg_match('/^[a-f0-9]{24}$/', $r['scan_id']), 'scan id');
    $f = $r['fields'];
    eq('सुनील पाटील', $f['customer_name']);
    eq('9822012345', $f['phone'], 'phone digits only');
    eq('MH19ZZ9999', $f['reg_no'], 'bike number normalised');
    eq(23450, $f['odometer']);
    eq('1/2', $f['fuel_level']);
    eq(uid_of('ramesh'), $f['mechanic_id'], 'mechanic matched from the list');
    eq('2026-11-15 18:00:00', $f['promised_at']);
    eq(['odometer'], $r['unclear'], 'only known field names');
    eq(null, $r['match']['customer']);
    ok(job_card_scan_file($r['scan_id']) !== null, 'card photo kept for the new job');
    $GLOBALS['T_SCAN'] = $r;
});

test('job card scan: the job made from it keeps the card photo; a second scan finds the customer and bike', function () {
    $f = $GLOBALS['T_SCAN']['fields'];
    $job = status(200, post('/jobs', [
        'customer' => ['name' => $f['customer_name'], 'phone' => $f['phone']],
        'vehicle' => ['reg_no' => $f['reg_no'], 'make' => $f['make'], 'model' => $f['model']],
        'odometer' => $f['odometer'], 'fuel_level' => $f['fuel_level'], 'complaint' => $f['complaint'],
        'mechanic_id' => $f['mechanic_id'], 'scan_id' => $GLOBALS['T_SCAN']['scan_id'],
    ], 'desk'))['item'];
    eq(1, count($job['photos']), 'card photo attached');
    eq(null, job_card_scan_file($GLOBALS['T_SCAN']['scan_id']), 'moved, not copied');
    eq(200, get("/jobs/{$job['id']}/photos/{$job['photos'][0]['id']}", 'ramesh')['status']);

    $again = status(200, scan_card('desk'));
    eq($job['customer_id'], $again['match']['customer']['id']);
    eq($job['vehicle_id'], $again['match']['vehicle_id']);
    eq($job['job_no'], $again['match']['customer']['open_job']['job_no'], 'warns about the open job');
    @unlink((string) job_card_scan_file($again['scan_id']));

    $h = array_column(status(200, get('/admin/health', 'admin'))['checks'], null, 'key');
    eq('ok', $h['job_card_scan']['status']);
});

test('stock: uncosted stock on a part with no average cost is valued at its last purchase price', function () {
    $p = status(200, post('/parts', ['part_no' => 'NOCOST-1', 'name_en' => 'No cost yet', 'selling_price' => 300, 'last_purchase_price' => 200, 'last_purchase_disc_pct' => 10], 'admin'))['item'];
    eq(0.0, (float) tval('SELECT avg_cost FROM parts WHERE id = ?', [$p['id']]));
    status(200, post("/parts/{$p['id']}/adjust", ['qty' => 4, 'reason' => 'Found on rack'], 'admin'));
    eq(180.0, (float) tval('SELECT avg_cost FROM parts WHERE id = ?', [$p['id']]));
    eq(180.0, (float) tval("SELECT unit_cost FROM stock_movements WHERE part_id = ? AND mtype = 'adjustment'", [$p['id']]));
    // Units already on hand at cost 0 keep it: only the new units take the fallback price.
    $q = status(200, post('/parts', ['part_no' => 'NOCOST-2', 'name_en' => 'Zero cost stock', 'selling_price' => 300, 'last_purchase_price' => 200, 'last_purchase_disc_pct' => 10, 'opening_stock' => 10, 'opening_cost' => 0], 'admin'))['item'];
    status(200, post("/parts/{$q['id']}/adjust", ['qty' => 5, 'reason' => 'Found more'], 'admin'));
    eq(60.0, (float) tval('SELECT avg_cost FROM parts WHERE id = ?', [$q['id']]), '(10 × 0 + 5 × 180) / 15');
    eq(900.0, (float) tval('SELECT SUM(qty * unit_cost) FROM stock_movements WHERE part_id = ?', [$q['id']]), 'ledger value = stock value');
});

test('billing: line discounts must be 0–100 % with known keys', function () {
    $pid = (int) tval('SELECT id FROM parts WHERE current_stock > 2 ORDER BY id LIMIT 1');
    $items = [['part_id' => $pid, 'qty' => 1]];
    $r = post('/invoices', ['items' => $items, 'discounts' => ['line:0' => -50]], 'desk');
    eq(422, $r['status']);
    eq('out_of_range', $r['json']['fields']['discounts.line:0']);
    eq(422, post('/invoices', ['items' => $items, 'discounts' => ['line:0' => 150]], 'admin')['status']);
    eq('invalid', post('/invoices', ['items' => $items, 'discounts' => ['oops' => 5]], 'admin')['json']['fields']['discounts.oops']);
});

test('billing: bill date cannot be in the future or before the last bill', function () {
    $pid = (int) tval('SELECT id FROM parts WHERE current_stock > 2 ORDER BY id LIMIT 1');
    $inv = status(200, post('/invoices', ['items' => [['part_id' => $pid, 'qty' => 1]]], 'desk'))['item'];
    $pay = [['mode' => 'cash', 'amount' => $inv['grand_total']]];
    $r = post("/invoices/{$inv['id']}/finalize", ['payments' => $pay, 'invoice_date' => date('Y-m-d', strtotime('+1 day'))], 'desk');
    eq('future_date', $r['json']['fields']['invoice_date']);
    $r = post("/invoices/{$inv['id']}/finalize", ['payments' => $pay, 'invoice_date' => date('Y-m-d', strtotime('-1 day'))], 'desk');
    eq('before_last_bill', $r['json']['fields']['invoice_date']);
    eq('final', status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => $pay], 'desk'))['item']['status']);
});

test('billing: money freed by a cancelled bill pays the customer\'s next credit bill', function () {
    $c = status(200, post('/customers', ['name' => 'Advance Test', 'phone' => '9011100099'], 'desk'))['item'];
    status(200, put("/customers/{$c['id']}/credit", ['is_trusted' => true, 'credit_limit' => 0], 'admin'));
    $pid = (int) tval('SELECT id FROM parts WHERE current_stock > 2 ORDER BY id LIMIT 1');
    $a = status(200, post('/invoices', ['customer_id' => $c['id'], 'items' => [['part_id' => $pid, 'qty' => 1]]], 'desk'))['item'];
    $a = status(200, post("/invoices/{$a['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $a['grand_total']]]], 'desk'))['item'];
    status(200, post("/invoices/{$a['id']}/cancel", ['reason' => 'Wrong part'], 'admin'));
    $b = status(200, post('/invoices', ['customer_id' => $c['id'], 'items' => [['part_id' => $pid, 'qty' => 1]]], 'desk'))['item'];
    $b = status(200, post("/invoices/{$b['id']}/finalize", ['payments' => []], 'desk'))['item'];
    eq('paid', $b['pay_status']);
    eq(0.0, (float) $b['balance']);
    eq(0.0, (float) status(200, get("/customers/{$c['id']}", 'desk'))['item']['balance']);
});

test('security: a mechanic sees bike history only for bikes on their own jobs, without phone or amounts', function () {
    $ramesh = uid_of('ramesh');
    $own = (int) tval('SELECT vehicle_id FROM job_cards WHERE mechanic_id = ? ORDER BY id LIMIT 1', [$ramesh]);
    $other = (int) tval('SELECT id FROM vehicles WHERE id NOT IN (SELECT vehicle_id FROM job_cards WHERE mechanic_id = ?) ORDER BY id LIMIT 1', [$ramesh]);
    ok($own > 0 && $other > 0, 'test data has both kinds of bike');
    eq('not_your_job', get("/vehicles/$other/history", 'ramesh')['json']['code']);
    $h = status(200, get("/vehicles/$own/history", 'ramesh'))['item'];
    ok(!array_key_exists('customer_phone', $h), 'no customer phone for mechanics');
    ok($h['jobs'] && !array_key_exists('invoice_total', $h['jobs'][0]), 'no bill amounts for mechanics');
    ok(array_key_exists('customer_phone', status(200, get("/vehicles/$other/history", 'desk'))['item']), 'front desk still sees the phone');
});

test('security: CSV cells that look like formulas are neutralised', function () {
    eq("'=HYPERLINK(\"x\")", csv_safe('=HYPERLINK("x")'));
    eq("'+91 hack", csv_safe('+91 hack'));
    eq("'@SUM(A1)", csv_safe('@SUM(A1)'));
    eq('-50.00', csv_safe('-50.00'), 'negative numbers stay numbers');
    eq(-50.0, csv_safe(-50.0));
    eq('Rahul', csv_safe('Rahul'));
});

test('gst: before registration bills carry no GST, use the BIL series and say "Bill"; purchase GST is cost', function () {
    status(200, put('/settings', ['gst_registered' => false], 'admin'));
    $p = trows("SELECT id, selling_price FROM parts WHERE current_stock > 2 AND gst_rate = 18 ORDER BY id LIMIT 1")[0];
    $pv = status(200, post('/invoices/preview', ['items' => [['part_id' => $p['id'], 'qty' => 1]]], 'desk'));
    eq(0.0, $pv['totals']['cgst'] + $pv['totals']['sgst'] + $pv['totals']['igst'], 'no GST charged');
    eq(round((float) $p['selling_price']), $pv['totals']['grand_total'], 'the price is the whole amount');

    $inv = status(200, post('/invoices', ['items' => [['part_id' => $p['id'], 'qty' => 1]]], 'desk'))['item'];
    $bil = status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $inv['grand_total']]]], 'desk'))['item'];
    eq('BIL/' . fy_label_test() . '/00001', $bil['invoice_no'], 'own series from 00001');
    eq(0, (int) $bil['gst_registered']);
    $rc = get("/invoices/{$bil['id']}/receipt?lang=en", 'desk')['body'];
    ok(str_contains($rc, '>Bill<') && !str_contains($rc, 'Tax Invoice') && !str_contains($rc, 'CGST'), 'receipt is a plain bill');
    ok(str_contains($rc, 'GST not charged'), 'receipt says why');
    $a4 = get("/invoices/{$bil['id']}/html?lang=en", 'desk')['body'];
    ok(!str_contains($a4, 'Tax Invoice') && !str_contains($a4, 'HSN') && str_contains($a4, 'GST not charged'), 'A4 bill has no tax columns');

    // Purchases: no input-tax credit, so the supplier's GST is part of the stock cost.
    $pp = trows("SELECT id FROM parts WHERE gst_rate = 18 ORDER BY id LIMIT 1 OFFSET 1")[0];
    $pur = status(200, post('/purchases', ['supplier_id' => 1, 'bill_no' => 'NOGST-1', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'cash',
        'items' => [['part_id' => $pp['id'], 'qty' => 1, 'price' => 100]]], 'stock'))['item'];
    eq(118.0, (float) tval("SELECT unit_cost FROM stock_movements WHERE ref_type = 'purchase' AND ref_id = ?", [$pur['id']]), '100 + 18 % GST');

    $h = array_column(status(200, get('/admin/health', 'admin'))['checks'], null, 'key');
    eq('not_registered', $h['gst_registration']['note']);
    ok(!isset($h['shop_gstin']), 'no "missing GSTIN" alarm while not registered');

    // Registration day: GST cannot be turned on without the GSTIN; with it, tax invoices start in the INV series.
    eq('gstin_required', put('/settings', ['gst_registered' => true], 'admin')['json']['fields']['shop_gstin']);
    status(200, put('/settings', ['gst_registered' => true, 'shop_gstin' => '27ABCDE1234F1Z5'], 'admin'));
    $inv2 = status(200, post('/invoices', ['items' => [['part_id' => $p['id'], 'qty' => 1]]], 'desk'))['item'];
    ok($inv2['cgst'] > 0, 'GST charged again');
    $tax = status(200, post("/invoices/{$inv2['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $inv2['grand_total']]]], 'desk'))['item'];
    ok(str_starts_with($tax['invoice_no'], 'INV/'), 'tax invoice series: ' . $tax['invoice_no']);
    ok(str_contains(get("/invoices/{$bil['id']}/receipt?lang=en", 'desk')['body'], '>Bill<'), 'old bills still reprint as plain bills');
    eq(422, put('/settings', ['shop_gstin' => ''], 'admin')['status'], 'cannot clear the GSTIN while registered');
});

test('billing: thermal receipt for phone printing (80 mm default here, 58 mm, customer language)', function () {
    $inv = trows("SELECT id, invoice_no, grand_total FROM invoices WHERE status = 'final' ORDER BY id DESC LIMIT 1")[0];
    $r = get("/invoices/{$inv['id']}/receipt?lang=en", 'desk');
    eq(200, $r['status']);
    ok(str_starts_with($r['type'], 'text/html'), 'html');
    ok(str_contains($r['body'], $inv['invoice_no']), 'invoice number');
    ok(str_contains($r['body'], 'width: 72mm'), 'the shop\'s 80 mm printer by default');
    $phone = (string) tval("SELECT svalue FROM settings WHERE skey = 'shop_phone'"); // 03_settings_users changes it
    ok(str_contains($r['body'], 'Dharangaon') && $phone !== '' && str_contains($r['body'], $phone), 'shop address and phone');
    ok(str_contains($r['body'], number_format((float) $inv['grand_total'], 2, '.', ',')), 'grand total');
    ok(str_contains($r['body'], 'HSN') && str_contains($r['body'], 'GSTIN: 27ABCDE1234F1Z5'), 'HSN per line, shop GSTIN');
    ok(!str_contains($r['body'], 'unit_cost') && !str_contains($r['body'], '#4B5563'), 'no cost, no grey ink');
    ok(str_contains(get("/invoices/{$inv['id']}/receipt?width=58", 'desk')['body'], 'width: 48mm'), '58 mm on request');
    status(200, put('/settings', ['receipt_width' => '58'], 'admin'));
    ok(str_contains(get("/invoices/{$inv['id']}/receipt", 'desk')['body'], 'width: 48mm'), '58 mm from settings');
    eq(422, put('/settings', ['receipt_width' => '100'], 'admin')['status']);
    status(200, put('/settings', ['receipt_width' => '80'], 'admin'));
    ok(str_contains(get("/invoices/{$inv['id']}/receipt?lang=mr", 'desk')['body'], 'धरणगाव'), 'Marathi address');
    eq(403, get("/invoices/{$inv['id']}/receipt", 'ramesh')['status']);
});

test('deploy: migrations run once each, in order; a failure stops; --status lists them', function () {
    $dir = sys_get_temp_dir() . '/garagio-mig-' . bin2hex(random_bytes(3));
    mkdir($dir);
    file_put_contents("$dir/001_add_table.sql", "-- a comment line\nCREATE TABLE mig_test (id INT PRIMARY KEY, note VARCHAR(20));\nINSERT INTO mig_test VALUES (1, 'a;b');\n");
    file_put_contents("$dir/002_add_row.sql", "INSERT INTO mig_test VALUES (2, 'two');\n");
    [$code, $out] = run_cron('migrate.php', ["--dir=$dir"]);
    eq(0, $code, $out);
    eq(2, (int) tval('SELECT COUNT(*) FROM mig_test'));
    eq('a;b', tval('SELECT note FROM mig_test WHERE id = 1'), 'a ";" inside a value does not split the statement');
    [$code, $out] = run_cron('migrate.php', ["--dir=$dir"]);
    ok($code === 0 && str_contains($out, '0 applied'), 'second run does nothing: ' . $out);
    file_put_contents("$dir/003_bad.sql", "THIS IS NOT SQL;\n");
    [$code, $out] = run_cron('migrate.php', ["--dir=$dir"]);
    eq(1, $code, 'a failing migration fails the deploy');
    eq(0, (int) tval("SELECT COUNT(*) FROM schema_migrations WHERE name = '003_bad.sql'"), 'not recorded');
    [, $out] = run_cron('migrate.php', ["--dir=$dir", '--status']);
    ok(str_contains($out, 'applied  001_add_table.sql') && str_contains($out, 'pending  003_bad.sql'), $out);
    tdb()->exec('DROP TABLE mig_test');
    tdb()->exec("DELETE FROM schema_migrations WHERE name IN ('001_add_table.sql', '002_add_row.sql')");
    $ch = curl_init($GLOBALS['T_BASE'] . '/api/cron/migrate.php');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_exec($ch);
    eq(403, (int) curl_getinfo($ch, CURLINFO_HTTP_CODE), 'never runs over the web');
    curl_close($ch);
});

test('deploy: the site reports the deployed commit; health shows pending migrations and the version', function () {
    $h = array_column(status(200, get('/admin/health', 'admin'))['checks'], null, 'key');
    eq('ok', $h['db_migrations']['status'], 'no migrations pending in api/migrations');
    eq('manual_upload', $h['deployed']['note']);
    eq(null, status(200, http('GET', '/public/info'))['commit'] ?? null);
    $file = dirname(__DIR__, 2) . '/public_html/api/storage/deploy.json';
    file_put_contents($file, json_encode(['commit' => 'abc1234', 'branch' => 'main', 'deployed_at' => '2026-11-14 10:00:00']));
    try {
        eq('abc1234', status(200, http('GET', '/public/info'))['commit']);
        $h = array_column(status(200, get('/admin/health', 'admin'))['checks'], null, 'key');
        eq('abc1234 · 2026-11-14 10:00:00', $h['deployed']['value']);
    } finally {
        @unlink($file);
    }
});

test('backups: a folder below public_html (subdomain in public_html/<sub>) is not "outside the web"', function () {
    $base = sys_get_temp_dir() . '/garagio-webcheck-' . bin2hex(random_bytes(3));
    foreach (['public_html/backups', 'home/backups', 'www/x/backups'] as $d) {
        @mkdir("$base/$d", 0777, true);
    }
    ok(!backup_dir_outside_web("$base/public_html/backups"), 'public_html/backups is web-reachable');
    ok(!backup_dir_outside_web("$base/www/x/backups"), 'www/... is web-reachable');
    ok(backup_dir_outside_web("$base/home/backups"), 'a plain home folder is fine');
    ok(!backup_dir_outside_web(WEB_ROOT . '/api/storage'), 'inside this site');
    // backup_dir() drops a deny-all .htaccess into the folder it uses.
    ok(is_file(backup_dir() . '/.htaccess'), 'deny-all .htaccess written');
    ok(str_contains((string) file_get_contents(backup_dir() . '/.htaccess'), 'Require all denied'));
});

test('backups: the go-live safety backup is never pruned', function () {
    $dir = sys_get_temp_dir() . '/garagio-test-backups';
    @mkdir($dir, 0777, true);
    touch("$dir/garage-golive-20200101-000000.sql.gz", strtotime('2020-01-01'));
    for ($i = 1; $i <= 16; $i++) {
        touch(sprintf('%s/garage-202001%02d-000000.sql.gz', $dir, $i + 1), strtotime('2020-01-01') + $i * 86400);
    }
    status(200, post('/backups', [], 'admin'));
    ok(is_file("$dir/garage-golive-20200101-000000.sql.gz"), 'golive backup kept');
    ok(!is_file("$dir/garage-20200102-000000.sql.gz"), 'oldest normal backup pruned');
    @unlink("$dir/garage-golive-20200101-000000.sql.gz");
});

test('admin: go-live reset is guarded (owner, RESET, password)', function () {
    $s = status(200, get('/admin/go-live', 'admin'));
    ok($s['counts']['jobs'] > 0 && $s['counts']['invoices'] > 0 && $s['counts']['customers_demo'] > 0, 'there is trial data');
    eq(403, post('/admin/go-live', ['confirm' => 'RESET', 'password' => NEW_PASSWORD], 'desk')['status']);
    $r = post('/admin/go-live', ['confirm' => 'reset', 'password' => NEW_PASSWORD], 'admin');
    eq(422, $r['status']);
    eq('invalid', $r['json']['fields']['confirm']);
    $r = post('/admin/go-live', ['confirm' => 'RESET', 'password' => 'not-my-password'], 'admin');
    eq('wrong_password', $r['json']['code']);
    ok((int) tval('SELECT COUNT(*) FROM invoices') > 0, 'nothing removed yet');
});

test('admin (acceptance): go-live keeps parts and stock, removes trial data and demo contacts, restarts numbering', function () {
    $before = trows('SELECT id, current_stock, avg_cost FROM parts WHERE current_stock > 0 ORDER BY id');
    $partCount = (int) tval('SELECT COUNT(*) FROM parts');
    $realCustomers = (int) tval("SELECT COUNT(*) FROM customers WHERE name NOT LIKE '%(Demo)'");
    ok($realCustomers > 0, 'tests created non-demo customers');

    $r = status(200, post('/admin/go-live', ['confirm' => 'RESET', 'password' => NEW_PASSWORD, 'parts' => 'keep', 'contacts' => 'demo'], 'admin'));
    ok(is_file(sys_get_temp_dir() . '/garagio-test-backups/' . $r['backup']), 'backup written first');

    foreach (['job_cards', 'invoices', 'invoice_items', 'purchases', 'customer_payments', 'supplier_payments', 'part_requests', 'estimates', 'mechanic_payments', 'notifications', 'counters', 'job_photos'] as $t) {
        eq(0, (int) tval("SELECT COUNT(*) FROM `$t`"), "$t emptied");
    }
    eq(0, (int) tval("SELECT COUNT(*) FROM customers WHERE name LIKE '%(Demo)'"));
    eq(0, (int) tval("SELECT COUNT(*) FROM suppliers WHERE name LIKE '%(Demo)'"));
    eq($realCustomers, (int) tval('SELECT COUNT(*) FROM customers'), 'other customers kept');
    eq($partCount, (int) tval('SELECT COUNT(*) FROM parts'));

    // Stock and cost unchanged; the ledger is one opening row per part that matches the balance.
    $after = array_column(trows('SELECT id, current_stock, avg_cost FROM parts WHERE current_stock > 0 ORDER BY id'), null, 'id');
    eq(count($before), count($after));
    foreach ($before as $p) {
        eq((float) $p['current_stock'], (float) $after[$p['id']]['current_stock'], "stock of part {$p['id']}");
        eq(round((float) $p['avg_cost'], 4), round((float) $after[$p['id']]['avg_cost'], 4), "avg cost of part {$p['id']}");
    }
    eq(count($before), (int) tval("SELECT COUNT(*) FROM stock_movements WHERE mtype = 'opening'"));
    eq(count($before), (int) tval('SELECT COUNT(*) FROM stock_movements'));
    eq(0, (int) tval('SELECT COUNT(*) FROM parts p WHERE p.current_stock <> COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.part_id = p.id), 0)'), 'ledger = stock');

    eq(date('Y-m-d'), status(200, get('/settings', 'admin'))['settings']['live_since']);
    eq('go_live_reset', tval('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1'));

    // Same logins still work, and numbers start again from 1.
    $j = status(200, post('/jobs', [
        'customer' => ['name' => 'First Live Customer', 'phone' => '9011100001'],
        'vehicle' => ['reg_no' => 'MH12LV0001'],
    ], 'desk'))['item'];
    eq('JC-0001', $j['job_no']);
    $pid = (int) tval('SELECT id FROM parts WHERE current_stock > 0 ORDER BY id LIMIT 1');
    $inv = status(200, post('/invoices', ['items' => [['part_id' => $pid, 'qty' => 1]], 'cust_name' => 'Walk-in', 'cust_phone' => '9011100002'], 'desk'))['item'];
    $fin = status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $inv['grand_total']]]], 'desk'))['item'];
    eq('INV/' . fy_label_test() . '/00001', $fin['invoice_no']);

    $h = array_column(status(200, get('/admin/health', 'admin'))['checks'], null, 'key');
    eq('ok', $h['demo_data']['status']);
    eq('ok', $h['live_since']['status']);
});

test('admin: go-live with parts=delete and contacts=all leaves an empty catalogue', function () {
    status(200, post('/admin/go-live', ['confirm' => 'RESET', 'password' => NEW_PASSWORD, 'parts' => 'delete', 'contacts' => 'all'], 'admin'));
    foreach (['parts', 'stock_movements', 'customers', 'vehicles', 'suppliers', 'invoices', 'job_cards'] as $t) {
        eq(0, (int) tval("SELECT COUNT(*) FROM `$t`"), "$t emptied");
    }
    ok((int) tval('SELECT COUNT(*) FROM labour_rates') > 0, 'masters kept');
    ok((int) tval('SELECT COUNT(*) FROM users') > 0, 'users kept');
});

function fy_label_test(): string
{
    $y = (int) date('Y');
    $start = (int) date('n') >= 4 ? $y : $y - 1;
    return sprintf('%02d-%02d', $start % 100, ($start + 1) % 100);
}
