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

route('POST', '/users', function () {
    $in = clean(body(), [
        'name' => 'str|req|max:100',
        'username' => 'username|req',
        'phone' => 'phone',
        'role' => 'enum:' . implode(',', ROLES) . '|req',
        'language' => 'lang',
        'password' => 'str|req|max:200',
    ]);
    validate_new_password($in['password']);
    $id = insert('users', [
        'name' => $in['name'],
        'username' => $in['username'],
        'phone' => $in['phone'] ?? null,
        'role' => $in['role'],
        'language' => $in['language'] ?? 'mr',
        'password_hash' => password_hash($in['password'], PASSWORD_BCRYPT),
        'must_change_password' => 1,
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
        'phone' => 'phone',
        'role' => 'enum:' . implode(',', ROLES),
        'language' => 'lang',
        'active' => 'bool',
        'reset_password' => 'str|max:200',
    ], true);
    if ($id === uid() && ((isset($in['active']) && !$in['active']) || (isset($in['role']) && $in['role'] !== ROLE_OWNER))) {
        fail(409, 'cannot_demote_self', 'You cannot deactivate yourself or change your own role');
    }
    if (isset($in['name']) && $in['name'] === null) {
        unset($in['name']);
    }
    $data = $in;
    unset($data['reset_password']);
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
