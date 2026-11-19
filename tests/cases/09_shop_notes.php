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
