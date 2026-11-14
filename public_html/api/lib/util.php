<?php
declare(strict_types=1);

const ROLE_OWNER = 'owner';
const ROLE_INVENTORY = 'inventory';
const ROLE_DESK = 'front_desk';
const ROLE_MECHANIC = 'mechanic';
const ROLES = [ROLE_OWNER, ROLE_INVENTORY, ROLE_DESK, ROLE_MECHANIC];

const PAY_MODES = ['cash', 'upi', 'card', 'bank', 'credit'];

function now(): string
{
    return date('Y-m-d H:i:s');
}

function today(): string
{
    return date('Y-m-d');
}

/** Round money / quantity to 2 decimals, avoiding -0. */
function r2(float $v): float
{
    $r = round($v + 0.0, 2);
    return $r == 0.0 ? 0.0 : $r;
}

/* ------------------------------------------------------------------ settings */

const SETTING_DEFAULTS = [
    'shop_name' => 'Trimurti Auto',
    'shop_name_mr' => 'त्रिमूर्ती ऑटो',
    'shop_address' => '',
    'shop_address_mr' => '',
    'shop_phone' => '',
    'shop_email' => '',
    'shop_gstin' => '',
    'shop_state_code' => '27',
    'shop_state_name' => 'Maharashtra',
    'job_prefix' => 'JC-',
    'estimate_prefix' => 'EST-',
    'invoice_prefix' => 'INV',
    'bill_prefix' => 'BIL',
    'gst_registered' => '1',
    'prices_include_gst' => '1',
    'default_part_gst_rate' => '18',
    'labour_gst_rate' => '18',
    'labour_sac' => '998714',
    'approval_limit' => '1000',
    'service_reminder_days' => '90',
    'service_reminder_km' => '3000',
    'payment_reminder_days' => '7',
    'estimate_link_days' => '7',
    'invoice_terms_en' => 'Goods once sold will not be taken back. Subject to local jurisdiction.',
    'invoice_terms_mr' => 'एकदा विकलेला माल परत घेतला जाणार नाही. स्थानिक न्यायक्षेत्राच्या अधीन.',
    'upi_id' => '',
    'min_app_version' => '1.0.0',
    'latest_app_url' => '',
    'receipt_width' => '80',
    // Written by the system, not editable in Settings:
    'live_since' => '',
    'cron_reminders_at' => '',
    'cron_backup_at' => '',
];

/** Validation rules for PUT /settings (owner). */
const SETTING_RULES = [
    'shop_name' => 'str|req|max:100',
    'shop_name_mr' => 'str|max:100',
    'shop_address' => 'str|max:255',
    'shop_address_mr' => 'str|max:255',
    'shop_phone' => 'str|max:40',
    'shop_email' => 'str|max:100',
    'shop_gstin' => 'gstin',
    'shop_state_code' => 'state',
    'shop_state_name' => 'str|max:40',
    'job_prefix' => 'str|max:6',
    'estimate_prefix' => 'str|max:6',
    'invoice_prefix' => 'str|max:4',
    'bill_prefix' => 'str|max:4',
    'gst_registered' => 'bool',
    'prices_include_gst' => 'bool',
    'default_part_gst_rate' => 'num|min:0|max:40',
    'labour_gst_rate' => 'num|min:0|max:40',
    'labour_sac' => 'str|max:10',
    'approval_limit' => 'num|min:0|max:1000000',
    'service_reminder_days' => 'int|min:1|max:730',
    'service_reminder_km' => 'int|min:100|max:50000',
    'payment_reminder_days' => 'int|min:1|max:365',
    'estimate_link_days' => 'int|min:1|max:60',
    'invoice_terms_en' => 'text|max:1000',
    'invoice_terms_mr' => 'text|max:1000',
    'upi_id' => 'str|max:60',
    'min_app_version' => 'str|max:12',
    'latest_app_url' => 'str|max:255',
    'receipt_width' => 'enum:58,80',
];

function settings_all(bool $refresh = false): array
{
    static $cache = null;
    if ($cache === null || $refresh) {
        $cache = SETTING_DEFAULTS;
        foreach (rows('SELECT skey, svalue FROM settings') as $r) {
            $cache[$r['skey']] = $r['svalue'];
        }
    }
    return $cache;
}

function setting(string $key, ?string $default = null): ?string
{
    $all = settings_all();
    return array_key_exists($key, $all) ? $all[$key] : $default;
}

function setting_num(string $key): float
{
    return (float) setting($key, '0');
}

function save_setting(string $key, $value): void
{
    $v = $value === null ? null : (string) $value;
    $now = now();
    q(
        'INSERT INTO settings (skey, svalue, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE svalue = VALUES(svalue), updated_at = VALUES(updated_at)',
        [$key, $v, $now, $now]
    );
}

/* ------------------------------------------------------------------ numbering */

/** Next value of a named counter. Must run inside a transaction (row is locked). */
function next_counter(string $key): int
{
    $now = now();
    q('INSERT IGNORE INTO counters (ckey, cval, created_at, updated_at) VALUES (?, 0, ?, ?)', [$key, $now, $now]);
    $cur = (int) val('SELECT cval FROM counters WHERE ckey = ? FOR UPDATE', [$key]);
    $next = $cur + 1;
    q('UPDATE counters SET cval = ?, updated_at = ? WHERE ckey = ?', [$next, $now, $key]);
    return $next;
}

/** Financial year label for a date: 2026-11-13 → "26-27"; 2027-02-01 → "26-27". */
function fy_label(?string $date = null): string
{
    $ts = strtotime($date ?? today());
    $y = (int) date('Y', $ts);
    $start = ((int) date('n', $ts) >= 4) ? $y : $y - 1;
    return sprintf('%02d-%02d', $start % 100, ($start + 1) % 100);
}

function next_job_no(): string
{
    return setting('job_prefix', 'JC-') . str_pad((string) next_counter('job'), 4, '0', STR_PAD_LEFT);
}

function next_estimate_no(): string
{
    return setting('estimate_prefix', 'EST-') . str_pad((string) next_counter('estimate'), 4, '0', STR_PAD_LEFT);
}

/** INV/26-27/00001 - per financial year, max 16 characters (GST rule 46). */
function next_invoice_no(string $date): string
{
    $fy = fy_label($date);
    // Tax invoices (GST-registered) and plain bills (not registered) are separate series, each from 00001.
    $prefix = gst_registered() ? setting('invoice_prefix', 'INV') : setting('bill_prefix', 'BIL');
    $n = next_counter('invoice_' . $prefix . '_' . $fy);
    $no = $prefix . '/' . $fy . '/' . str_pad((string) $n, 5, '0', STR_PAD_LEFT);
    if (strlen($no) > 16) {
        fail(409, 'invoice_no_too_long', 'Invoice number exceeds 16 characters; shorten the invoice prefix in Settings');
    }
    return $no;
}

/* ------------------------------------------------------------------ audit */

function audit(string $action, string $entity, ?int $entityId, $before = null, $after = null): void
{
    $u = user_or_null();
    insert('audit_log', [
        'user_id' => $u['id'] ?? null,
        'action' => $action,
        'entity' => $entity,
        'entity_id' => $entityId,
        'before_json' => $before === null ? null : json_encode_api($before),
        'after_json' => $after === null ? null : json_encode_api($after),
        'ip' => PHP_SAPI === 'cli' ? 'cli' : client_ip(),
    ]);
}

/** Fields of $after that differ from $before. */
function changed_fields(array $before, array $after): array
{
    $diff = [];
    foreach ($after as $k => $v) {
        if (!array_key_exists($k, $before) || (string) $before[$k] !== (string) $v) {
            $diff[$k] = $v;
        }
    }
    return $diff;
}

/** Pick keys from an array. */
function pick(array $src, array $keys): array
{
    return array_intersect_key($src, array_flip($keys));
}

/** Random URL-safe token of $bytes random bytes. */
function random_token(int $bytes = 32): string
{
    return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
}

/** Absolute base URL of the site (no trailing slash), from config or the request. */
function app_url(): string
{
    // GM_APP_URL: set by tools/serve-lan.ps1 so estimate links work from a phone on the same Wi-Fi.
    $cfg = rtrim((string) (getenv('GM_APP_URL') ?: config('app_url', '')), '/');
    if ($cfg !== '') {
        return $cfg;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php', 2)), '/');
    return ($https ? 'https' : 'http') . '://' . $host . $base;
}
