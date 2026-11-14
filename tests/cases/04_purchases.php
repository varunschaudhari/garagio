<?php
declare(strict_types=1);

function part_id(string $no): int
{
    return (int) tval('SELECT id FROM parts WHERE part_no = ?', [$no]);
}

function part_row(string $no): array
{
    return trows('SELECT * FROM parts WHERE part_no = ?', [$no])[0];
}

test('suppliers: GSTIN sets the state; bad GSTIN refused; only owner / inventory', function () {
    $j = status(200, post('/suppliers', ['name' => 'Karnataka Bearings', 'phone' => '9000000222', 'gstin' => '29abcde1234f1z5'], 'stock'));
    eq('29ABCDE1234F1Z5', $j['item']['gstin']);
    eq('29', $j['item']['state_code']);
    eq(0.0, $j['item']['balance']);
    eq(422, post('/suppliers', ['name' => 'Bad', 'gstin' => '12345'], 'stock')['status']);
    eq(403, get('/suppliers', 'desk')['status']);
    eq(403, get('/suppliers', 'ramesh')['status']);
    eq(403, get('/purchases', 'desk')['status']);
    eq(403, get('/reorder', 'ramesh')['status']);
});

test('suppliers: opening balance shows in balance and ledger', function () {
    $s = status(200, get('/suppliers/2', 'admin'))['item'];
    eq(4500.0, $s['balance']);
    $l = status(200, get('/suppliers/2/ledger', 'admin'));
    eq('opening', $l['items'][0]['type']);
    eq(4500.0, $l['items'][0]['balance']);
});

test('purchases: preview computes GST on ex-GST prices without saving', function () {
    $before = (int) tval('SELECT COUNT(*) FROM purchases');
    $j = status(200, post('/purchases/preview', ['supplier_id' => 1, 'items' => [['part_id' => part_id('SP-CPR7EA9'), 'qty' => 10, 'price' => 85, 'disc_pct' => 5]]], 'stock'));
    $l = $j['lines'][0];
    eq(80.75, $l['net_cost']);
    eq(807.5, $l['taxable']);
    eq(145.35, $l['tax_amount']);
    eq($l['tax_amount'], round($l['cgst'] + $l['sgst'], 2), 'CGST + SGST = tax');
    eq(953.0, $j['totals']['grand_total']);
    eq(0.15, $j['totals']['round_off']);
    eq(false, $j['interstate']);
    eq($before, (int) tval('SELECT COUNT(*) FROM purchases'));
});

test('purchases (acceptance): credit bill raises stock, updates last price / discount and supplier balance; part payment reduces it', function () {
    $sp = part_row('SP-CPR7EA9');
    $tyre = part_row('TYR-9090-17');
    $stockBefore = (float) $sp['current_stock'];
    $avgBefore = (float) $sp['avg_cost'];
    $balBefore = status(200, get('/suppliers/1', 'stock'))['item']['balance'];

    $j = status(200, post('/purchases', [
        'supplier_id' => 1, 'bill_no' => 'SAS-101', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit',
        'items' => [
            ['part_id' => (int) $sp['id'], 'qty' => 10, 'price' => 90, 'disc_pct' => 10],
            ['part_id' => (int) $tyre['id'], 'qty' => 2, 'price' => 950],
        ],
    ], 'stock'));
    $bill = $j['item'];
    eq(2, count($bill['items']));
    eq(0.0, $bill['paid']);

    $sp2 = part_row('SP-CPR7EA9');
    eq($stockBefore + 10, (float) $sp2['current_stock'], 'stock raised');
    eq(90.0, (float) $sp2['last_purchase_price'], 'last purchase price');
    eq(10.0, (float) $sp2['last_purchase_disc_pct'], 'last purchase discount');
    $expectedAvg = ($stockBefore * $avgBefore + 10 * 81) / ($stockBefore + 10);
    eq(round($expectedAvg, 2), round((float) $sp2['avg_cost'], 2), 'weighted average cost');
    eq('purchase', tval('SELECT mtype FROM stock_movements WHERE part_id = ? ORDER BY id DESC LIMIT 1', [$sp['id']]));

    $bal = status(200, get('/suppliers/1', 'stock'))['item']['balance'];
    eq(round($balBefore + $bill['total'], 2), $bal, 'supplier balance up by bill total');

    $p = status(200, post('/suppliers/1/payments', ['amount' => 500, 'mode' => 'upi', 'reference' => 'UPI-778', 'purchase_id' => $bill['id']], 'stock'));
    eq(round($bal - 500, 2), $p['item']['balance'], 'part payment reduces balance');

    $l = status(200, get('/suppliers/1/ledger', 'admin'));
    $last = end($l['items']);
    eq('payment', $last['type']);
    eq($p['item']['balance'], $last['balance'], 'ledger running balance');
    ok(ledger_balanced(), 'stock ledger out of balance');
});

test('purchases: cash bill records its own payment, balance unchanged', function () {
    $balBefore = status(200, get('/suppliers/1', 'stock'))['item']['balance'];
    $j = status(200, post('/purchases', [
        'supplier_id' => 1, 'bill_no' => 'SAS-102', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'cash',
        'items' => [['part_id' => part_id('BS-SPL'), 'qty' => 5, 'price' => 150, 'disc_pct' => 5]],
    ], 'admin'));
    eq($j['item']['total'], $j['item']['paid']);
    eq($balBefore, status(200, get('/suppliers/1', 'stock'))['item']['balance']);
});

test('purchases: inter-state supplier → IGST', function () {
    $j = status(200, post('/purchases', [
        'supplier_id' => 3, 'bill_no' => 'DL-9', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit',
        'items' => [['part_id' => part_id('OIL-2040-1L'), 'qty' => 12, 'price' => 270, 'disc_pct' => 6]],
    ], 'stock'))['item'];
    ok($j['igst'] > 0, 'IGST expected');
    eq(0.0, $j['cgst']);
    eq(1, $j['is_interstate']);
});

test('purchases: duplicate bill number for the same supplier → 409', function () {
    $r = post('/purchases', [
        'supplier_id' => 1, 'bill_no' => 'SAS-101', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit',
        'items' => [['part_id' => part_id('BS-SPL'), 'qty' => 1, 'price' => 150]],
    ], 'stock');
    eq(409, $r['status']);
    eq('duplicate_bill', $r['json']['code']);
});

test('purchases: line errors name the line; empty bill refused', function () {
    $r = post('/purchases', ['supplier_id' => 1, 'bill_no' => 'X1', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit', 'items' => [['part_id' => part_id('BS-SPL'), 'qty' => 0, 'price' => 1]]], 'stock');
    eq(422, $r['status']);
    ok(isset($r['json']['fields']['items.0']['qty']), 'qty error on line 0');
    eq(422, post('/purchases', ['supplier_id' => 1, 'bill_no' => 'X2', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit', 'items' => []], 'stock')['status']);
});

test('purchases: new part created inline from the bill', function () {
    $j = status(200, post('/purchases', [
        'supplier_id' => 2, 'bill_no' => 'OST-55', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit',
        'items' => [['new_part' => ['part_no' => 'new-pur-1', 'name_en' => 'Mirror clamp', 'name_mr' => 'आरसा क्लॅम्प', 'selling_price' => 60, 'location_id' => 1, 'rack' => 'A4'], 'qty' => 5, 'price' => 30]],
    ], 'stock'))['item'];
    eq('NEW-PUR-1', $j['items'][0]['part_no']);
    $p = part_row('NEW-PUR-1');
    eq(5.0, (float) $p['current_stock']);
    eq(30.0, (float) $p['avg_cost']);
    eq(30.0, (float) $p['last_purchase_price']);
    ok(ledger_balanced());
});

test('reorder: low-stock parts grouped by last supplier', function () {
    // Belt is out of stock; buy 1 from Om Sai Tyres so it stays low but has a last supplier.
    status(200, post('/purchases', [
        'supplier_id' => 2, 'bill_no' => 'OST-56', 'bill_date' => date('Y-m-d'), 'payment_mode' => 'credit',
        'items' => [['part_id' => part_id('BELT-ACT'), 'qty' => 1, 'price' => 470]],
    ], 'stock'));
    $j = status(200, get('/reorder', 'stock'));
    $bySupplier = [];
    foreach ($j['groups'] as $g) {
        foreach ($g['items'] as $it) {
            $bySupplier[$it['part_no']] = $g['supplier']['name'] ?? null;
        }
    }
    eq('Om Sai Tyres (Demo)', $bySupplier['BELT-ACT'] ?? 'missing');
    ok(array_key_exists('CL-SPRAY', $bySupplier), 'chain lube is low');
    eq(null, $bySupplier['CL-SPRAY'], 'never purchased → no supplier group');
    $belt = null;
    foreach ($j['groups'] as $g) {
        foreach ($g['items'] as $it) {
            if ($it['part_no'] === 'BELT-ACT') {
                $belt = $it;
            }
        }
    }
    eq(3.0, $belt['suggested_qty'], '2 × min − stock');
    eq(['low'], $belt['reasons']);
});

test('purchases: list filters and totals', function () {
    $j = status(200, get('/purchases?supplier=1', 'admin'));
    ok($j['total'] >= 2);
    ok($j['sum_total'] > 0);
    $j = status(200, get('/purchases?q=DL-9', 'admin'));
    eq(1, $j['total']);
    eq('Deccan Lubricants (Demo)', $j['items'][0]['supplier_name']);
});
