<?php
declare(strict_types=1);

route('GET', '/users', function () {
    $items = array_map('public_user', rows('SELECT * FROM users ORDER BY active DESC, role, name'));
    // Role defaults, so the screen can show which ticks differ from a person's role.
    $defaults = [];
    foreach (ROLES as $r) {
        $defaults[$r] = user_perms(['role' => $r, 'permissions' => null]);
    }
    return ['items' => $items, 'total' => count($items), 'permissions' => array_keys(PERMISSIONS), 'role_defaults' => $defaults];
}, ['roles' => [ROLE_OWNER]]);

/**
 * Merge ticks sent by the owner ({key: bool}) into a user's stored overrides; keeps only what differs
 * from the role's defaults. Returns the JSON to store (null = role defaults).
 */
function merge_permissions(?string $stored, $sent, string $role): ?string
{
    if (!is_array($sent)) {
        fail(422, 'validation_failed', 'Permissions must be a list of on / off values', ['permissions' => 'invalid']);
    }
    $over = json_decode((string) $stored, true) ?: [];
    foreach ($sent as $key => $value) {
        if (!array_key_exists((string) $key, PERMISSIONS)) {
            fail(422, 'validation_failed', 'Unknown permission ' . $key, ['permissions' => 'invalid']);
        }
        $on = filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
        if ($on === null) {
            fail(422, 'validation_failed', 'Permission values are on / off', ['permissions' => 'invalid']);
        }
        $over[$key] = $on;
    }
    foreach ($over as $key => $on) {
        if (!array_key_exists($key, PERMISSIONS) || $on === in_array($role, PERMISSIONS[$key], true)) {
            unset($over[$key]);
        }
    }
    ksort($over);
    return $over ? json_encode($over) : null;
}

route('GET', '/users/mechanics', function () {
    $items = rows("SELECT id, name, phone FROM users WHERE role = 'mechanic' AND active = 1 ORDER BY name");
    return ['items' => $items, 'total' => count($items)];
});

/** A login ID nobody else has. */
function check_username_free(string $username, int $exceptId = 0): void
{
    if (val('SELECT id FROM users WHERE username = ? AND id <> ?', [$username, $exceptId])) {
        fail(422, 'validation_failed', 'This login ID is already used', ['username' => 'taken']);
    }
}

/**
 * New person. `login` false (mechanics only): no login ID or password - he is given jobs and paid but never
 * opens the app. Everyone else needs a login ID and a temporary password.
 */
route('POST', '/users', function () {
    $in = clean(body(), [
        'name' => 'str|req|max:100',
        'username' => 'username',
        'phone' => 'phone',
        'role' => 'enum:' . implode(',', ROLES) . '|req',
        'language' => 'lang',
        'password' => 'str|max:200',
        'login' => 'bool',
    ]);
    $login = $in['role'] !== ROLE_MECHANIC || ($in['login'] ?? 1) !== 0;
    if ($login) {
        $missing = array_filter(['username' => empty($in['username']) ? 'required' : null, 'password' => empty($in['password']) ? 'required' : null]);
        if ($missing) {
            fail(422, 'validation_failed', 'A login ID and a password are needed', $missing);
        }
        validate_new_password($in['password']);
        check_username_free($in['username']);
    }
    $id = insert('users', [
        'name' => $in['name'],
        'username' => $login ? $in['username'] : null,
        'phone' => $in['phone'] ?? null,
        'role' => $in['role'],
        'language' => $in['language'] ?? 'mr',
        'password_hash' => $login ? password_hash($in['password'], PASSWORD_BCRYPT) : null,
        'must_change_password' => $login ? 1 : 0,
        'active' => 1,
    ]);
    $u = row('SELECT * FROM users WHERE id = ?', [$id]);
    audit('user_create', 'user', $id, null, public_user($u));
    return ['item' => public_user($u)];
}, ['roles' => [ROLE_OWNER]]);

route('PUT', '/users/{id}', function ($p) {
    $id = (int) $p['id'];
    $before = row('SELECT * FROM users WHERE id = ?', [$id]) ?? not_found('User');
    $in = clean(body(), [
        'name' => 'str|max:100',
        'username' => 'username',
        'phone' => 'phone',
        'role' => 'enum:' . implode(',', ROLES),
        'language' => 'lang',
        'active' => 'bool',
        'reset_password' => 'str|max:200',
        'login' => 'bool',
    ], true);
    if ($id === uid() && ((isset($in['active']) && !$in['active']) || (isset($in['role']) && $in['role'] !== ROLE_OWNER) || ($in['login'] ?? 1) === 0)) {
        fail(409, 'cannot_demote_self', 'You cannot deactivate yourself or change your own role');
    }
    if (isset($in['name']) && $in['name'] === null) {
        unset($in['name']);
    }
    $data = $in;
    unset($data['reset_password'], $data['login'], $data['username']);
    // Login ID: the owner may change it (it works from the next login; open sessions stay). Only a mechanic may
    // be without a login; giving him one later needs a login ID and a password.
    $role = $in['role'] ?? $before['role'];
    $hadLogin = $before['password_hash'] !== null;
    $login = array_key_exists('login', $in) && $in['login'] !== null ? $in['login'] === 1 : ($hadLogin || !empty($in['username']));
    if (!$login && $role !== ROLE_MECHANIC) {
        fail(422, 'login_required', 'Only a mechanic can be without a login', ['login' => 'invalid']);
    }
    if ($login) {
        $username = array_key_exists('username', $in) ? $in['username'] : $before['username'];
        $missing = array_filter(['username' => empty($username) ? 'required' : null, 'reset_password' => !$hadLogin && empty($in['reset_password']) ? 'required' : null]);
        if ($missing) {
            fail(422, 'validation_failed', 'A login ID and a password are needed', $missing);
        }
        if ($username !== $before['username']) {
            check_username_free($username, $id);
            $data['username'] = $username;
        }
    } elseif ($hadLogin) {
        // Login taken away: open sessions end (no password left to match the token).
        $data += ['username' => null, 'password_hash' => null, 'push_token' => null, 'must_change_password' => 0];
        unset($in['reset_password']);
    }
    $body = body();
    if (array_key_exists('permissions', $body)) {
        if (($in['role'] ?? $before['role']) === ROLE_OWNER) {
            fail(422, 'validation_failed', 'Owners always have every permission', ['permissions' => 'invalid']);
        }
        $data['permissions'] = merge_permissions($before['permissions'] ?? null, $body['permissions'], $in['role'] ?? $before['role']);
    }
    if (!empty($in['reset_password'])) {
        validate_new_password($in['reset_password']);
        $data['password_hash'] = password_hash($in['reset_password'], PASSWORD_BCRYPT);
        $data['must_change_password'] = 1;
    }
    tx(function () use ($id, $data, $before) {
        update_row('users', $id, $data);
        // never leave the shop without an active owner
        if ($before['role'] === ROLE_OWNER) {
            $owners = (int) val("SELECT COUNT(*) FROM users WHERE role = 'owner' AND active = 1");
            if ($owners === 0) {
                fail(409, 'last_owner', 'At least one active owner is required');
            }
        }
    });
    $after = row('SELECT * FROM users WHERE id = ?', [$id]);
    $diff = changed_fields(public_user($before), public_user($after));
    if (!empty($in['reset_password'])) {
        $diff['password'] = 'reset';
    }
    audit('user_update', 'user', $id, pick(public_user($before), array_keys($diff)), $diff);
    return ['item' => public_user($after)];
}, ['roles' => [ROLE_OWNER]]);

/**
 * Remove a person. Nobody who appears in the shop's records is deleted: if anything points at them (jobs, bills,
 * pay, requests, the activity log...) they are only hidden (inactive), so old records keep their name. A mechanic
 * with open jobs must hand them over first.
 */
route('DELETE', '/users/{id}', function ($p) {
    $id = (int) $p['id'];
    $u = row('SELECT * FROM users WHERE id = ?', [$id]) ?? not_found('User');
    if ($id === uid()) {
        fail(409, 'cannot_demote_self', 'You cannot remove yourself');
    }
    $open = (int) val("SELECT COUNT(*) FROM job_cards WHERE mechanic_id = ? AND status IN ('" . implode("','", JOB_OPEN) . "')", [$id]);
    if ($open) {
        fail(409, 'mechanic_has_open_jobs', "This mechanic still has $open open job(s); give them to someone else first");
    }
    if ($u['role'] === ROLE_OWNER && (int) $u['active'] && (int) val("SELECT COUNT(*) FROM users WHERE role = 'owner' AND active = 1") <= 1) {
        fail(409, 'last_owner', 'At least one active owner is required');
    }
    $deleted = true;
    try {
        q('DELETE FROM users WHERE id = ?', [$id]);
    } catch (PDOException $e) {
        if ((int) ($e->errorInfo[1] ?? 0) !== 1451) { // 1451: still referenced by other rows
            throw $e;
        }
        $deleted = false;
        update_row('users', $id, ['active' => 0, 'push_token' => null]);
    }
    audit($deleted ? 'user_delete' : 'user_hide', 'user', $id, public_user($u), $deleted ? null : ['active' => 0]);
    return ['deleted' => $deleted, 'hidden' => !$deleted];
}, ['roles' => [ROLE_OWNER]]);
