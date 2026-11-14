<?php
declare(strict_types=1);

route('GET', '/users', function () {
    $items = array_map('public_user', rows('SELECT * FROM users ORDER BY active DESC, role, name'));
    return ['items' => $items, 'total' => count($items)];
}, ['roles' => [ROLE_OWNER]]);

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
