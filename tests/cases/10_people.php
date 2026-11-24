<?php
declare(strict_types=1);

/* Shop requests of 24 Nov 2026: login IDs can change, mechanics without a login, removing people. */

test('users: the owner changes a name and the login ID - the new ID logs in, the old one not, open sessions stay', function () {
    $u = status(200, post('/users', ['name' => 'Sunil', 'username' => 'sunil', 'role' => 'front_desk', 'password' => 'Sunil-pass-1'], 'admin'))['item'];
    ok($u['login'] === true, 'has a login');
    $old = status(200, http('POST', '/auth/login', ['username' => 'sunil', 'password' => 'Sunil-pass-1']))['token'];

    $r = status(200, put('/users/' . $u['id'], ['name' => 'Sunil Patil', 'username' => 'Sunil.P'], 'admin'))['item'];
    eq('Sunil Patil', $r['name']);
    eq('sunil.p', $r['username'], 'login IDs are lower case');
    eq(401, http('POST', '/auth/login', ['username' => 'sunil', 'password' => 'Sunil-pass-1'])['status'], 'old login ID no longer works');
    status(200, http('POST', '/auth/login', ['username' => 'sunil.p', 'password' => 'Sunil-pass-1']), 'new login ID works');
    status(200, http('GET', '/auth/me', null, $old), 'already logged in: stays logged in');

    $dup = put('/users/' . $u['id'], ['username' => 'desk'], 'admin');
    eq(422, $dup['status'], 'login ID of someone else');
    eq('taken', $dup['json']['fields']['username'] ?? null);
    eq(422, put('/users/' . $u['id'], ['username' => ''], 'admin')['status'], 'a person with a login keeps a login ID');
    eq(403, put('/users/' . $u['id'], ['name' => 'X'], 'desk')['status'], 'only the owner');
    $GLOBALS['T_SUNIL'] = (int) $u['id'];
});

test('mechanics: one without a login is given jobs and paid but cannot log in; a login is given and taken away', function () {
    $m = status(200, post('/users', ['name' => 'Raju', 'phone' => '9011100012', 'role' => 'mechanic', 'login' => false], 'admin'))['item'];
    ok($m['login'] === false && $m['username'] === null, 'no login ID');
    $bad = post('/users', ['name' => 'Desk two', 'role' => 'front_desk', 'login' => false], 'admin');
    eq(422, $bad['status'], 'only a mechanic can be without a login');
    eq('required', $bad['json']['fields']['username'] ?? null);

    ok(in_array('Raju', array_column(get('/users/mechanics', 'desk')['json']['items'], 'name'), true), 'can be chosen on a job');
    $job = status(200, post('/jobs', [
        'customer' => ['name' => 'Ganesh Pawar', 'phone' => '9011100013'],
        'vehicle' => ['reg_no' => 'MH19ZZ1001', 'make' => 'Hero', 'model' => 'Splendor'],
        'complaint' => 'Service', 'mechanic_id' => $m['id'],
    ], 'desk'))['item'];
    eq('Raju', $job['mechanic_name'] ?? null);
    status(200, post('/mechanics/' . $m['id'] . '/payments', ['amount' => 300], 'admin'), 'paid');
    $day = array_values(array_filter(get('/mechanics/daily', 'admin')['json']['items'], static fn ($x) => $x['id'] === $m['id']))[0] ?? null;
    ok($day && $day['login'] === false && (float) $day['paid_daily'] === 300.0, 'in the daily summary, marked without login');

    $need = put('/users/' . $m['id'], ['login' => true, 'username' => 'raju'], 'admin');
    eq(422, $need['status'], 'a new login needs a password');
    eq('required', $need['json']['fields']['reset_password'] ?? null);
    status(200, put('/users/' . $m['id'], ['login' => true, 'username' => 'raju', 'reset_password' => 'Raju-pass-1'], 'admin'));
    $tok = status(200, http('POST', '/auth/login', ['username' => 'raju', 'password' => 'Raju-pass-1']))['token'];
    status(200, http('GET', '/auth/me', null, $tok));

    $r = status(200, put('/users/' . $m['id'], ['login' => false], 'admin'))['item'];
    ok($r['login'] === false && $r['username'] === null, 'login taken away');
    eq(401, http('GET', '/auth/me', null, $tok)['status'], 'his open session ends');
    eq(401, http('POST', '/auth/login', ['username' => 'raju', 'password' => 'Raju-pass-1'])['status']);
    eq(422, put('/users/' . $m['id'], ['role' => 'front_desk'], 'admin')['status'], 'other roles need a login');
    eq(409, put('/users/1', ['login' => false], 'admin')['status'], 'not for yourself');
    $GLOBALS['T_RAJU'] = ['id' => (int) $m['id'], 'job' => (int) $job['id']];
});

test('users: remove - unused is deleted, someone in the records is hidden (not while a job is open), never yourself', function () {
    $t = status(200, post('/users', ['name' => 'Temp mechanic', 'role' => 'mechanic', 'login' => false], 'admin'))['item'];
    $r = status(200, del('/users/' . $t['id'], 'admin'));
    ok($r['deleted'] === true, 'nothing points at him: deleted');
    ok(!in_array($t['id'], array_column(get('/users', 'admin')['json']['items'], 'id'), true), 'gone from the list');

    ['id' => $raju, 'job' => $job] = $GLOBALS['T_RAJU'];
    $open = del('/users/' . $raju, 'admin');
    eq(409, $open['status'], 'open job first');
    eq('mechanic_has_open_jobs', $open['json']['code'] ?? null);
    status(200, post("/jobs/$job/status", ['status' => 'cancelled', 'note' => 'Customer left'], 'desk'));
    $r = status(200, del('/users/' . $raju, 'admin'));
    ok($r['hidden'] === true && $r['deleted'] === false, 'has a job and pay: hidden');
    eq(0, (int) tval('SELECT active FROM users WHERE id = ?', [$raju]));
    ok(!in_array($raju, array_column(get('/users/mechanics', 'desk')['json']['items'], 'id'), true), 'cannot be chosen on new jobs');
    ok(in_array($raju, array_column(get('/mechanics/daily', 'admin')['json']['items'], 'id'), true), 'still in today\'s summary: paid today');
    eq('Raju', tval('SELECT m.name FROM job_cards j JOIN users m ON m.id = j.mechanic_id WHERE j.id = ?', [$job]), 'old job keeps his name');
    status(200, put('/users/' . $raju, ['active' => true], 'admin'), 'brought back from Users');

    eq(409, del('/users/1', 'admin')['status'], 'not yourself');
    eq(403, del('/users/' . $GLOBALS['T_SUNIL'], 'desk')['status'], 'only the owner');
    eq(404, del('/users/99999', 'admin')['status']);
});
