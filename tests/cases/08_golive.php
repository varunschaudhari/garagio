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

test('permissions: role defaults; the owner ticks / unticks per person and it applies at once', function () {
    $list = status(200, get('/users', 'admin'));
    ok(in_array('make_bills', $list['permissions'], true) && $list['role_defaults']['front_desk']['make_bills'], 'list + defaults');
    eq(403, get('/users', 'desk')['status']);
    $desk = uid_of('desk');
    $me = status(200, get('/auth/me', 'desk'))['user']['perms'];
    ok($me['make_bills'] && !$me['give_discount'] && !$me['see_money'], 'front desk defaults');
    $pid = (int) tval('SELECT id FROM parts WHERE current_stock > 0 ORDER BY id LIMIT 1');

    // Untick "make bills" for the front desk → blocked immediately (no new login needed).
    $u = status(200, put("/users/$desk", ['permissions' => ['make_bills' => false]], 'admin'))['item'];
    eq(false, $u['perms']['make_bills']);
    eq('{"make_bills":false}', tval('SELECT permissions FROM users WHERE id = ?', [$desk]), 'only the difference is stored');
    eq(403, post('/invoices/preview', ['items' => [['part_id' => $pid, 'qty' => 1]]], 'desk')['status']);
    eq(false, status(200, get('/auth/me', 'desk'))['user']['perms']['make_bills']);

    // Tick "give discount" → the desk may now discount; tick back "make bills" → stored null again.
    status(200, put("/users/$desk", ['permissions' => ['make_bills' => true, 'give_discount' => true]], 'admin'));
    $inv = status(200, post('/invoices', ['items' => [['part_id' => $pid, 'qty' => 1, 'disc_pct' => 5]]], 'desk'))['item'];
    eq(5.0, (float) $inv['items'][0]['disc_pct']);
    status(200, del("/invoices/{$inv['id']}", 'desk'));
    status(200, put("/users/$desk", ['permissions' => ['give_discount' => false]], 'admin'));
    eq(null, tval('SELECT permissions FROM users WHERE id = ?', [$desk]), 'back to role defaults');
    eq('discount_owner_only', post('/invoices', ['items' => [['part_id' => $pid, 'qty' => 1, 'disc_pct' => 5]]], 'desk')['json']['code']);

    // Extend: a mechanic allowed to make bills.
    $mech = uid_of('mahesh');
    eq(403, post('/invoices/preview', ['items' => [['part_id' => $pid, 'qty' => 1]]], 'mahesh')['status']);
    status(200, put("/users/$mech", ['permissions' => ['make_bills' => true]], 'admin'));
    status(200, post('/invoices/preview', ['items' => [['part_id' => $pid, 'qty' => 1]]], 'mahesh'));
    status(200, put("/users/$mech", ['permissions' => ['make_bills' => false]], 'admin'));

    // Inventory manager: no purchase prices → cost fields disappear; reports need their own data tick.
    $stock = uid_of('stock');
    ok(array_key_exists('avg_cost', status(200, get("/parts/$pid", 'stock'))['item']));
    status(200, put("/users/$stock", ['permissions' => ['see_costs' => false]], 'admin'));
    ok(!array_key_exists('avg_cost', status(200, get("/parts/$pid", 'stock'))['item']), 'cost hidden');
    eq(403, get('/reports/stock', 'stock')['status'], 'stock valuation needs purchase prices');
    status(200, get('/reports/purchases', 'stock'));
    eq(403, get('/reports/sales', 'stock')['status'], 'sales report needs see_money');
    status(200, put("/users/$stock", ['permissions' => ['see_costs' => true, 'reports' => false]], 'admin'));
    eq(403, get('/reports/purchases', 'stock')['status'], 'no reports at all');
    status(200, put("/users/$stock", ['permissions' => ['reports' => true]], 'admin'));

    // Front desk allowed to see money → dashboard money + sale bills appear.
    status(200, put("/users/$desk", ['permissions' => ['see_money' => true]], 'admin'));
    $d = status(200, get('/dashboard', 'desk'));
    ok(isset($d['money'], $d['sales']) && !isset($d['purchases']), 'money for this desk user');
    status(200, put("/users/$desk", ['permissions' => ['see_money' => false]], 'admin'));

    eq(422, put('/users/' . uid_of('admin'), ['permissions' => ['make_bills' => false]], 'admin')['status'], 'owners always have everything');
    eq(422, put("/users/$desk", ['permissions' => ['fly' => true]], 'admin')['status']);
    eq(403, put("/users/$desk", ['permissions' => ['see_money' => true]], 'desk')['status']);
});

test('activity log: owner sees who did what; filters by kind, action and person', function () {
    eq(403, get('/audit', 'desk')['status']);
    $imp = status(200, get('/audit', 'admin'));
    ok($imp['total'] > 0, 'something recorded');
    ok(!in_array('job', array_column($imp['items'], 'entity'), true), 'important = no job steps');
    ok(in_array('user_update', $imp['actions'], true) && count($imp['users']) > 0, 'filter lists');
    $all = status(200, get('/audit?kind=all', 'admin'));
    ok($all['total'] > $imp['total'], 'everything includes job steps');
    $cancels = status(200, get('/audit?action=invoice_cancel', 'admin'));
    ok($cancels['total'] > 0 && count(array_unique(array_column($cancels['items'], 'action'))) === 1, 'action filter');
    $mine = status(200, get('/audit?user_id=' . uid_of('admin') . '&action=user_update', 'admin'));
    $perm = array_values(array_filter($mine['items'], static fn ($i) => isset($i['after']['perms'])))[0] ?? null;
    ok($perm !== null && is_array($perm['before']['perms']), 'permission changes are recorded with before / after');
    eq(2, count(status(200, get('/audit?per_page=2', 'admin'))['items']), 'paging');
});

test('search (Ctrl+K) follows the ticks: customers need "customers", bills need "make bills"', function () {
    $types = static fn (string $q, string $as) => array_unique(array_column(status(200, get('/search?q=' . rawurlencode($q), $as))['items'], 'type'));
    ok(in_array('customer', $types('Rahul', 'desk'), true), 'front desk finds customers');
    ok(in_array('invoice', $types('INV', 'desk'), true), 'front desk finds bills');
    $desk = uid_of('desk');
    status(200, put("/users/$desk", ['permissions' => ['customers' => false, 'make_bills' => false]], 'admin'));
    ok(!in_array('customer', $types('Rahul', 'desk'), true) && !in_array('vehicle', $types('MH12', 'desk'), true), 'no customers / bikes without the tick');
    ok(!in_array('invoice', $types('INV', 'desk'), true), 'no bills without the tick');
    status(200, put("/users/$desk", ['permissions' => ['customers' => true, 'make_bills' => true]], 'admin'));
    ok(!in_array('customer', $types('Rahul', 'ramesh'), true), 'mechanic: no customers by default');
    $m = uid_of('ramesh');
    status(200, put("/users/$m", ['permissions' => ['customers' => true]], 'admin'));
    ok(in_array('customer', $types('Rahul', 'ramesh'), true), 'mechanic given the tick finds customers');
    status(200, put("/users/$m", ['permissions' => ['customers' => false]], 'admin'));
});

test('notifications follow the ticks: parts requests reach whoever may issue parts', function () {
    $stock = uid_of('stock');
    $desk = uid_of('desk');
    $admin = uid_of('admin');
    ok(in_array($stock, user_ids_with_perm('issue_parts', true), true) && !in_array($admin, user_ids_with_perm('issue_parts', true), true), 'store person, not the owner');
    ok(in_array($admin, user_ids_with_perm('issue_parts'), true), 'approvals reach the owner too');

    // Front desk allowed to issue parts → a mechanic's new request reaches the desk as well.
    status(200, put("/users/$desk", ['permissions' => ['issue_parts' => true]], 'admin'));
    $j = status(200, post('/jobs', ['customer' => ['name' => 'Notify Test', 'phone' => '9700033344'], 'vehicle' => ['reg_no' => 'MH19NT3344'], 'mechanic_id' => uid_of('ramesh')], 'desk'))['item'];
    status(200, post("/jobs/{$j['id']}/approve", [], 'desk'));
    $before = (int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'request_new'", [$desk]);
    $pid = (int) tval('SELECT id FROM parts WHERE current_stock > 0 AND selling_price < 500 ORDER BY id LIMIT 1');
    status(200, post('/requests', ['job_card_id' => $j['id'], 'items' => [['part_id' => $pid, 'qty' => 1]]], 'ramesh'));
    eq($before + 1, (int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'request_new'", [$desk]), 'desk notified');
    eq(0, (int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'request_new' AND link = '#/requests' AND created_at >= ?", [$admin, date('Y-m-d H:i:s', time() - 5)]), 'owner not flooded');

    // Nobody but the owner may issue parts → the owner hears about requests.
    $others = array_map('intval', array_column(trows("SELECT id FROM users WHERE active = 1 AND role = 'inventory'"), 'id'));
    foreach ($others as $id) {
        status(200, put("/users/$id", ['permissions' => ['issue_parts' => false]], 'admin'));
    }
    status(200, put("/users/$desk", ['permissions' => ['issue_parts' => false]], 'admin'));
    eq([$admin], user_ids_with_perm('issue_parts', true));
    foreach ($others as $id) {
        status(200, put("/users/$id", ['permissions' => ['issue_parts' => true]], 'admin'));
    }
    eq(null, tval('SELECT permissions FROM users WHERE id = ?', [$stock]), 'back to defaults');
});

test('dashboard: sale + purchase bill totals and latest bills, by role', function () {
    $o = status(200, get('/dashboard', 'admin'));
    $sales = trows("SELECT COUNT(*) AS n, COALESCE(SUM(grand_total), 0) AS t FROM invoices WHERE status = 'final' AND invoice_date >= ?", [date('Y-m-01')])[0];
    eq((int) $sales['n'], $o['sales']['month']['count']);
    eq(round((float) $sales['t'], 2), $o['sales']['month']['total']);
    ok(count($o['sales']['latest']) > 0 && count($o['sales']['latest']) <= 8, 'latest sale bills');
    ok(isset($o['purchases']['latest'][0]['due'], $o['purchases']['latest'][0]['supplier_name']), 'latest purchase bills with due');
    eq((int) tval('SELECT COUNT(*) FROM purchases WHERE bill_date = ?', [today()]), $o['purchases']['today']['count']);
    $i = status(200, get('/dashboard', 'stock'));
    ok(isset($i['purchases']) && !isset($i['sales']), 'inventory manager: purchases only');
    $dk = status(200, get('/dashboard', 'desk'));
    ok(!isset($dk['purchases']) && !isset($dk['sales']), 'front desk: neither');
});

/** A fresh job for a new customer + bike (front desk). */
function flow_job(string $tag): array
{
    return status(200, post('/jobs', [
        'customer' => ['name' => "Flow $tag", 'phone' => '97000' . substr('00000' . crc32($tag) % 100000, -5)],
        'vehicle' => ['reg_no' => 'MH19FL' . substr('0000' . crc32($tag) % 10000, -4)],
    ], 'desk'))['item'];
}

test('job flow: Approve without an estimate; the bill can be made right away; Deliver only after the bill', function () {
    $j = flow_job('a');
    eq(true, $j['can_approve']);
    eq(403, post("/jobs/{$j['id']}/approve", [], 'ramesh')['status'], 'mechanics cannot approve');
    eq('job_not_billable', post('/invoices', ['job_card_id' => $j['id']], 'desk')['json']['code'], 'not before approval');
    $j = status(200, post("/jobs/{$j['id']}/approve", [], 'desk'))['item'];
    eq('approved', $j['status']);
    eq(false, $j['can_approve']);
    ok(!in_array('delivered', $j['allowed_status'], true) && in_array('ready', $j['allowed_status'], true), 'no Deliver before the bill');
    eq('already_approved', post("/jobs/{$j['id']}/approve", [], 'desk')['json']['code']);
    status(200, post("/jobs/{$j['id']}/labour", ['description' => 'Service', 'amount' => 300], 'desk'));
    $inv = status(200, post('/invoices', ['job_card_id' => $j['id']], 'desk'))['item'];
    status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $inv['grand_total']]]], 'desk'));
    $j = status(200, get("/jobs/{$j['id']}", 'desk'))['item'];
    ok(in_array('delivered', $j['allowed_status'], true), 'Deliver offered once billed');
    eq('delivered', status(200, post("/jobs/{$j['id']}/status", ['status' => 'delivered'], 'desk'))['item']['status']);
});

test('job flow (acceptance): approved estimate parts + labour go on the bill; stock leaves at finalise', function () {
    $pid = (int) tval('SELECT id FROM parts WHERE current_stock >= 5 AND active = 1 ORDER BY id LIMIT 1');
    $before = (float) tval('SELECT current_stock FROM parts WHERE id = ?', [$pid]);
    $j = flow_job('b');
    $e = status(200, post("/jobs/{$j['id']}/estimates", ['items' => [
        ['item_type' => 'part', 'part_id' => $pid, 'qty' => 2],
        ['item_type' => 'labour', 'description' => 'Fitting', 'amount' => 150],
        ['item_type' => 'part', 'description' => 'Local sticker', 'unit_price' => 40, 'qty' => 2],
    ]], 'desk'))['item'];
    $j = status(200, post("/jobs/{$j['id']}/approve", ['note' => 'Customer agreed at counter'], 'desk'))['item'];
    eq('approved', $j['status']);
    eq('approved', $j['estimates'][0]['status']);
    eq('desk', $j['estimates'][0]['approved_via']);
    eq(1, count($j['parts']), 'catalogue part planned');
    eq(0, (int) $j['parts'][0]['issued']);
    eq(2.0, (float) $j['parts'][0]['qty']);
    eq(2, count($j['labour']), 'labour + the typed-in part');
    $typed = array_values(array_filter($j['labour'], static fn ($l) => $l['item_kind'] === 'part'))[0];
    eq('Local sticker', $typed['description']);
    eq(2.0, (float) $typed['qty']);
    eq(40.0, (float) $typed['amount'], 'unit price kept');
    eq($before, (float) tval('SELECT current_stock FROM parts WHERE id = ?', [$pid]), 'stock untouched until billing');

    $inv = status(200, post('/invoices', ['job_card_id' => $j['id']], 'desk'))['item'];
    eq(3, count($inv['items']), 'stock part + typed-in part + labour on the draft');
    $sticker = array_values(array_filter($inv['items'], static fn ($i) => $i['description_en'] === 'Local sticker'))[0];
    ok($sticker['item_type'] === 'part' && $sticker['part_id'] === null && (float) $sticker['qty'] === 2.0, 'typed-in part billed as a part, no catalogue link');
    eq(80.0, (float) $sticker['line_total'], '2 × ₹40 (prices include GST)');
    eq((float) setting_num('default_part_gst_rate'), (float) $sticker['gst_rate'], 'parts GST rate, not labour');
    // A discount on the typed-in line works (keyed by its job line).
    $inv = status(200, put("/invoices/{$inv['id']}", ['discounts' => ['labour:' . $typed['id'] => 10]], 'admin'))['item'];
    eq(10.0, (float) array_values(array_filter($inv['items'], static fn ($i) => $i['description_en'] === 'Local sticker'))[0]['disc_pct']);
    $fin = status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $inv['grand_total']]]], 'desk'))['item'];
    eq($before - 2, (float) tval('SELECT current_stock FROM parts WHERE id = ?', [$pid]), 'stock leaves when the bill is final');
    eq(1, (int) tval('SELECT issued FROM job_parts WHERE job_card_id = ? AND part_id = ?', [$j['id'], $pid]));
    ok((float) tval("SELECT unit_cost FROM invoice_items WHERE invoice_id = ? AND item_type = 'part' AND part_id IS NOT NULL", [$inv['id']]) > 0, 'cost recorded for profit');
    eq(0, (int) tval("SELECT COUNT(*) FROM stock_movements WHERE ref_type = 'job' AND ref_id = ? AND part_id IS NULL", [$j['id']]), 'typed-in part moves no stock');
    eq('Bill ' . $fin['invoice_no'], tval("SELECT note FROM stock_movements WHERE part_id = ? ORDER BY id DESC LIMIT 1", [$pid]));
});

test('job flow: short stock stops the bill; planned parts can be removed; a revised estimate replaces the plan', function () {
    $low = status(200, post('/parts', ['part_no' => 'FLOW-1', 'name_en' => 'Flow part', 'selling_price' => 100, 'opening_stock' => 1, 'opening_cost' => 50], 'admin'))['item'];
    $pid = (int) tval('SELECT id FROM parts WHERE current_stock >= 5 AND active = 1 ORDER BY id LIMIT 1');
    $j = flow_job('c');
    status(200, post("/jobs/{$j['id']}/estimates", ['items' => [['item_type' => 'part', 'part_id' => $low['id'], 'qty' => 2], ['item_type' => 'part', 'part_id' => $pid, 'qty' => 1]]], 'desk'));
    $j = status(200, post("/jobs/{$j['id']}/approve", [], 'desk'))['item'];
    eq(2, count($j['parts']));

    // Revised estimate: 3 of the stock part, nothing else → the plan follows the newest approval.
    status(200, post("/jobs/{$j['id']}/estimates", ['items' => [['item_type' => 'part', 'part_id' => $low['id'], 'qty' => 2], ['item_type' => 'part', 'part_id' => $pid, 'qty' => 3]]], 'desk'));
    eq(true, status(200, get("/jobs/{$j['id']}", 'desk'))['item']['can_approve'], 'a pending revision can be approved');
    $j = status(200, post("/jobs/{$j['id']}/approve", [], 'desk'))['item'];
    $byPart = array_column($j['parts'], 'qty', 'part_id');
    eq(3.0, (float) $byPart[$pid]);

    $inv = status(200, post('/invoices', ['job_card_id' => $j['id']], 'desk'))['item'];
    $r = post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $inv['grand_total']]]], 'desk');
    eq('insufficient_stock', $r['json']['code'], 'only 1 in stock, 2 on the bill');
    eq('draft', status(200, get("/invoices/{$inv['id']}", 'desk'))['item']['status']);
    eq(1.0, (float) tval('SELECT current_stock FROM parts WHERE id = ?', [$low['id']]), 'nothing moved');

    $lowLine = array_values(array_filter($j['parts'], static fn ($p) => (int) $p['part_id'] === (int) $low['id']))[0];
    eq(403, del("/jobs/{$j['id']}/parts/{$lowLine['id']}", 'ramesh')['status']);
    $j = status(200, del("/jobs/{$j['id']}/parts/{$lowLine['id']}", 'desk'))['item'];
    eq([$pid], array_map('intval', array_column($j['parts'], 'part_id')), 'removed from the job');
    $inv = status(200, put("/invoices/{$inv['id']}", [], 'desk'))['item'];
    $fin = status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $inv['grand_total']]]], 'desk'))['item'];
    eq('final', $fin['status']);
    $issuedLine = array_values(array_filter(status(200, get("/jobs/{$j['id']}", 'desk'))['item']['parts'], static fn ($p) => (int) $p['issued'] === 1))[0];
    eq('job_closed', del("/jobs/{$j['id']}/parts/{$issuedLine['id']}", 'desk')['json']['code'], 'nothing changes on a billed job');
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
    $partNo = (string) tval("SELECT p.part_no FROM invoice_items ii JOIN parts p ON p.id = ii.part_id WHERE ii.invoice_id = ? LIMIT 1", [$inv['id']]);
    ok($partNo !== '' && str_contains($r['body'], 'Part no.: ' . $partNo), 'part number on the receipt');
    ok(str_contains(get("/invoices/{$inv['id']}/html?lang=en", 'desk')['body'], $partNo), 'part number on the A4 bill');
    eq($partNo, array_values(array_filter(status(200, get("/invoices/{$inv['id']}", 'desk'))['item']['items'], static fn ($i) => $i['part_id']))[0]['part_no'], 'bill lines carry the part number');
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
