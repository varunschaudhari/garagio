<?php
declare(strict_types=1);

/** GET/POST a site URL outside /api (public estimate pages). */
function site(string $method, string $path): array
{
    $ch = curl_init($GLOBALS['T_BASE'] . $path);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_POSTFIELDS => $method === 'POST' ? '' : null]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['status' => $code, 'body' => $out];
}

/** Multipart photo upload. */
function upload_photo(int $jobId, string $as): array
{
    $file = tempnam(sys_get_temp_dir(), 'gm') . '.png';
    file_put_contents($file, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $ch = curl_init($GLOBALS['T_BASE'] . "/api/jobs/$jobId/photos");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => ['photo' => new CURLFile($file, 'image/png', 'bike.png')],
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . token($as), 'Accept: application/json'],
        CURLOPT_RETURNTRANSFER => true,
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    @unlink($file);
    return ['status' => $code, 'json' => json_decode($out, true), 'body' => $out];
}

function uid_of(string $username): int
{
    return (int) tval('SELECT id FROM users WHERE username = ?', [$username]);
}

function stock_of(string $partNo): float
{
    return (float) tval('SELECT current_stock FROM parts WHERE part_no = ?', [$partNo]);
}

function find_item(array $request, string $partNo): array
{
    foreach ($request['items'] as $it) {
        if (($it['part_no'] ?? $it['custom_name']) === $partNo) {
            return $it;
        }
    }
    throw new AssertionFailed("line $partNo not found");
}

test('jobs: lookup finds a customer by phone and by bike number', function () {
    @unlink($GLOBALS['T_CFG']['push_outbox']);
    $j = status(200, get('/lookup?q=9000000001', 'desk'));
    eq('Rahul Jadhav (Demo)', $j['customers'][0]['name']);
    eq(2, count($j['customers'][0]['vehicles']));
    $j = status(200, get('/lookup?q=' . urlencode('mh 14 ef'), 'desk'));
    eq('Sneha Kulkarni (Demo)', $j['customers'][0]['name']);
    eq(403, get('/lookup?q=9000000001', 'ramesh')['status']);
});

test('jobs: quick-create customer and bike with the job card; one open job per bike', function () {
    $j = status(200, post('/jobs', [
        'customer' => ['name' => 'Kiran More', 'phone' => '9011122233', 'language' => 'mr'],
        'vehicle' => ['reg_no' => 'mh-12 xy 4321', 'make' => 'Honda', 'model' => 'Shine'],
        'odometer' => 15200, 'fuel_level' => '1/2', 'complaint' => 'General service, brake noise',
        'mechanic_id' => uid_of('ramesh'), 'promised_at' => date('Y-m-d') . ' 18:00',
    ], 'desk'))['item'];
    ok(str_starts_with($j['job_no'], 'JC-'), 'job number');
    eq('pending', $j['status']);
    eq('MH12XY4321', $j['reg_no']);
    $GLOBALS['T_JOB'] = (int) $j['id'];
    eq(15200, (int) tval('SELECT last_odometer FROM vehicles WHERE reg_no = ?', ['MH12XY4321']));
    $r = post('/jobs', ['customer_id' => $j['customer_id'], 'vehicle_id' => $j['vehicle_id']], 'desk');
    eq(409, $r['status']);
    eq('job_open', $r['json']['code']);
    $r = post('/jobs', ['customer' => ['name' => 'Other', 'phone' => '9011122299'], 'vehicle' => ['reg_no' => 'MH12AB1234']], 'desk');
    eq('vehicle_other_customer', $r['json']['code']);
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'job_assigned'", [uid_of('ramesh')]) >= 1, 'mechanic told about the new job');
});

test('jobs: mechanics see only their own jobs', function () {
    $id = $GLOBALS['T_JOB'];
    ok(in_array($id, array_column(status(200, get('/jobs?active=1', 'ramesh'))['items'], 'id'), true));
    ok(!in_array($id, array_column(status(200, get('/jobs?active=1', 'mahesh'))['items'], 'id'), true));
    eq(403, get("/jobs/$id", 'mahesh')['status']);
    eq(403, post('/jobs', ['customer_id' => 1, 'vehicle_id' => 1], 'ramesh')['status']);
});

test('jobs (acceptance): a job cannot start before approval; no parts requests before approval', function () {
    $id = $GLOBALS['T_JOB'];
    eq(409, post("/jobs/$id/status", ['status' => 'in_progress'], 'ramesh')['status']);
    $r = post('/requests', ['job_card_id' => $id, 'items' => [['part_id' => part_id('SP-CPR7EA9'), 'qty' => 1]]], 'ramesh');
    eq(409, $r['status']);
    eq('job_not_approved', $r['json']['code']);
});

test('jobs: mechanic adds labour from the rate list only, at the listed amount; desk can add any', function () {
    $id = $GLOBALS['T_JOB'];
    $rate = trows("SELECT id, amount FROM labour_rates WHERE name_en = 'General servicing (bike)'")[0];
    $j = status(200, post("/jobs/$id/labour", ['labour_rate_id' => $rate['id'], 'amount' => 9999], 'ramesh'))['item'];
    eq((float) $rate['amount'], (float) $j['labour'][0]['amount'], 'mechanic cannot change the amount');
    eq(422, post("/jobs/$id/labour", ['description' => 'Custom', 'amount' => 10], 'ramesh')['status']);
    $j = status(200, post("/jobs/$id/labour", ['description' => 'Brake cleaning', 'amount' => 120], 'desk'))['item'];
    eq(2, count($j['labour']));
    $lid = $j['labour'][1]['id'];
    status(200, del("/jobs/$id/labour/$lid", 'desk'));
    status(200, put("/jobs/$id", ['inspection_notes' => 'Rear brake shoe worn, chain loose'], 'ramesh'));
    eq(15200, (int) status(200, put("/jobs/$id", ['odometer' => 99999], 'ramesh'))['item']['odometer'], 'mechanic edits only inspection notes');
});

test('estimates: parts at selling price, labour editable; send gives WhatsApp link; customer approves on the public page', function () {
    $id = $GLOBALS['T_JOB'];
    $e = status(200, post("/jobs/$id/estimates", ['items' => [
        ['item_type' => 'part', 'part_id' => part_id('BS-SPL'), 'qty' => 1, 'unit_price' => 1],
        ['item_type' => 'part', 'part_id' => part_id('SP-CPR7EA9'), 'qty' => 1],
        ['item_type' => 'labour', 'labour_rate_id' => (int) tval("SELECT id FROM labour_rates WHERE name_en = 'General servicing (bike)'"), 'amount' => 300],
    ]], 'desk'))['item'];
    $bs = (float) tval("SELECT selling_price FROM parts WHERE part_no = 'BS-SPL'");
    $sp = (float) tval("SELECT selling_price FROM parts WHERE part_no = 'SP-CPR7EA9'");
    eq($bs + $sp, $e['parts_total'], 'parts at selling price');
    eq(300.0, $e['labour_total'], 'labour amount editable');
    eq(round($bs + $sp + 300), $e['grand_total']);
    eq('draft', $e['status']);
    eq(403, post("/jobs/$id/estimates", ['items' => [['item_type' => 'labour', 'description' => 'x', 'amount' => 1]]], 'ramesh')['status']);

    $s = status(200, post('/estimates/' . $e['id'] . '/send', [], 'desk'));
    ok(str_starts_with($s['url'], 'https://wa.me/919011122233?text='), 'wa.me link to the customer');
    ok(str_contains($s['text'], 'MH12XY4321'), 'message names the bike');
    ok(strpos($s['text'], 'नमस्कार') < strpos($s['text'], 'Namaskar'), 'Marathi first for a Marathi customer');
    eq('estimate_sent', $s['item']['status']);
    $token = basename(parse_url($s['link'], PHP_URL_PATH));
    ok(strlen($token) >= 40, '32-byte token');

    $page = site('GET', "/e/$token");
    eq(200, $page['status']);
    ok(str_contains($page['body'], 'MH12XY4321') && str_contains($page['body'], 'अंदाजपत्रक'), 'public page shows the bike, bilingual');
    ok(!str_contains($page['body'], '9011122233'), 'public page does not show the phone number');
    $page = site('POST', "/e/$token/approve");
    ok(str_contains($page['body'], 'धन्यवाद'), 'thank-you after approval');
    $job = status(200, get("/jobs/$id", 'desk'))['item'];
    eq('approved', $job['status']);
    eq((int) $e['id'], (int) $job['approved_estimate_id']);
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'estimate_approved'", [uid_of('desk')]) >= 1);
    ok(str_contains(site('GET', "/e/$token")['body'], 'आधीच मंजूर'), 'second visit says already approved');
    eq(404, site('GET', '/e/' . str_repeat('x', 43))['status']);
});

test('estimates: expired link cannot be approved', function () {
    $j2 = status(200, post('/jobs', ['customer_id' => 2, 'vehicle_id' => (int) tval("SELECT id FROM vehicles WHERE reg_no = 'MH14EF9012'"), 'mechanic_id' => uid_of('ramesh')], 'desk'))['item'];
    $GLOBALS['T_JOB2'] = (int) $j2['id'];
    $e = status(200, post('/jobs/' . $j2['id'] . '/estimates', ['items' => [['item_type' => 'labour', 'description' => 'Check-up', 'amount' => 200]]], 'desk'))['item'];
    $s = status(200, post('/estimates/' . $e['id'] . '/send', [], 'desk'));
    ok(strpos($s['text'], 'Namaskar') < strpos($s['text'], 'नमस्कार'), 'English first for an English customer');
    tdb()->prepare('UPDATE estimates SET expires_at = ? WHERE id = ?')->execute([date('Y-m-d H:i:s', time() - 60), $e['id']]);
    $token = basename(parse_url($s['link'], PHP_URL_PATH));
    site('POST', "/e/$token/approve");
    eq('estimate_sent', status(200, get('/jobs/' . $j2['id'], 'desk'))['item']['status']);
    // Front desk marks it approved on a call instead
    eq(422, post('/estimates/' . $e['id'] . '/approve-call', [], 'desk')['status'], 'note required');
    eq('approved', status(200, post('/estimates/' . $e['id'] . '/approve-call', ['note' => 'Customer said OK on phone'], 'desk'))['item']['status']);
});

test('requests (acceptance): ₹1,450 tyre waits for approval, ₹150 spark plug issues at once; mechanic gets a push', function () {
    $id = $GLOBALS['T_JOB'];
    status(200, post("/jobs/$id/status", ['status' => 'in_progress'], 'ramesh'));
    tdb()->prepare('UPDATE users SET push_token = ? WHERE username = ?')->execute(['ExponentPushToken[ramesh-test]', 'ramesh']);

    $plugBefore = stock_of('SP-CPR7EA9');
    $r = status(200, post('/requests', ['job_card_id' => $id, 'items' => [
        ['part_id' => part_id('TYR-9090-17'), 'qty' => 1],
        ['part_id' => part_id('SP-CPR7EA9'), 'qty' => 1],
    ]], 'ramesh'))['item'];
    $tyre = find_item($r, 'TYR-9090-17');
    $plug = find_item($r, 'SP-CPR7EA9');
    eq('needs_approval', $tyre['status'], 'tyre 1450 ≥ 1000');
    eq('requested', $plug['status'], 'spark plug 150');
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'request_new'", [uid_of('stock')]) >= 1, 'inventory told');
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'approval_needed'", [uid_of('admin')]) >= 1, 'owner asked to approve');

    $x = post("/requests/{$r['id']}/items/{$tyre['id']}/issue", [], 'stock');
    eq(409, $x['status']);
    eq('needs_approval', $x['json']['code']);
    eq(403, post("/requests/{$r['id']}/items/{$tyre['id']}/approve", [], 'ramesh')['status']);

    status(200, post("/requests/{$r['id']}/items/{$plug['id']}/issue", [], 'stock'));
    eq($plugBefore - 1, stock_of('SP-CPR7EA9'), 'stock drops on issue');
    status(200, post("/requests/{$r['id']}/items/{$tyre['id']}/approve", [], 'admin'));
    $done = status(200, post("/requests/{$r['id']}/items/{$tyre['id']}/issue", [], 'stock'))['item'];
    eq('closed', $done['status'], 'request closes when every line is done');

    $job = status(200, get("/jobs/$id", 'ramesh'))['item'];
    $issuedParts = array_values(array_filter($job['parts'], static fn ($p) => (int) $p['issued'] === 1));
    eq(2, count($issuedParts), 'issued parts land on the job');
    $planned = array_values(array_filter($job['parts'], static fn ($p) => (int) $p['issued'] === 0));
    eq(['BS-SPL'], array_column($planned, 'part_no'), 'the approved estimate part not issued yet stays planned; the issued plug used up its planned line');
    ok(!array_key_exists('unit_cost', $job['parts'][0]), 'mechanic never sees cost');
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'parts_issued'", [uid_of('ramesh')]) >= 2, 'mechanic notified');
    usleep(300000);
    $push = (string) @file_get_contents($GLOBALS['T_CFG']['push_outbox']);
    ok(str_contains($push, 'ExponentPushToken[ramesh-test]') && str_contains($push, 'parts_issued'), 'push queued for the mechanic');
    ok(ledger_balanced());
});

test('requests (acceptance): issuing more than stock is refused', function () {
    $id = $GLOBALS['T_JOB'];
    status(200, post('/parts', ['part_no' => 'ONE-LEFT', 'name_en' => 'Last piece', 'selling_price' => 100, 'opening_stock' => 1], 'admin'));
    $r = status(200, post('/requests', ['job_card_id' => $id, 'items' => [['part_id' => part_id('ONE-LEFT'), 'qty' => 3]]], 'ramesh'))['item'];
    $it = $r['items'][0];
    $x = post("/requests/{$r['id']}/items/{$it['id']}/issue", [], 'stock');
    eq(409, $x['status']);
    eq('insufficient_stock', $x['json']['code']);
    eq(1.0, stock_of('ONE-LEFT'));
    // Partial issue keeps the line open
    $r2 = status(200, post("/requests/{$r['id']}/items/{$it['id']}/issue", ['qty' => 1], 'stock'))['item'];
    eq('requested', $r2['items'][0]['status']);
    eq(1.0, $r2['items'][0]['issued_qty']);
    eq('open', $r2['status']);
    // The rest is not available → line closes, mechanic told, shows on the reorder list
    $r3 = status(200, post("/requests/{$r['id']}/items/{$it['id']}/unavailable", ['remark' => 'Out of stock at supplier too'], 'stock'))['item'];
    eq('unavailable', $r3['items'][0]['status']);
    eq('closed', $r3['status']);
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'parts_unavailable'", [uid_of('ramesh')]) >= 1);
    $reorder = status(200, get('/reorder', 'stock'));
    $found = null;
    foreach ($reorder['groups'] as $g) {
        foreach ($g['items'] as $ri) {
            if ($ri['part_no'] === 'ONE-LEFT') {
                $found = $ri;
            }
        }
    }
    ok($found && in_array('unavailable', $found['reasons'], true), 'unavailable part on the reorder list');
});

test('requests: free-text line must be linked before issue; approval rule applies after linking; reject', function () {
    $id = $GLOBALS['T_JOB'];
    $r = status(200, post('/requests', ['job_card_id' => $id, 'items' => [['custom_name' => 'Chain kit for Shine', 'qty' => 1], ['part_id' => part_id('HB-1235'), 'qty' => 1]]], 'ramesh'))['item'];
    $free = find_item($r, 'Chain kit for Shine');
    eq('link_part_first', post("/requests/{$r['id']}/items/{$free['id']}/issue", [], 'stock')['json']['code']);
    $linked = status(200, post("/requests/{$r['id']}/items/{$free['id']}/link", ['part_id' => part_id('CSK-SPL')], 'stock'))['item'];
    eq('needs_approval', find_item($linked, 'CSK-SPL')['status'], '₹1,150 kit needs approval once linked');
    $bulb = find_item($linked, 'HB-1235');
    status(200, post("/requests/{$r['id']}/items/{$bulb['id']}/reject", ['reason' => 'Bulb is fine, only fuse'], 'admin'));
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'line_rejected'", [uid_of('ramesh')]) >= 1);
    $c = status(200, post("/requests/{$r['id']}/cancel", [], 'ramesh'))['item'];
    eq('cancelled', $c['status']);
});

test('requests: queue lists open requests oldest first with rack and stock', function () {
    $id = $GLOBALS['T_JOB'];
    status(200, post('/requests', ['job_card_id' => $id, 'items' => [['part_id' => part_id('AF-SPL'), 'qty' => 1]]], 'ramesh'));
    status(200, post('/requests', ['job_card_id' => $id, 'items' => [['part_id' => part_id('CC-SPL'), 'qty' => 1]]], 'desk'));
    $q = status(200, get('/requests', 'stock'));
    ok($q['total'] >= 2);
    ok($q['items'][0]['id'] < $q['items'][1]['id'], 'oldest first');
    $line = $q['items'][0]['items'][0];
    ok(isset($line['rack'], $line['current_stock'], $line['location_en']), 'rack, stock and location on each line');
    $all = status(200, post('/requests/' . $q['items'][0]['id'] . '/issue-all', [], 'stock'));
    eq(1, count($all['issued']));
});

test('jobs: unused part returned to stock; revised estimate needed when work exceeds approval', function () {
    $id = $GLOBALS['T_JOB'];
    $job = status(200, get("/jobs/$id", 'desk'))['item'];
    ok($job['money']['revised_needed'], 'tyre + kit exceed the approved estimate');
    $tyreLine = null;
    foreach ($job['parts'] as $jp) {
        if ($jp['part_no'] === 'TYR-9090-17') {
            $tyreLine = $jp;
        }
    }
    $before = stock_of('TYR-9090-17');
    eq(403, post("/jobs/$id/return", ['job_part_id' => $tyreLine['id'], 'qty' => 1], 'ramesh')['status']);
    eq(409, post("/jobs/$id/return", ['job_part_id' => $tyreLine['id'], 'qty' => 5], 'stock')['status']);
    $after = status(200, post("/jobs/$id/return", ['job_part_id' => $tyreLine['id'], 'qty' => 1, 'reason' => 'Customer declined'], 'stock'))['item'];
    eq($before + 1, stock_of('TYR-9090-17'));
    eq('job_return', tval('SELECT mtype FROM stock_movements WHERE part_id = ? ORDER BY id DESC LIMIT 1', [part_id('TYR-9090-17')]));
    ok($after['money']['parts_total'] < $job['money']['parts_total']);
    ok(ledger_balanced());
});

test('jobs: ready notifies the desk; delivery needs a final bill; cancel needs parts returned', function () {
    $id = $GLOBALS['T_JOB'];
    eq(403, post("/jobs/$id/status", ['status' => 'ready'], 'stock')['status'], 'inventory cannot change job status');
    status(200, post("/jobs/$id/status", ['status' => 'ready'], 'ramesh'));
    ok((int) tval("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'bike_ready'", [uid_of('desk')]) >= 1);
    eq('invoice_required', post("/jobs/$id/status", ['status' => 'delivered'], 'desk')['json']['code']);
    eq('return_parts_first', post("/jobs/$id/status", ['status' => 'cancelled', 'note' => 'Customer left'], 'desk')['json']['code']);
    $wa = status(200, post("/jobs/$id/whatsapp", ['template' => 'ready'], 'desk'));
    ok(str_contains($wa['text'], 'तयार'), 'bike-ready message');
    $tl = status(200, get("/jobs/$id", 'desk'))['item']['timeline'];
    ok(count($tl) >= 5, 'timeline has events');
});

test('jobs: photos up to four, served only to logged-in users', function () {
    $id = $GLOBALS['T_JOB'];
    for ($i = 0; $i < 4; $i++) {
        eq(200, upload_photo($id, 'ramesh')['status']);
    }
    $r = upload_photo($id, 'ramesh');
    eq(409, $r['status']);
    $photos = status(200, get("/jobs/$id", 'desk'))['item']['photos'];
    eq(4, count($photos));
    $img = get("/jobs/$id/photos/" . $photos[0]['id'], 'desk');
    eq(200, $img['status']);
    ok(str_starts_with($img['type'], 'image/png'));
    eq(401, http('GET', "/jobs/$id/photos/" . $photos[0]['id'])['status']);
    status(200, del("/jobs/$id/photos/" . $photos[3]['id'], 'desk'));
});

test('notifications: unread count and mark as read', function () {
    $n = status(200, get('/notifications', 'ramesh'));
    ok($n['unread'] > 0);
    $after = status(200, post('/notifications/read', ['ids' => [$n['items'][0]['id']]], 'ramesh'));
    eq($n['unread'] - 1, $after['unread']);
    eq(0, status(200, post('/notifications/read', ['all' => true], 'ramesh'))['unread']);
});

test('customers: credit settings are owner-only and audited; duplicate phone refused', function () {
    eq(403, put('/customers/3/credit', ['is_trusted' => true, 'credit_limit' => 2000], 'desk')['status']);
    $c = status(200, put('/customers/3/credit', ['is_trusted' => true, 'credit_limit' => 2000], 'admin'))['item'];
    eq(1, $c['is_trusted']);
    eq(2000.0, $c['credit_limit']);
    ok((int) tval("SELECT COUNT(*) FROM audit_log WHERE action = 'credit_change' AND entity_id = 3") === 1);
    eq('duplicate_phone', post('/customers', ['name' => 'Dup', 'phone' => '9000000001'], 'desk')['json']['code']);
    $n = status(200, post('/customers', ['name' => 'Sachin Pawar', 'phone' => '+91 90000 00077', 'opening_balance' => 500, 'vehicles' => [['reg_no' => 'MH 10 ZZ 1111', 'make' => 'TVS', 'model' => 'Jupiter']]], 'desk'))['item'];
    eq('9000000077', $n['phone']);
    eq(0.0, $n['opening_balance'], 'front desk cannot set opening dues');
    eq('MH10ZZ1111', $n['vehicles'][0]['reg_no']);
    eq(350.0, status(200, get('/customers/3', 'desk'))['item']['balance'], 'opening dues count in the balance');
});

test('estimates: approved labour is copied onto the job once (no re-typing at billing)', function () {
    $j = status(200, post('/jobs', ['customer_id' => 3, 'vehicle_id' => (int) tval("SELECT id FROM vehicles WHERE reg_no = 'MH09GH3456'"), 'mechanic_id' => uid_of('mahesh')], 'desk'))['item'];
    $e = status(200, post('/jobs/' . $j['id'] . '/estimates', ['items' => [['item_type' => 'labour', 'description' => 'Washing', 'amount' => 100], ['item_type' => 'labour', 'description' => 'Oil change', 'amount' => 100]]], 'desk'))['item'];
    $job = status(200, post('/estimates/' . $e['id'] . '/approve-call', ['note' => 'ok'], 'desk'))['item'];
    eq(2, count($job['labour']));
    $e2 = status(200, post('/jobs/' . $j['id'] . '/estimates', ['items' => [['item_type' => 'labour', 'description' => 'Washing', 'amount' => 100], ['item_type' => 'labour', 'description' => 'Chain cleaning', 'amount' => 80]]], 'desk'))['item'];
    $job = status(200, post('/estimates/' . $e2['id'] . '/approve-call', ['note' => 'ok'], 'desk'))['item'];
    eq(3, count($job['labour']), 'no duplicate Washing line');
    status(200, post('/jobs/' . $j['id'] . '/status', ['status' => 'cancelled', 'note' => 'test cleanup'], 'desk'));
});
