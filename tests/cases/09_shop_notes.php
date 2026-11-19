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

test('jobs: next service due (date and km) - usual gap by default, front desk changes it, printed on the bill, drives the reminder', function () {
    $j = status(200, post('/jobs', ['customer' => ['name' => 'Next Service', 'phone' => '9011122377'], 'vehicle' => ['reg_no' => 'MH19NS1234', 'model' => 'Splendor'], 'odometer' => 12400, 'complaint' => 'Service'], 'desk'))['item'];
    eq(['on' => date('Y-m-d', strtotime('+90 days')), 'km' => 15400, 'custom' => false], $j['next_service'], 'job date + 90 days, km + 3000');
    eq(403, put("/jobs/{$j['id']}/next-service", ['next_service_km' => 14000], 'stock')['status']);
    eq(422, put("/jobs/{$j['id']}/next-service", ['next_service_on' => date('Y-m-d', strtotime('-1 day'))], 'desk')['status'], 'not before the job date');
    $on = date('Y-m-d', strtotime('+60 days'));
    $u = status(200, put("/jobs/{$j['id']}/next-service", ['next_service_on' => $on, 'next_service_km' => 14500], 'desk'))['item'];
    eq(['on' => $on, 'km' => 14500, 'custom' => true], $u['next_service']);
    $back = status(200, put("/jobs/{$j['id']}/next-service", ['next_service_on' => '', 'next_service_km' => ''], 'desk'))['item'];
    eq(false, $back['next_service']['custom'], 'both empty = usual gap again');

    // A billed and delivered job: the bike takes its next service; the bill prints it in the customer's language.
    $d = status(200, post('/jobs/' . flow_job('next-service')['id'] . '/approve', [], 'desk'))['item'];
    status(200, post("/jobs/{$d['id']}/labour", ['description' => 'Service', 'amount' => 300], 'desk'));
    $bill = status(200, post('/invoices', ['job_card_id' => $d['id']], 'desk'))['item'];
    status(200, post("/invoices/{$bill['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $bill['grand_total']]]], 'desk'));
    status(200, post("/jobs/{$d['id']}/status", ['status' => 'delivered'], 'desk'));
    eq(date('Y-m-d', strtotime('+90 days')), tval('SELECT next_service_on FROM vehicles WHERE id = ?', [$d['vehicle_id']]), 'delivery copies the usual gap');
    status(200, put("/jobs/{$d['id']}/next-service", ['next_service_on' => $on, 'next_service_km' => 22000], 'desk'));
    eq($on, tval('SELECT next_service_on FROM vehicles WHERE id = ?', [$d['vehicle_id']]), 'changed after delivery: the bike follows');
    $inv = status(200, get('/invoices/' . $bill['id'], 'desk'))['item'];
    eq(22000, $inv['next_service']['km']);
    $dmy = date('d-m-Y', strtotime($on));
    ok(str_contains(get('/invoices/' . $bill['id'] . '/receipt?lang=en', 'desk')['body'], "$dmy or 22000 km, whichever comes first"), 'receipt');
    $a4 = get('/invoices/' . $bill['id'] . '/html?lang=mr', 'desk')['body'];
    ok(str_contains($a4, "$dmy किंवा 22000 km, जे आधी येईल"), 'A4 bill in Marathi');

    // Reminder: a written next service date decides, not the 90-day rule.
    status(200, post("/jobs/{$j['id']}/status", ['status' => 'cancelled', 'note' => 'Test'], 'desk'));
    $due = static fn () => count(array_filter(status(200, get('/messages/due', 'desk'))['service'], static fn ($x) => $x['reg_no'] === 'MH19NS1234'));
    tdb()->prepare('UPDATE vehicles SET last_service_on = ?, next_service_on = ? WHERE reg_no = ?')->execute([date('Y-m-d', strtotime('-100 days')), date('Y-m-d', strtotime('+20 days')), 'MH19NS1234']);
    eq(0, $due(), 'next service still ahead');
    tdb()->prepare('UPDATE vehicles SET next_service_on = ? WHERE reg_no = ?')->execute([date('Y-m-d', strtotime('-1 day')), 'MH19NS1234']);
    eq(1, $due(), 'next service date passed');
});

/** Upload a tiny PNG (or any bytes) as multipart "photo" to $path. */
function upload_to(string $path, string $as, ?string $bytes = null): array
{
    $file = tempnam(sys_get_temp_dir(), 'gm') . '.png';
    file_put_contents($file, $bytes ?? base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $ch = curl_init($GLOBALS['T_BASE'] . '/api' . $path);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => ['photo' => new CURLFile($file, 'image/png', 'bill.png')],
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . token($as), 'Accept: application/json'],
        CURLOPT_RETURNTRANSFER => true,
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    @unlink($file);
    return ['status' => $code, 'json' => json_decode($out, true), 'body' => $out];
}

test('bill photos: a photo of the paper bill on an expense and on a purchase bill; replace, remove, permissions', function () {
    $dir = dirname(__DIR__, 2) . '/public_html/api/storage/bills';
    $e = status(200, post('/expenses', ['category_id' => 5, 'amount' => 12000, 'mode' => 'bank', 'note' => 'Air compressor'], 'desk'))['item'];
    eq(null, $e['photo']);
    $up = status(200, upload_to("/expenses/{$e['id']}/photo", 'desk'));
    ok(is_file("$dir/expenses/{$up['photo']}"), 'stored');
    $g = get("/expenses/{$e['id']}/photo", 'desk');
    eq(200, $g['status']);
    eq(base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), $g['body']);
    eq(403, upload_to("/expenses/{$e['id']}/photo", 'stock')['status'], 'store keeper has no cash book');
    eq(422, upload_to("/expenses/{$e['id']}/photo", 'desk', 'not an image')['status']);
    $up2 = status(200, upload_to("/expenses/{$e['id']}/photo", 'desk'));
    ok(!is_file("$dir/expenses/{$up['photo']}"), 'replaced photo removed');
    $row = array_values(array_filter(status(200, get('/cash/day', 'desk'))['expenses'], static fn ($x) => $x['id'] === $e['id']))[0];
    eq($up2['photo'], $row['photo'], 'the day lists the photo');
    status(200, del("/expenses/{$e['id']}", 'desk'));
    ok(!is_file("$dir/expenses/{$up2['photo']}"), 'deleting the expense removes its photo');

    $pid = (int) tval("SELECT id FROM purchases WHERE status = 'final' ORDER BY id DESC LIMIT 1");
    eq(403, upload_to("/purchases/$pid/photo", 'desk')['status'], 'front desk cannot touch purchase bills');
    $pp = status(200, upload_to("/purchases/$pid/photo", 'stock'));
    eq($pp['photo'], status(200, get("/purchases/$pid", 'stock'))['item']['photo']);
    eq(200, get("/purchases/$pid/photo", 'admin')['status']);
    status(200, del("/purchases/$pid/photo", 'stock'));
    eq(404, get("/purchases/$pid/photo", 'stock')['status']);
    ok(!is_file("$dir/purchases/{$pp['photo']}"));
});

test('parts import: the shop\'s own sheet headings (Part No, Part Name, MRP, Rate, Qty), no part number, ₹ and %; sample Excel file', function () {
    $res = status(200, post('/parts/import', ['rows' => [
        ['Part No' => 'IMPX-1', 'Part Name' => 'Clutch plate', 'MRP' => '₹ 1,250', 'Rate' => '900', 'Disc %' => '10%', 'GST %' => '18', 'Available Qty' => '6', 'Remarks' => 'old stock'],
        ['Part Name' => 'Side mirror', 'पार्टचे नाव' => '', 'MRP' => '220', 'Qty' => '4'],
        ['पार्ट नं.' => 'IMPX-2', 'नाव' => 'Chain set', 'मराठी नाव' => 'चेन सेट', 'एमआरपी' => '1450', 'नग' => '2'],
        ['Part Name' => 'No price'],
        ['Remarks' => 'just a note'],
    ]], 'stock'));
    eq(3, $res['created']);
    eq(1, $res['auto_numbered']);
    eq(1, count($res['errors']), 'the row without MRP');
    eq(5, $res['errors'][0]['row']);
    eq(['Remarks'], $res['unused_columns'], 'headings we do not use');
    $p = trows("SELECT * FROM parts WHERE part_no = 'IMPX-1'")[0];
    eq(1250.0, (float) $p['selling_price']);
    eq(900.0, (float) $p['last_purchase_price']);
    eq(10.0, (float) $p['last_purchase_disc_pct']);
    eq(6.0, (float) $p['current_stock']);
    $m = trows("SELECT * FROM parts WHERE name_en = 'Side mirror'")[0];
    ok((bool) preg_match('/^P\d{5}$/', $m['part_no']), 'automatic part number ' . $m['part_no']);
    eq('चेन सेट', tval("SELECT name_mr FROM parts WHERE part_no = 'IMPX-2'"));
    // Again without a part number: the same name updates, nothing is added twice.
    $again = status(200, post('/parts/import', ['rows' => [['Part Name' => 'Side mirror', 'MRP' => '240']]], 'stock'));
    eq([0, 1, 0], [$again['created'], $again['updated'], $again['auto_numbered']]);
    eq(240.0, (float) tval("SELECT selling_price FROM parts WHERE name_en = 'Side mirror'"));

    $x = get('/parts/import-sample', 'stock');
    eq(200, $x['status']);
    eq("PK\x03\x04", substr($x['body'], 0, 4), 'an Excel (zip) file');
    ok(str_contains($x['body'], 'Part Name') && str_contains($x['body'], 'MRP') && str_contains($x['body'], 'पार्टचे नाव आणि MRP'), 'headings and the Marathi help');
    if (class_exists('ZipArchive')) {
        $f = tempnam(sys_get_temp_dir(), 'gx');
        file_put_contents($f, $x['body']);
        $z = new ZipArchive();
        eq(true, $z->open($f) === true, 'opens as a zip');
        ok($z->locateName('xl/worksheets/sheet2.xml') !== false, 'two sheets');
        $z->close();
        @unlink($f);
    }
    eq(403, get('/parts/import-sample', 'desk')['status']);
});

test('purchase bill from the supplier\'s Excel: lines matched by part no. or name, new parts by name get a number on save', function () {
    $sid = (int) tval('SELECT id FROM suppliers ORDER BY id LIMIT 1');
    $res = status(200, post('/purchases/import-lines', ['rows' => [
        ['Item Code' => 'brk-line', 'Particulars' => 'Brake lines 1m', 'Qty' => '10', 'Rate' => '85.00', 'Disc %' => '5', 'CGST %' => '9', 'MRP' => '150'],
        ['Particulars' => 'clutch PLATE', 'Qty' => '4', 'Rate' => '₹185', 'GST' => '18%', 'Remarks' => 'x'],
        ['Particulars' => 'Air filter Pulsar', 'Qty' => '2', 'Rate' => '210', 'MRP' => '260', 'HSN' => '84213100'],
        ['Particulars' => 'Horn relay', 'Rate' => '90'],
        ['Particulars' => '', 'Amount' => '3,450'],
    ]], 'stock'));
    eq(3, count($res['lines']));
    eq('BRK-LINE', $res['lines'][0]['part']['part_no'], 'by part number');
    eq(18.0, $res['lines'][0]['gst_rate'], 'CGST 9% → GST 18%');
    eq(150.0, $res['lines'][0]['mrp']);
    eq('Clutch plate', $res['lines'][1]['part']['name_en'], 'by name, any case');
    eq(185.0, $res['lines'][1]['price']);
    eq(null, $res['lines'][2]['part']);
    eq(['part_no' => '', 'name_en' => 'Air filter Pulsar', 'name_mr' => null, 'hsn' => '84213100', 'unit' => 'pcs', 'gst_rate' => 18], $res['lines'][2]['new_part']);
    eq([['row' => 5, 'name' => 'Horn relay', 'code' => 'qty_missing']], $res['errors']);
    eq(['Remarks', 'Amount'], $res['unused_columns']);
    eq(403, post('/purchases/import-lines', ['rows' => [['Particulars' => 'x', 'Qty' => 1]]], 'desk')['status']);

    $l = $res['lines'][2];
    $bill = status(200, post('/purchases', ['supplier_id' => $sid, 'bill_no' => 'XL-1', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit', 'price_mode' => 'net',
        'items' => [['new_part' => $l['new_part'], 'qty' => $l['qty'], 'price' => $l['price'], 'gst_rate' => $l['gst_rate'], 'mrp' => $l['mrp']]]], 'stock'))['item'];
    $no = $bill['items'][0]['part_no'];
    ok((bool) preg_match('/^P\d{5}$/', $no), "automatic part number $no");
    eq(260.0, (float) tval('SELECT selling_price FROM parts WHERE part_no = ?', [$no]), 'MRP is the new part\'s selling price');
    eq(2.0, (float) tval('SELECT current_stock FROM parts WHERE part_no = ?', [$no]));
});

test('bills: MRP changed from the bill screen - counter preview and a draft job bill use it; desk needs the tick', function () {
    $pid = (int) tval("SELECT id FROM parts WHERE part_no = 'MRP-SALE'");
    eq(403, post("/parts/$pid/mrp", ['mrp' => 210], 'desk')['status'], 'front desk: not by default');
    $r = status(200, post("/parts/$pid/mrp", ['mrp' => 210], 'admin'));
    eq(210.0, (float) $r['item']['selling_price']);
    eq(210.0, status(200, post('/invoices/preview', ['items' => [['part_id' => $pid, 'qty' => 1]]], 'desk'))['lines'][0]['unit_price']);
    ok((int) tval("SELECT COUNT(*) FROM audit_log WHERE action = 'price_change' AND entity_id = ?", [$pid]) >= 1, 'audited');

    // A draft counter bill follows the new MRP and keeps its discount.
    $inv = status(200, post('/invoices', ['items' => [['part_id' => $pid, 'qty' => 2, 'disc_pct' => 10]]], 'admin'))['item'];
    $after = status(200, post("/parts/$pid/mrp", ['mrp' => 220, 'invoice_id' => $inv['id']], 'admin'))['invoice'];
    eq(220.0, (float) $after['items'][0]['unit_price']);
    eq(10.0, (float) $after['items'][0]['disc_pct']);
    eq(198.0, $after['items'][0]['rate']);
    status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'cash', 'amount' => $after['grand_total']]]], 'admin'));
    eq('invoice_final', post("/parts/$pid/mrp", ['mrp' => 230, 'invoice_id' => $inv['id']], 'admin')['json']['code']);

    // The owner gives the front desk the tick.
    $desk = (int) tval("SELECT id FROM users WHERE username = 'desk'");
    status(200, put("/users/$desk", ['permissions' => ['change_mrp' => true]], 'admin'));
    status(200, post("/parts/$pid/mrp", ['mrp' => 225], 'desk'));
});
