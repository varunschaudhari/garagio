<?php
declare(strict_types=1);

/*
 * Hand-checked example (GST-inclusive MRP, same state):
 *   BILL-18: 1 × ₹1,180 @18% → taxable 1,000.00 + CGST 90 + SGST 90
 *   BILL-5 : 1 × ₹105   @5%  → taxable   100.00 + CGST 2.50 + SGST 2.50
 *   Total 1,285.00.  With 10% bill discount: taxable 990.00, GST 166.50, total 1,156.50 → 1,157 (round off +0.50)
 * Exclusive prices: taxable 1,285.00, GST 212.40 + 5.25 = 217.65, total 1,502.65 → 1,503 (+0.35)
 * Other-state customer: same 1,180 line → IGST 180.00, no CGST/SGST.
 */

function counter_draft(array $body, string $as): array
{
    return status(200, post('/invoices', $body, $as))['item'];
}

test('billing: set up two test parts (18% and 5%)', function () {
    status(200, post('/parts', ['part_no' => 'BILL-18', 'name_en' => 'Test 18', 'name_mr' => 'टेस्ट 18', 'selling_price' => 1180, 'gst_rate' => 18, 'hsn' => '87141090', 'opening_stock' => 20, 'opening_cost' => 700], 'admin'));
    status(200, post('/parts', ['part_no' => 'BILL-5', 'name_en' => 'Test 5', 'selling_price' => 105, 'gst_rate' => 5, 'opening_stock' => 20, 'opening_cost' => 60], 'admin'));
});

test('billing (acceptance): GST-inclusive same-state totals match the hand-checked example', function () {
    $items = [['part_id' => part_id('BILL-18'), 'qty' => 1], ['part_id' => part_id('BILL-5'), 'qty' => 1]];
    $pv = status(200, post('/invoices/preview', ['items' => $items], 'desk'));
    eq(1100.0, $pv['totals']['taxable_total']);
    eq(92.5, $pv['totals']['cgst']);
    eq(92.5, $pv['totals']['sgst']);
    eq(1285.0, $pv['totals']['grand_total']);
    ok(!isset($pv['lines'][0]['unit_cost']), 'front desk does not see cost');

    $inv = counter_draft(['items' => $items, 'cust_name' => 'Walk-in Test', 'cust_phone' => '9000000055'], 'desk');
    eq('draft', $inv['status']);
    eq(null, $inv['invoice_no'], 'number only when final');
    eq(1285.0, $inv['grand_total']);
    $GLOBALS['T_INV'] = (int) $inv['id'];
});

test('billing (acceptance): front desk discount is refused; owner discount spreads across GST rates', function () {
    $id = $GLOBALS['T_INV'];
    $r = put("/invoices/$id", ['bill_disc_pct' => 10], 'desk');
    eq(403, $r['status']);
    eq('discount_owner_only', $r['json']['code']);
    eq(403, post('/invoices', ['items' => [['part_id' => part_id('BILL-5'), 'qty' => 1, 'disc_pct' => 5]]], 'desk')['status']);
    $inv = status(200, put("/invoices/$id", ['bill_disc_pct' => 10], 'admin'))['item'];
    eq(990.0, $inv['taxable_total']);
    eq(83.25, $inv['cgst']);
    eq(1157.0, $inv['grand_total']);
    eq(0.5, $inv['round_off']);
    eq(128.5, $inv['discount_total']);
});

test('billing: finalise assigns INV/yy-yy/00001, deducts counter stock, records payment', function () {
    $id = $GLOBALS['T_INV'];
    $s18 = stock_of('BILL-18');
    eq(422, post("/invoices/$id/finalize", ['payments' => [['mode' => 'cash', 'amount' => 2000]]], 'desk')['status'], 'overpayment refused');
    $inv = status(200, post("/invoices/$id/finalize", ['payments' => [['mode' => 'cash', 'amount' => 1000], ['mode' => 'upi', 'amount' => 157, 'reference' => 'UPI1']]], 'desk'))['item'];
    ok(preg_match('#^INV/\d{2}-\d{2}/00001$#', $inv['invoice_no']) === 1, 'invoice number ' . $inv['invoice_no']);
    ok(strlen($inv['invoice_no']) <= 16, 'GST 16-character limit');
    eq('final', $inv['status']);
    eq('paid', $inv['pay_status']);
    eq(2, count($inv['payments']));
    eq($s18 - 1, stock_of('BILL-18'));
    eq('counter_sale', tval('SELECT mtype FROM stock_movements WHERE part_id = ? ORDER BY id DESC LIMIT 1', [part_id('BILL-18')]));
    ok((float) tval("SELECT unit_cost FROM invoice_items WHERE invoice_id = ? AND part_id = ?", [$id, part_id('BILL-18')]) > 0, 'cost recorded for profit');
    ok((int) tval("SELECT COUNT(*) FROM audit_log WHERE action = 'invoice_discount' AND entity_id = ?", [$id]) === 1, 'discount audited');
    eq(409, put("/invoices/$id", ['bill_disc_pct' => 5], 'admin')['status'], 'final bill is locked');
    ok(ledger_balanced());
});

test('billing (acceptance): exclusive-price mode', function () {
    status(200, put('/settings', ['prices_include_gst' => false], 'admin'));
    $pv = status(200, post('/invoices/preview', ['items' => [['part_id' => part_id('BILL-18'), 'qty' => 1], ['part_id' => part_id('BILL-5'), 'qty' => 1]]], 'desk'));
    status(200, put('/settings', ['prices_include_gst' => true], 'admin'));
    eq(1285.0, $pv['totals']['taxable_total']);
    eq(217.65, $pv['totals']['tax_total']);
    eq(1503.0, $pv['totals']['grand_total']);
    eq(0.35, $pv['totals']['round_off']);
});

test('billing (acceptance): other-state customer pays IGST', function () {
    $pv = status(200, post('/invoices/preview', ['customer_id' => 4, 'items' => [['part_id' => part_id('BILL-18'), 'qty' => 1]]], 'desk'));
    eq(180.0, $pv['totals']['igst']);
    eq(0.0, $pv['totals']['cgst']);
    $inv = counter_draft(['customer_id' => 4, 'items' => [['part_id' => part_id('BILL-18'), 'qty' => 1]]], 'desk');
    eq(1, (int) $inv['is_interstate']);
});

test('billing (acceptance): credit to a non-trusted customer is refused', function () {
    $inv = counter_draft(['customer_id' => 2, 'items' => [['part_id' => part_id('BILL-5'), 'qty' => 2]]], 'desk');
    $r = post('/invoices/' . $inv['id'] . '/finalize', ['payments' => [['mode' => 'credit', 'amount' => 210]]], 'desk');
    eq(409, $r['status']);
    eq('credit_not_allowed', $r['json']['code']);
    $r = post('/invoices/' . $inv['id'] . '/finalize', ['payments' => [['mode' => 'cash', 'amount' => 100]]], 'desk');
    eq('credit_not_allowed', $r['json']['code'], 'part payment is credit too');
    eq('credit_not_allowed', post('/invoices/' . counter_draft(['items' => [['part_id' => part_id('BILL-5'), 'qty' => 1]]], 'desk')['id'] . '/finalize', [], 'desk')['json']['code'], 'walk-in cannot take credit');
    status(200, post('/invoices/' . $inv['id'] . '/finalize', ['payments' => [['mode' => 'upi', 'amount' => 210]]], 'desk'));
});

test('billing: trusted customer gets credit within the limit; over the limit is refused', function () {
    // Rahul (customer 1) is trusted with a ₹5,000 limit and owes nothing yet.
    $a = counter_draft(['customer_id' => 1, 'items' => [['part_id' => part_id('BILL-18'), 'qty' => 2]]], 'desk'); // 2,360
    $a = status(200, post("/invoices/{$a['id']}/finalize", [], 'desk'))['item'];
    eq('unpaid', $a['pay_status']);
    $b = counter_draft(['customer_id' => 1, 'items' => [['part_id' => part_id('BILL-18'), 'qty' => 2]]], 'desk'); // 2,360 → 4,720 ≤ 5,000
    $b = status(200, post("/invoices/{$b['id']}/finalize", ['payments' => [['mode' => 'credit', 'amount' => 2360]]], 'desk'))['item'];
    $c = counter_draft(['customer_id' => 1, 'items' => [['part_id' => part_id('BILL-18'), 'qty' => 1]]], 'desk'); // +1,180 → 5,900 > 5,000
    $r = post("/invoices/{$c['id']}/finalize", [], 'desk');
    eq(409, $r['status']);
    eq('credit_limit_exceeded', $r['json']['code']);
    $GLOBALS['T_CREDIT'] = [$a['id'], $b['id']];
});

test('billing: customer payment pays the oldest bill first; ledger keeps a running balance', function () {
    [$a, $b] = $GLOBALS['T_CREDIT'];
    $res = status(200, post('/customers/1/payments', ['amount' => 3000, 'mode' => 'cash'], 'desk'));
    eq(2, count($res['allocations']));
    eq($a, $res['allocations'][0]['invoice_id']);
    eq(2360.0, $res['allocations'][0]['amount']);
    eq(640.0, $res['allocations'][1]['amount']);
    eq('paid', status(200, get("/invoices/$a", 'desk'))['item']['pay_status']);
    eq('partial', status(200, get("/invoices/$b", 'desk'))['item']['pay_status']);
    $l = status(200, get('/customers/1/ledger', 'desk'));
    eq(1720.0, $l['balance']);
    eq(1720.0, end($l['items'])['balance']);
    eq(1, count($l['open_invoices']));
    $p = status(200, post("/invoices/$b/payments", ['amount' => 1720, 'mode' => 'upi'], 'desk'))['item'];
    eq('paid', $p['pay_status']);
    eq(422, post("/invoices/$b/payments", ['amount' => 1, 'mode' => 'upi'], 'desk')['status'], 'nothing left to pay');
});

test('billing: job bill from issued parts + labour; delivery after the final bill', function () {
    $id = $GLOBALS['T_JOB'];
    $job = status(200, get("/jobs/$id", 'desk'))['item'];
    eq('ready', $job['status']);
    $inv = status(200, post('/invoices', ['job_card_id' => $id], 'desk'))['item'];
    eq('job', $inv['inv_type']);
    eq($job['money']['current_total'], $inv['grand_total'], 'bill equals the work on the job');
    $labour = array_values(array_filter($inv['items'], static fn ($i) => $i['item_type'] === 'labour'));
    eq('998714', $labour[0]['hsn'], 'labour uses SAC 998714');
    eq((int) $inv['id'], (int) status(200, post('/invoices', ['job_card_id' => $id], 'desk'))['item']['id'], 'one draft per job');
    $before = stock_of('SP-CPR7EA9');
    $fin = status(200, post("/invoices/{$inv['id']}/finalize", ['payments' => [['mode' => 'upi', 'amount' => $inv['grand_total']]]], 'desk'))['item'];
    eq($before, stock_of('SP-CPR7EA9'), 'job parts left stock when issued, not again at billing');
    eq('paid', $fin['pay_status']);
    $d = status(200, post("/jobs/$id/status", ['status' => 'delivered'], 'desk'))['item'];
    eq('delivered', $d['status']);
    ok(tval('SELECT last_service_on FROM vehicles WHERE id = ?', [$d['vehicle_id']]) !== null, 'last service date set');
    $GLOBALS['T_JOB_INV'] = (int) $inv['id'];
});

test('billing: a pending revised estimate blocks the bill', function () {
    $id = $GLOBALS['T_JOB2'];
    status(200, post("/jobs/$id/status", ['status' => 'in_progress'], 'ramesh'));
    status(200, post("/jobs/$id/labour", ['description' => 'Extra check', 'amount' => 500], 'desk'));
    $e = status(200, post("/jobs/$id/estimates", ['items' => [['item_type' => 'labour', 'description' => 'Revised', 'amount' => 700]]], 'desk'))['item'];
    status(200, post('/estimates/' . $e['id'] . '/send', [], 'desk'));
    $r = post('/invoices', ['job_card_id' => $id], 'desk');
    eq(409, $r['status']);
    eq('revision_pending', $r['json']['code']);
    status(200, post('/estimates/' . $e['id'] . '/approve-call', ['note' => 'OK'], 'desk'));
    status(200, post('/invoices', ['job_card_id' => $id], 'desk'));
});

test('billing: only the owner cancels; counter stock comes back; job bill cancel reopens the job', function () {
    $id = $GLOBALS['T_INV'];
    $s5 = stock_of('BILL-5');
    eq(403, post("/invoices/$id/cancel", ['reason' => 'x'], 'desk')['status']);
    $c = status(200, post("/invoices/$id/cancel", ['reason' => 'Customer returned the parts'], 'admin'))['item'];
    eq('cancelled', $c['status']);
    eq($s5 + 1, stock_of('BILL-5'));
    eq('sale_cancel', tval('SELECT mtype FROM stock_movements WHERE part_id = ? ORDER BY id DESC LIMIT 1', [part_id('BILL-5')]));
    ok((int) tval("SELECT COUNT(*) FROM audit_log WHERE action = 'invoice_cancel' AND entity_id = ?", [$id]) === 1);

    $jid = $GLOBALS['T_JOB'];
    status(200, post('/invoices/' . $GLOBALS['T_JOB_INV'] . '/cancel', ['reason' => 'Wrong labour charged'], 'admin'));
    $job = status(200, get("/jobs/$jid", 'desk'))['item'];
    eq('ready', $job['status']);
    eq(null, $job['invoice_id']);
    ok(ledger_balanced());
});

test('billing: bilingual printable invoice with amount in words; WhatsApp bill message', function () {
    [$a] = $GLOBALS['T_CREDIT'];
    $h = get("/invoices/$a/html?lang=mr", 'desk');
    eq(200, $h['status']);
    ok(str_contains($h['body'], 'कर बीजक') && str_contains($h['body'], 'Tax Invoice'), 'bilingual title');
    ok(str_contains($h['body'], 'Rupees Two Thousand Three Hundred Sixty Only'), 'English words');
    ok(str_contains($h['body'], 'दोन हजार तीनशे साठ रुपये फक्त'), 'Marathi words');
    eq(403, get("/invoices/$a/html", 'ramesh')['status']);
    $wa = status(200, post("/invoices/$a/whatsapp", [], 'desk'));
    ok(str_starts_with($wa['url'], 'https://wa.me/919000000001'));
});

test('dashboard: owner sees money figures; others do not', function () {
    $d = status(200, get('/dashboard', 'admin'));
    ok(isset($d['money']['sales_today'], $d['money']['by_mode']['cash'], $d['money']['customer_dues']), 'owner money block');
    eq(30, count($d['money']['sales_30d']));
    ok($d['money']['sales_today'] > 0, 'bills were made today');
    ok(!isset(status(200, get('/dashboard', 'desk'))['money']), 'front desk has no money figures');
    ok(!isset(status(200, get('/dashboard', 'stock'))['money']), 'inventory has no money figures');
});
