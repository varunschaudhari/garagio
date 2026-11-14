<?php
declare(strict_types=1);

function ledger_balanced(): bool
{
    $bad = tval(
        'SELECT COUNT(*) FROM parts p
         LEFT JOIN (SELECT part_id, SUM(qty) s FROM stock_movements GROUP BY part_id) m ON m.part_id = p.id
         WHERE ABS(p.current_stock - COALESCE(m.s, 0)) > 0.001'
    );
    return (int) $bad === 0;
}

test('inventory: seed ledger balance equals current_stock', function () {
    ok(ledger_balanced(), 'seed stock does not match ledger');
});

test('inventory: owner creates a part with Marathi name, rack and opening stock', function () {
    $j = status(200, post('/parts', [
        'part_no' => 'tst 001',
        'name_en' => 'Test brake lever',
        'name_mr' => 'टेस्ट ब्रेक लिव्हर',
        'category_id' => 2,
        'location_id' => 1,
        'rack' => 'b2',
        'selling_price' => 236,
        'last_purchase_price' => 150,
        'last_purchase_disc_pct' => 10,
        'min_stock' => 2,
        'opening_stock' => 10,
    ], 'admin'));
    $p = $j['item'];
    eq('TST001', $p['part_no']);
    eq('टेस्ट ब्रेक लिव्हर', $p['name_mr']);
    eq('B2', $p['rack']);
    eq(10.0, $p['current_stock']);
    eq(135.0, $p['avg_cost']);
    eq(18.0, $p['gst_rate'], 'default GST rate');
    $GLOBALS['T_PART'] = $p['id'];

    $l = status(200, get('/parts/' . $p['id'] . '/ledger', 'admin'));
    eq(1, $l['total']);
    eq('opening', $l['items'][0]['mtype']);
    ok($l['balanced'], 'ledger not balanced');
});

test('inventory: inventory manager can create parts; mechanic and front desk cannot', function () {
    status(200, post('/parts', ['part_no' => 'TST002', 'name_en' => 'Test grip', 'selling_price' => 120], 'stock'));
    eq(403, post('/parts', ['part_no' => 'TST003', 'name_en' => 'X', 'selling_price' => 1], 'ramesh')['status']);
    eq(403, post('/parts', ['part_no' => 'TST003', 'name_en' => 'X', 'selling_price' => 1], 'desk')['status']);
});

test('inventory: empty optional fields from a web form are accepted', function () {
    $j = status(200, post('/parts', [
        'part_no' => 'TST-EMPTY', 'name_en' => 'Form part', 'name_mr' => '', 'category_id' => '', 'brand' => '',
        'location_id' => '', 'rack' => '', 'selling_price' => 50, 'unit' => '', 'hsn' => '', 'gst_rate' => '',
        'last_purchase_price' => '', 'last_purchase_disc_pct' => '', 'min_stock' => '', 'opening_stock' => '', 'opening_cost' => '',
    ], 'admin'));
    eq(0.0, $j['item']['last_purchase_price']);
    eq(0.0, $j['item']['min_stock']);
    eq('pcs', $j['item']['unit']);
    eq(18.0, $j['item']['gst_rate']);
    status(200, put('/parts/' . $j['item']['id'], ['min_stock' => '', 'last_purchase_price' => ''], 'admin'));
    status(200, post('/locations', ['name_en' => 'Form shelf', 'name_mr' => '', 'sort_order' => ''], 'stock'));
});

test('inventory: duplicate part number → 409', function () {
    eq(409, post('/parts', ['part_no' => 'TST001', 'name_en' => 'Dup', 'selling_price' => 1], 'admin')['status']);
});

test('inventory: invalid GST rate → 422', function () {
    eq(422, post('/parts', ['part_no' => 'TST009', 'name_en' => 'Bad GST', 'selling_price' => 1, 'gst_rate' => 17], 'admin')['status']);
});

test('inventory: mechanic and front desk never see purchase price or cost', function () {
    $id = $GLOBALS['T_PART'];
    foreach (['ramesh', 'desk'] as $who) {
        $one = status(200, get("/parts/$id", $who))['item'];
        foreach (['last_purchase_price', 'last_purchase_disc_pct', 'avg_cost', 'stock_value'] as $f) {
            ok(!array_key_exists($f, $one), "$who sees $f on part detail");
        }
        eq('B2', $one['rack'], 'rack is visible');
        $list = status(200, get('/parts?q=TST001', $who))['items'][0];
        ok(!array_key_exists('last_purchase_price', $list), "$who sees purchase price in list");
        $ledger = status(200, get("/parts/$id/ledger", $who));
        ok(!array_key_exists('unit_cost', $ledger['items'][0]), "$who sees unit cost in ledger");
        ok(!array_key_exists('avg_cost', $ledger['part']), "$who sees avg cost in ledger part");
    }
    $own = status(200, get("/parts/$id", 'stock'))['item'];
    eq(150.0, $own['last_purchase_price'], 'inventory manager sees purchase price');
});

test('inventory: stock is never typed directly', function () {
    $id = $GLOBALS['T_PART'];
    status(200, put("/parts/$id", ['current_stock' => 999, 'name_en' => 'Test brake lever L'], 'admin'));
    $p = status(200, get("/parts/$id", 'admin'))['item'];
    eq(10.0, $p['current_stock']);
    eq('Test brake lever L', $p['name_en']);
});

test('inventory: adjustment posts a movement and an audit row; cannot go below zero', function () {
    $id = $GLOBALS['T_PART'];
    $j = status(200, post("/parts/$id/adjust", ['qty' => -3, 'reason' => 'Damaged'], 'stock'));
    eq(7.0, $j['item']['current_stock']);
    $r = post("/parts/$id/adjust", ['qty' => -100, 'reason' => 'Oops'], 'stock');
    eq(409, $r['status']);
    eq('insufficient_stock', $r['json']['code']);
    eq(422, post("/parts/$id/adjust", ['qty' => 5], 'stock')['status'], 'reason required');
    eq(403, post("/parts/$id/adjust", ['qty' => 1, 'reason' => 'x'], 'ramesh')['status']);
    ok((int) tval("SELECT COUNT(*) FROM audit_log WHERE action = 'stock_adjust' AND entity_id = ?", [$id]) === 1, 'audit row missing');
    ok(ledger_balanced());
});

test('inventory: stock count posts only the difference', function () {
    $id = $GLOBALS['T_PART'];
    $plug = (int) tval("SELECT id FROM parts WHERE part_no = 'SP-CPR7EA9'");
    $j = status(200, post('/stock-counts', [
        'location_id' => 1,
        'note' => 'Monthly count',
        'lines' => [
            ['part_id' => $id, 'counted' => 5],       // was 7 → -2
            ['part_id' => $plug, 'counted' => 40],    // unchanged
        ],
    ], 'stock'));
    eq(2, $j['lines_counted']);
    eq(1, $j['lines_changed']);
    eq(-2.0, $j['changes'][0]['diff']);
    eq(5.0, (float) tval('SELECT current_stock FROM parts WHERE id = ?', [$id]));
    eq('stock_count', tval('SELECT mtype FROM stock_movements WHERE part_id = ? ORDER BY id DESC LIMIT 1', [$id]));
    ok(ledger_balanced(), 'ledger out of balance after count');
    $sc = status(200, get('/stock-counts/' . $j['id'], 'admin'));
    eq(1, count($sc['item']['movements']));
});

test('inventory: low-stock filter and dashboard count', function () {
    $low = status(200, get('/parts?low=1&per_page=200', 'stock'));
    $nos = array_column($low['items'], 'part_no');
    ok(in_array('CL-SPRAY', $nos, true), 'chain lube (2 ≤ 3) should be low');
    ok(in_array('BELT-ACT', $nos, true), 'belt (0) should be low');
    ok(!in_array('SP-CPR7EA9', $nos, true), 'spark plug is not low');
    $d = status(200, get('/dashboard', 'stock'));
    eq($low['total'], $d['stock']['low_stock_count']);
    ok(isset($d['stock']['stock_value']), 'inventory sees stock value');
    ok(!isset(status(200, get('/dashboard', 'ramesh'))['stock']['stock_value']), 'mechanic must not see stock value');
});

test('inventory: search matches Marathi name, rack and part no', function () {
    eq('SP-CPR7EA9', status(200, get('/parts?q=' . urlencode('स्पार्क'), 'ramesh'))['items'][0]['part_no']);
    ok(status(200, get('/parts?q=G1', 'ramesh'))['total'] >= 3, 'rack search');
    eq('SP-CPR7EA9', status(200, get('/parts?q=sp-cpr7ea9', 'ramesh'))['items'][0]['part_no']);
});

test('inventory: QR code lookup by part number', function () {
    eq('SP-CPR7EA9', status(200, get('/parts/by-code/SP-CPR7EA9', 'ramesh'))['item']['part_no']);
    eq(404, get('/parts/by-code/NOPE', 'ramesh')['status']);
});

test('inventory: QR label sheet per part and per rack', function () {
    $r = get('/parts/labels?location=1', 'stock');
    eq(200, $r['status']);
    ok(str_contains($r['body'], 'data-code="SP-CPR7EA9"'), 'part label missing');
    ok(str_contains($r['body'], 'qrcode('), 'QR script missing');
    $r = get('/parts/labels?mode=rack&location=2', 'stock');
    ok(str_contains($r['body'], 'data-code="RACK|2|G1"'), 'rack label missing');
});

test('inventory: import upserts by part number and never overwrites stock', function () {
    $plugStock = (float) tval("SELECT current_stock FROM parts WHERE part_no = 'SP-CPR7EA9'");
    $j = status(200, post('/parts/import', ['rows' => [
        ['part_no' => 'SP-CPR7EA9', 'name_en' => 'Spark plug', 'selling_price' => 160, 'opening_stock' => 999],
        ['part_no' => 'IMP-001', 'name_en' => 'Imported lever', 'name_mr' => 'लिव्हर', 'category' => 'Brakes', 'location' => 'Shelf X', 'rack' => 'S1', 'selling_price' => 99, 'opening_stock' => 5, 'last_purchase_price' => 50],
        ['part_no' => 'IMP-002', 'selling_price' => 10],
    ]], 'stock'));
    eq(1, $j['created']);
    eq(1, $j['updated']);
    eq(1, count($j['errors']));
    eq(4, $j['errors'][0]['row']);
    eq($plugStock, (float) tval("SELECT current_stock FROM parts WHERE part_no = 'SP-CPR7EA9'"));
    eq(160.0, (float) tval("SELECT selling_price FROM parts WHERE part_no = 'SP-CPR7EA9'"));
    eq(5.0, (float) tval("SELECT current_stock FROM parts WHERE part_no = 'IMP-001'"));
    eq(2, (int) tval("SELECT category_id FROM parts WHERE part_no = 'IMP-001'"), 'category matched by name');
    ok((int) tval("SELECT COUNT(*) FROM storage_locations WHERE name_en = 'Shelf X'") === 1, 'location created');
    ok(ledger_balanced());
});

test('inventory: command palette search', function () {
    $j = status(200, get('/search?q=MH12AB', 'desk'));
    ok(in_array('vehicle', array_column($j['items'], 'type'), true), 'vehicle result');
    $j = status(200, get('/search?q=MH12AB', 'ramesh'));
    ok(!in_array('vehicle', array_column($j['items'], 'type'), true), 'mechanic should not get customers/vehicles');
});
