<?php
declare(strict_types=1);

/* What the shop asked for in its handwritten notes (Nov 2026). */

test('purchases: MRP bills - 10 × MRP 185 less 22% = 1443 with GST inside; MRP becomes the selling price; supplier contact shown', function () {
    $s = status(200, post('/suppliers', ['name' => 'Raj Sports', 'contact_person' => 'Rajesh Patil', 'phone' => '9000000333'], 'stock'))['item'];
    eq('Rajesh Patil', $s['contact_person']);
    ok(count(status(200, get('/suppliers?q=Rajesh', 'stock'))['items']) === 1, 'search by contact person');
    $part = status(200, post('/parts', ['part_no' => 'BRK-LINE', 'name_en' => 'Brake lines', 'selling_price' => 150, 'gst_rate' => 18], 'admin'))['item'];
    $line = ['part_id' => $part['id'], 'qty' => 10, 'price' => 185, 'disc_pct' => 22, 'mrp' => 185];

    $pv = status(200, post('/purchases/preview', ['supplier_id' => $s['id'], 'price_mode' => 'mrp', 'items' => [$line]], 'stock'));
    eq('mrp', $pv['price_mode']);
    eq(1443.0, $pv['lines'][0]['line_total']);
    eq(1222.88, $pv['lines'][0]['taxable']);
    eq(220.12, $pv['lines'][0]['tax_amount']);
    eq(122.2881, $pv['lines'][0]['net_cost'], 'registered: cost without GST');
    eq(1443.0, $pv['totals']['grand_total']);
    eq(0.0, $pv['totals']['round_off']);

    $b = status(200, post('/purchases', ['supplier_id' => $s['id'], 'bill_no' => 'RS-1', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit', 'price_mode' => 'mrp', 'items' => [$line]], 'stock'))['item'];
    eq('mrp', $b['price_mode']);
    eq(185.0, (float) $b['items'][0]['mrp']);
    eq('Rajesh Patil', $b['supplier_contact']);
    eq('9000000333', $b['supplier_phone']);
    eq(1443.0, (float) $b['total']);
    $p = trows('SELECT * FROM parts WHERE id = ?', [$part['id']])[0];
    eq(185.0, (float) $p['selling_price'], 'MRP becomes the selling price');
    eq(156.78, (float) $p['last_purchase_price'], 'last price kept without GST');
    eq(22.0, (float) $p['last_purchase_disc_pct']);
    eq(122.2881, round((float) $p['avg_cost'], 4));
    ok((int) tval("SELECT COUNT(*) FROM audit_log WHERE action = 'price_change' AND entity_id = ?", [$part['id']]) === 1, 'price change audited');
    eq(1443.0, status(200, get('/suppliers/' . $s['id'], 'stock'))['item']['balance']);

    // A later net bill, then cancelled: the last price falls back to the MRP bill, converted to without GST.
    $n = status(200, post('/purchases', ['supplier_id' => $s['id'], 'bill_no' => 'RS-2', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'cash', 'items' => [['part_id' => $part['id'], 'qty' => 1, 'price' => 160, 'disc_pct' => 10]]], 'stock'))['item'];
    eq('net', $n['price_mode'], 'API default stays net (older apps)');
    eq(160.0, (float) tval('SELECT last_purchase_price FROM parts WHERE id = ?', [$part['id']]));
    status(200, post('/purchases/' . $n['id'] . '/cancel', ['reason' => 'Test'], 'stock'));
    eq(156.78, (float) tval('SELECT last_purchase_price FROM parts WHERE id = ?', [$part['id']]));

    // Not registered yet: the GST is part of the cost.
    status(200, put('/settings', ['gst_registered' => false], 'admin'));
    $pv = status(200, post('/purchases/preview', ['supplier_id' => $s['id'], 'price_mode' => 'mrp', 'items' => [$line]], 'stock'));
    eq(144.3, $pv['lines'][0]['net_cost'], 'unregistered: cost with GST');
    eq(1443.0, $pv['totals']['grand_total']);
    status(200, put('/settings', ['gst_registered' => true], 'admin'));
    eq(422, post('/purchases/preview', ['supplier_id' => $s['id'], 'price_mode' => 'gross', 'items' => [$line]], 'stock')['status']);
});

test('bills: MRP and the rate after discount, on screen and on the printed bills', function () {
    status(200, post('/parts', ['part_no' => 'MRP-SALE', 'name_en' => 'Clutch cable', 'selling_price' => 200, 'gst_rate' => 18, 'opening_stock' => 5, 'opening_cost' => 100], 'admin'));
    $pid = (int) tval("SELECT id FROM parts WHERE part_no = 'MRP-SALE'");
    $pv = status(200, post('/invoices/preview', ['items' => [['part_id' => $pid, 'qty' => 2, 'disc_pct' => 10]]], 'admin'));
    eq(180.0, $pv['lines'][0]['rate'], '200 less 10%');
    $inv = status(200, post('/invoices', ['items' => [['part_id' => $pid, 'qty' => 2, 'disc_pct' => 10]]], 'admin'))['item'];
    eq(200.0, (float) $inv['items'][0]['unit_price']);
    eq(180.0, $inv['items'][0]['rate']);
    eq(360.0, (float) $inv['items'][0]['line_total']);
    $a4 = get("/invoices/{$inv['id']}/html?lang=en", 'admin')['body'];
    ok(str_contains($a4, '>MRP<'), 'A4 bill has an MRP column');
    ok(str_contains($a4, '180.00'), 'A4 bill shows the rate');
    $rc = get("/invoices/{$inv['id']}/receipt?lang=en", 'admin')['body'];
    ok(str_contains($rc, '2 × 180.00'), 'receipt: qty × rate');
    ok(str_contains($rc, 'MRP 200.00 −10%'), 'receipt: MRP and discount under the line');
    $plain = status(200, post('/invoices/preview', ['items' => [['part_id' => $pid, 'qty' => 1]]], 'desk'));
    eq(200.0, $plain['lines'][0]['rate'], 'no discount: rate = MRP');
});

test('cash book: the owner keeps the list of expense types; older apps still send the old codes', function () {
    $list = status(200, get('/expense-categories', 'desk'))['items'];
    eq(['Tea', 'Snacks', 'Water', 'Tools', 'Machinery', 'Racks'], array_slice(array_column($list, 'name_en'), 0, 6), "the shop's own list first");
    eq(403, post('/expense-categories', ['name_en' => 'Party'], 'desk')['status'], 'only the owner changes the list');
    $c = status(200, post('/expense-categories', ['name_en' => 'Cleaning', 'name_mr' => 'साफसफाई', 'sort_order' => 20], 'admin'))['item'];
    $e = status(200, post('/expenses', ['category_id' => $c['id'], 'amount' => 80, 'note' => 'Phenyl'], 'desk'))['item'];
    eq('Cleaning', $e['category_en']);
    eq('साफसफाई', $e['category_mr']);
    $old = status(200, post('/expenses', ['category' => 'fuel', 'amount' => 50], 'desk'))['item'];
    eq('Fuel', $old['category_en'], 'old app code mapped');
    eq(422, post('/expenses', ['category_id' => 99999, 'amount' => 10], 'desk')['status']);
    status(200, put('/expense-categories/' . $c['id'], ['active' => false], 'admin'));
    ok(!in_array('Cleaning', array_column(status(200, get('/expense-categories', 'desk'))['items'], 'name_en'), true), 'hidden from the pick list');
    ok(in_array('Cleaning', array_column(status(200, get('/expense-categories?all=1', 'admin'))['items'], 'name_en'), true));
    $day = status(200, get('/cash/day', 'desk'));
    ok(in_array('Cleaning', array_column($day['expenses'], 'category_en'), true), 'old entries keep their name');
    status(200, del('/expenses/' . $e['id'], 'desk'));
    status(200, del('/expenses/' . $old['id'], 'desk'));
});
