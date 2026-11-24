<?php
declare(strict_types=1);

test('settings: only the owner can change settings', function () {
    eq(403, put('/settings', ['approval_limit' => 5], 'desk')['status']);
    eq(403, put('/settings', ['approval_limit' => 5], 'stock')['status']);
    $j = status(200, put('/settings', ['approval_limit' => 1200, 'shop_phone' => '02312345678'], 'admin'));
    eq('1200', $j['settings']['approval_limit']);
    status(200, put('/settings', ['approval_limit' => 1000], 'admin'));
    eq(422, put('/settings', ['shop_gstin' => 'NOTAGSTIN'], 'admin')['status']);
    ok((int) tval("SELECT COUNT(*) FROM audit_log WHERE action = 'settings_update'") >= 2);
});

test('settings: every role can read settings', function () {
    eq('Trimurti Auto', status(200, get('/settings', 'ramesh'))['settings']['shop_name']);
});

test('users: owner manages users; others cannot', function () {
    eq(403, get('/users', 'desk')['status']);
    $all = status(200, get('/users', 'admin'));
    ok($all['total'] >= 5);
    ok(!array_key_exists('password_hash', $all['items'][0]), 'hash leaked');
    $u = status(200, post('/users', ['name' => 'Ganesh', 'username' => 'Ganesh.M', 'role' => 'mechanic', 'password' => 'Mech@12345', 'phone' => '9000000099'], 'admin'));
    eq('ganesh.m', $u['item']['username']);
    eq(1, $u['item']['must_change_password']);
    $dup = post('/users', ['name' => 'Again', 'username' => 'ganesh.m', 'role' => 'mechanic', 'password' => 'Mech@12345'], 'admin');
    eq(422, $dup['status'], 'login ID already used');
    eq('taken', $dup['json']['fields']['username'] ?? null);
    eq(409, put('/users/1', ['active' => false], 'admin')['status'], 'owner cannot deactivate self');
    ok(in_array('Ganesh', array_column(status(200, get('/users/mechanics', 'ramesh'))['items'], 'name'), true));
});

test('masters: locations and categories by owner or inventory; labour rates by owner only', function () {
    status(200, post('/locations', ['name_en' => 'Back shelf', 'name_mr' => 'मागील कपाट', 'sort_order' => 9], 'stock'));
    eq(403, post('/locations', ['name_en' => 'Nope'], 'desk')['status']);
    status(200, post('/categories', ['name_en' => 'Tools', 'name_mr' => 'हत्यारे'], 'stock'));
    eq(403, post('/labour-rates', ['name_en' => 'Tune-up', 'amount' => 300], 'stock')['status']);
    $lr = status(200, post('/labour-rates', ['name_en' => 'Tune-up', 'name_mr' => 'ट्यून-अप', 'amount' => 300], 'admin'));
    status(200, put('/labour-rates/' . $lr['item']['id'], ['amount' => 320], 'admin'));
    eq(320.0, status(200, get('/labour-rates', 'ramesh'))['items'][array_search('Tune-up', array_column(status(200, get('/labour-rates', 'ramesh'))['items'], 'name_en'))]['amount']);
});

test('security: internal folders are not served', function () {
    foreach (['/lib/db.php', '/config.php', '/routes/parts.php', '/templates/labels.php'] as $p) {
        $ch = curl_init($GLOBALS['T_BASE'] . '/api' . $p);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_exec($ch);
        eq(403, (int) curl_getinfo($ch, CURLINFO_HTTP_CODE), $p);
        curl_close($ch);
    }
});
