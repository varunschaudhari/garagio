<?php
declare(strict_types=1);

/* ------------------------------------------------------------------ settings */

route('GET', '/settings', function () {
    $s = settings_all();
    return ['settings' => $s, 'states' => GST_STATES];
}, ['pw' => true]);

route('PUT', '/settings', function () {
    $in = clean(body(), SETTING_RULES, true);
    $before = settings_all();
    tx(function () use ($in) {
        foreach ($in as $k => $v) {
            save_setting($k, $v ?? '');
        }
    });
    $after = settings_all(true);
    audit('settings_update', 'settings', null, pick($before, array_keys($in)), pick($after, array_keys($in)));
    return ['settings' => $after];
}, ['roles' => [ROLE_OWNER]]);

/* ------------------------------------------------------------------ simple bilingual masters */

/**
 * Register GET / POST / PUT for a name_en + name_mr master table.
 */
function master_routes(string $path, string $table, array $extraRules, array $writeRoles, string $orderBy): void
{
    $rules = ['name_en' => 'str|req|max:100', 'name_mr' => 'str|max:100', 'active' => 'bool'] + $extraRules;

    route('GET', $path, function () use ($table, $orderBy) {
        $where = qp('all') ? '1=1' : 'active = 1';
        $items = rows("SELECT * FROM `$table` WHERE $where ORDER BY $orderBy");
        return ['items' => $items, 'total' => count($items)];
    });

    route('POST', $path, function () use ($table, $rules) {
        $in = clean(body(), $rules);
        $in['active'] = $in['active'] ?? 1;
        $id = insert($table, $in);
        return ['item' => row("SELECT * FROM `$table` WHERE id = ?", [$id])];
    }, ['roles' => $writeRoles]);

    route('PUT', $path . '/{id}', function ($p) use ($table, $rules) {
        $id = (int) $p['id'];
        $before = row("SELECT * FROM `$table` WHERE id = ?", [$id]) ?? not_found();
        $in = clean(body(), $rules, true);
        update_row($table, $id, $in);
        if ($table === 'labour_rates' && isset($in['amount']) && (float) $before['amount'] !== (float) $in['amount']) {
            audit('labour_rate_change', 'labour_rate', $id, ['amount' => $before['amount']], ['amount' => $in['amount']]);
        }
        return ['item' => row("SELECT * FROM `$table` WHERE id = ?", [$id])];
    }, ['roles' => $writeRoles]);
}

master_routes('/locations', 'storage_locations', ['sort_order' => 'int|min:0|max:9999|def:0'], [ROLE_OWNER, ROLE_INVENTORY], 'sort_order, id');
master_routes('/categories', 'categories', [], [ROLE_OWNER, ROLE_INVENTORY], 'name_en');
master_routes('/labour-rates', 'labour_rates', ['amount' => 'num|req|min:0|max:1000000'], [ROLE_OWNER], 'name_en');
