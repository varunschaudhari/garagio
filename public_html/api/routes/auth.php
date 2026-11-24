<?php
declare(strict_types=1);

/* Public info for the login screen and for the app's server-address check. */
route('GET', '/public/info', function () {
    $s = settings_all();
    return [
        'app' => 'garage-manager',
        'shop_name' => $s['shop_name'],
        'shop_name_mr' => $s['shop_name_mr'],
        'shop_full_name' => shop_full_name('en'),
        'shop_full_name_mr' => shop_full_name('mr'),
        'min_app_version' => $s['min_app_version'],
        'latest_app_url' => $s['latest_app_url'],
        'server_time' => now(),
        // Deployed commit (written by tools/cpanel-deploy.sh): CI checks it to confirm a deploy landed.
        'commit' => deployed_version()['commit'] ?? null,
    ];
}, ['public' => true]);

route('POST', '/auth/login', function () {
    $in = clean(body(), ['username' => 'str|req|max:50', 'password' => 'str|req|max:200']);
    $username = strtolower($in['username']);
    $ip = client_ip();
    if (login_locked($username, $ip)) {
        fail(429, 'login_locked', 'Too many failed attempts. Try again in ' . LOGIN_LOCK_MINUTES . ' minutes.');
    }
    $u = row('SELECT * FROM users WHERE username = ?', [$username]);
    if (!$u || $u['password_hash'] === null || !password_verify($in['password'], $u['password_hash'])) {
        record_login_attempt($username, $ip, false);
        fail(401, 'bad_credentials', 'Wrong username or password');
    }
    if (!(int) $u['active']) {
        record_login_attempt($username, $ip, false);
        fail(403, 'user_inactive', 'This user is deactivated. Contact the owner.');
    }
    record_login_attempt($username, $ip, true);
    if (password_needs_rehash($u['password_hash'], PASSWORD_BCRYPT)) {
        $u['password_hash'] = password_hash($in['password'], PASSWORD_BCRYPT);
        q('UPDATE users SET password_hash = ? WHERE id = ?', [$u['password_hash'], $u['id']]);
    }
    q('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), $u['id']]);
    $GLOBALS['GM_USER'] = $u;
    return ['token' => issue_token($u), 'user' => public_user($u)];
}, ['public' => true]);

route('GET', '/auth/me', function () {
    $u = current_user();
    return ['user' => public_user($u), 'can_see_cost' => can_see_cost()];
}, ['pw' => true]);

route('POST', '/auth/password', function () {
    $u = current_user();
    $in = clean(body(), ['current_password' => 'str|req|max:200', 'new_password' => 'str|req|max:200']);
    if (!password_verify($in['current_password'], $u['password_hash'])) {
        fail(422, 'wrong_password', 'Current password is wrong', ['current_password' => 'wrong']);
    }
    validate_new_password($in['new_password']);
    if ($in['new_password'] === $in['current_password']) {
        fail(422, 'same_password', 'New password must be different', ['new_password' => 'same']);
    }
    $hash = password_hash($in['new_password'], PASSWORD_BCRYPT);
    update_row('users', (int) $u['id'], ['password_hash' => $hash, 'must_change_password' => 0]);
    audit('password_change', 'user', (int) $u['id']);
    $u = row('SELECT * FROM users WHERE id = ?', [$u['id']]);
    return ['token' => issue_token($u), 'user' => public_user($u)];
}, ['pw' => true]);

route('POST', '/auth/push-token', function () {
    $in = clean(body(), ['token' => 'str|max:255']);
    update_row('users', uid(), ['push_token' => $in['token'] ?? null]);
    return ['ok' => true];
}, ['pw' => true]);

route('POST', '/auth/language', function () {
    $in = clean(body(), ['language' => 'lang|req']);
    update_row('users', uid(), ['language' => $in['language']]);
    return ['ok' => true, 'language' => $in['language']];
}, ['pw' => true]);
