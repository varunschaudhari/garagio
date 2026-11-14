<?php
declare(strict_types=1);

/*
 * Owner tools for going live: a system health check and the one-time "remove trial data" reset.
 */

/** Transaction tables, children before parents, so foreign keys stay on during the wipe. */
const GO_LIVE_WIPE = [
    'payment_allocations', 'customer_payments', 'invoice_items', 'invoices',
    'estimate_items', 'estimates', 'job_parts', 'part_request_items', 'part_requests',
    'job_labour', 'job_photos', 'job_cards',
    'purchase_items', 'supplier_payments', 'purchases',
    'stock_counts', 'mechanic_payments', // stock_movements: stock_restart_ledger()
    'notifications', 'message_log', 'login_attempts', 'counters',
];

const DEMO_NAME_SQL = "name LIKE '%(Demo)'";

/* ------------------------------------------------------------------ go-live reset */

route('GET', '/admin/go-live', function () {
    return [
        'live_since' => setting('live_since', '') ?: null,
        'counts' => [
            'jobs' => (int) val('SELECT COUNT(*) FROM job_cards'),
            'invoices' => (int) val('SELECT COUNT(*) FROM invoices'),
            'purchases' => (int) val('SELECT COUNT(*) FROM purchases'),
            'payments' => (int) val('SELECT COUNT(*) FROM customer_payments') + (int) val('SELECT COUNT(*) FROM supplier_payments'),
            'movements' => (int) val('SELECT COUNT(*) FROM stock_movements'),
            'photos' => (int) val('SELECT COUNT(*) FROM job_photos'),
            'parts' => (int) val('SELECT COUNT(*) FROM parts'),
            'parts_in_stock' => (int) val('SELECT COUNT(*) FROM parts WHERE current_stock > 0'),
            'customers' => (int) val('SELECT COUNT(*) FROM customers'),
            'customers_demo' => (int) val('SELECT COUNT(*) FROM customers WHERE ' . DEMO_NAME_SQL),
            'suppliers' => (int) val('SELECT COUNT(*) FROM suppliers'),
            'suppliers_demo' => (int) val('SELECT COUNT(*) FROM suppliers WHERE ' . DEMO_NAME_SQL),
        ],
    ];
}, ['roles' => [ROLE_OWNER]]);

route('POST', '/admin/go-live', function () {
    $u = current_user();
    $in = clean(body(), [
        'confirm' => 'str|req|max:20',
        'password' => 'str|req|max:200',
        'parts' => 'enum:keep,zero,delete|def:keep',
        'contacts' => 'enum:demo,all,keep|def:demo',
    ]);
    if ($in['confirm'] !== 'RESET') {
        fail(422, 'validation_failed', 'Type RESET to confirm', ['confirm' => 'invalid']);
    }
    if (!password_verify($in['password'], $u['password_hash'])) {
        fail(422, 'wrong_password', 'Password is wrong', ['password' => 'wrong']);
    }

    // Safety net first: a full backup the owner can restore from phpMyAdmin.
    try {
        $backup = basename(backup_database(BACKUP_KEEP_FOREVER));
    } catch (Throwable $e) {
        log_error($e);
        fail(500, 'backup_failed', 'Could not take a backup, so nothing was removed. Check the backup folder in config.php.');
    }

    $result = tx(function () use ($in) {
        // job_cards points back at estimates / invoices; break that loop before deleting.
        q('UPDATE job_cards SET approved_estimate_id = NULL, invoice_id = NULL');
        $removed = [];
        foreach (GO_LIVE_WIPE as $table) {
            $removed[$table] = q("DELETE FROM `$table`")->rowCount();
        }

        // Ledger and balances restart at zero (stock.php owns current_stock)...
        $had = stock_restart_ledger();
        if ($in['parts'] === 'delete') {
            $removed['parts'] = q('DELETE FROM parts')->rowCount();
        } elseif ($in['parts'] === 'keep') {
            // ...then today's quantities come back as opening stock at their current average cost.
            foreach ($had as $partId => [$qty, $avg]) {
                if ($qty > 0) {
                    stock_move($partId, $qty, 'opening', 'part', $partId, $avg, 'Opening stock (go live)');
                }
            }
        }

        if ($in['contacts'] !== 'keep') {
            $where = $in['contacts'] === 'demo' ? ' WHERE ' . DEMO_NAME_SQL : '';
            $removed['vehicles'] = q("DELETE FROM vehicles WHERE customer_id IN (SELECT id FROM customers$where)")->rowCount();
            $removed['customers'] = q("DELETE FROM customers$where")->rowCount();
            $removed['suppliers'] = q("DELETE FROM suppliers$where")->rowCount();
        }
        // Service dates came from the removed jobs.
        q('UPDATE vehicles SET last_service_on = NULL, last_service_odometer = NULL');

        save_setting('live_since', today());
        return $removed;
    });

    remove_dir_contents(API_DIR . '/storage/photos');
    settings_all(true);
    audit('go_live_reset', 'system', null, null, ['backup' => $backup, 'parts' => $in['parts'], 'contacts' => $in['contacts'], 'removed' => $result]);
    return ['ok' => true, 'backup' => $backup, 'removed' => $result, 'live_since' => today()];
}, ['roles' => [ROLE_OWNER]]);

/** Delete everything inside $dir (not $dir itself). Only used for our own storage folders. */
function remove_dir_contents(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $f) {
        if ($f->isDir() && !$f->isLink()) {
            @rmdir($f->getPathname());
        } else {
            @unlink($f->getPathname());
        }
    }
}

/* ------------------------------------------------------------------ health check */

route('GET', '/admin/health', function () {
    $checks = [];
    // value: data shown as-is (versions, dates, counts); note: a code the client translates (system.note.*).
    $add = function (string $key, string $status, $value = null, ?string $note = null) use (&$checks) {
        $checks[] = ['key' => $key, 'status' => $status, 'value' => $value, 'note' => $note];
    };

    $add('php_version', version_compare(PHP_VERSION, '8.1.0', '>=') ? 'ok' : 'fail', PHP_VERSION);
    $missing = array_values(array_filter(['pdo_mysql', 'mbstring', 'zlib', 'curl', 'openssl'], static fn ($e) => !extension_loaded($e)));
    $add('php_extensions', $missing ? 'fail' : 'ok', $missing ? implode(', ', $missing) : null);
    $add('db_version', 'ok', (string) val('SELECT VERSION()'));

    $expected = ['settings', 'users', 'parts', 'stock_movements', 'invoices', 'invoice_items', 'payment_allocations', 'audit_log', 'counters'];
    $have = array_map(static fn ($r) => $r[array_key_first($r)], rows('SHOW TABLES'));
    $missingTables = array_values(array_diff($expected, $have));
    $hasLabourCol = !$missingTables && (bool) row("SHOW COLUMNS FROM invoice_items LIKE 'job_labour_id'");
    $add('db_schema', !$missingTables && $hasLabourCol ? 'ok' : 'fail', $missingTables ? implode(', ', $missingTables) : ($hasLabourCol ? null : 'invoice_items.job_labour_id'));

    $url = (string) config('app_url', '');
    $add('app_url_https', str_starts_with($url, 'https://') ? 'ok' : 'warn', $url ?: null);
    $secret = (string) config('jwt_secret', '');
    $add('jwt_secret', strlen($secret) >= 32 && !str_starts_with($secret, 'CHANGE_ME') ? 'ok' : 'fail');
    $add('debug_off', config('debug', false) ? 'warn' : 'ok');
    $add('cors', in_array('*', (array) config('cors_origins', []), true) ? 'warn' : 'ok');

    $storage = API_DIR . '/storage';
    $add('storage_writable', is_dir($storage) && is_writable($storage) ? 'ok' : 'fail');

    try {
        $dir = backup_dir();
        $writable = is_writable($dir);
        $outside = backup_dir_outside_web($dir);
        $add('backup_dir', !$writable ? 'fail' : ($outside ? 'ok' : 'warn'), null, !$writable ? 'not_writable' : ($outside ? null : 'inside_web'));
        $latest = list_backups()[0] ?? null;
        $age = $latest ? (time() - strtotime($latest['created_at'])) / 3600 : null;
        $add('last_backup', $latest === null ? 'warn' : ($age > 36 ? 'warn' : 'ok'), $latest['created_at'] ?? null);
    } catch (Throwable $e) {
        $add('backup_dir', 'fail', null, 'cannot_create');
    }

    foreach (['cron_reminders_at', 'cron_backup_at'] as $k) {
        $at = setting($k, '') ?: null;
        $add($k, $at && (time() - strtotime($at)) < 36 * 3600 ? 'ok' : 'warn', $at);
    }

    // Bills say "Tax Invoice" and charge GST, so billing without a GSTIN is a real problem, not a reminder.
    $add('shop_gstin', setting('shop_gstin') ? 'ok' : 'fail', setting('shop_gstin') ?: null);
    $add('shop_address', setting('shop_address') && setting('shop_phone') ? 'ok' : 'warn');
    $demo = (int) val('SELECT COUNT(*) FROM customers WHERE ' . DEMO_NAME_SQL) + (int) val('SELECT COUNT(*) FROM suppliers WHERE ' . DEMO_NAME_SQL);
    $add('demo_data', $demo ? 'warn' : 'ok', $demo ?: null);
    $defaultPw = 0;
    foreach (rows('SELECT password_hash FROM users WHERE active = 1') as $r) {
        $defaultPw += password_verify('garage123', $r['password_hash']) ? 1 : 0;
    }
    $add('default_passwords', $defaultPw ? 'warn' : 'ok', $defaultPw ?: null);
    $add('live_since', setting('live_since') ? 'ok' : 'warn', setting('live_since') ?: null);

    $worst = in_array('fail', array_column($checks, 'status'), true) ? 'fail' : (in_array('warn', array_column($checks, 'status'), true) ? 'warn' : 'ok');
    return ['status' => $worst, 'checks' => $checks, 'server_time' => now(), 'app' => ['php' => PHP_VERSION, 'sapi' => PHP_SAPI]];
}, ['roles' => [ROLE_OWNER]]);
