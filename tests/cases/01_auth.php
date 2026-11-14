<?php
declare(strict_types=1);

test('auth: public info names the shop', function () {
    $j = status(200, http('GET', '/public/info'));
    eq('Trimurti Auto', $j['shop_name']);
});

test('auth: ?r= fallback works without mod_rewrite', function () {
    $ch = curl_init($GLOBALS['T_BASE'] . '/api/index.php?r=/public/info');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $j = json_decode((string) curl_exec($ch), true);
    curl_close($ch);
    eq('Trimurti Auto', $j['shop_name'] ?? null);
});

test('auth: wrong password is refused', function () {
    $r = http('POST', '/auth/login', ['username' => 'admin', 'password' => 'nope']);
    eq(401, $r['status']);
    eq('bad_credentials', $r['json']['code']);
});

test('auth: seeded user must change password before anything else', function () {
    $j = status(200, http('POST', '/auth/login', ['username' => 'admin', 'password' => DEMO_PASSWORD]));
    eq(1, $j['user']['must_change_password']);
    $r = http('GET', '/parts', null, $j['token']);
    eq(403, $r['status']);
    eq('password_change_required', $r['json']['code']);
    status(200, http('GET', '/auth/me', null, $j['token']));

    $weak = http('POST', '/auth/password', ['current_password' => DEMO_PASSWORD, 'new_password' => 'short'], $j['token']);
    eq(422, $weak['status']);

    $c = status(200, http('POST', '/auth/password', ['current_password' => DEMO_PASSWORD, 'new_password' => NEW_PASSWORD], $j['token']));
    eq(0, $c['user']['must_change_password']);
    status(200, http('GET', '/parts', null, $c['token']));
    // old token dies with the old password
    eq(401, http('GET', '/auth/me', null, $j['token'])['status']);
    $GLOBALS['T_TOKENS']['admin'] = $c['token'];
});

test('auth: X-Auth-Token header is accepted', function () {
    $r = http('GET', '/auth/me', null, null, ['X-Auth-Token: ' . token('admin')]);
    eq(200, $r['status']);
    eq('owner', $r['json']['user']['role']);
});

test('auth: no token → 401', function () {
    eq(401, http('GET', '/parts')['status']);
});

test('auth: 5 failed logins lock the username + IP', function () {
    for ($i = 0; $i < 5; $i++) {
        eq(401, http('POST', '/auth/login', ['username' => 'ghost', 'password' => 'x'])['status']);
    }
    $r = http('POST', '/auth/login', ['username' => 'ghost', 'password' => 'x']);
    eq(429, $r['status']);
    eq('login_locked', $r['json']['code']);
});

test('auth: deactivated user is logged out immediately', function () {
    $u = status(200, post('/users', ['name' => 'Temp Mechanic', 'username' => 'tempmech', 'role' => 'mechanic', 'password' => 'Temp@12345'], 'admin'));
    $j = status(200, http('POST', '/auth/login', ['username' => 'tempmech', 'password' => 'Temp@12345']));
    $j = status(200, http('POST', '/auth/password', ['current_password' => 'Temp@12345', 'new_password' => 'Temp@54321'], $j['token']));
    status(200, http('GET', '/parts', null, $j['token']));
    status(200, put('/users/' . $u['item']['id'], ['active' => false], 'admin'));
    eq(401, http('GET', '/parts', null, $j['token'])['status']);
    eq(403, http('POST', '/auth/login', ['username' => 'tempmech', 'password' => 'Temp@54321'])['status']);
});

test('auth: language preference is saved', function () {
    status(200, post('/auth/language', ['language' => 'en'], 'desk'));
    eq('en', status(200, get('/auth/me', 'desk'))['user']['language']);
    eq(422, post('/auth/language', ['language' => 'hi'], 'desk')['status']);
});
