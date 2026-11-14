<?php
declare(strict_types=1);

const TOKEN_TTL = 30 * 24 * 3600;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MINUTES = 10;

/** Fields only owner and inventory manager may see. Removed from every response for other roles. */
const COST_FIELDS = [
    'last_purchase_price', 'last_purchase_disc_pct', 'avg_cost', 'unit_cost', 'net_cost',
    'cost_value', 'stock_value', 'cost_total', 'margin', 'margin_pct', 'purchase_price', 'profit',
];

function b64url(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64url_decode(string $s): string|false
{
    return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
}

function jwt_secret(): string
{
    $s = (string) config('jwt_secret', '');
    if (strlen($s) < 32) {
        fail(500, 'weak_secret', 'jwt_secret in config.php must be at least 32 characters');
    }
    return $s;
}

function jwt_encode(array $payload): string
{
    $h = b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $p = b64url(json_encode($payload));
    $sig = b64url(hash_hmac('sha256', "$h.$p", jwt_secret(), true));
    return "$h.$p.$sig";
}

function jwt_decode(string $token): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }
    [$h, $p, $sig] = $parts;
    $expected = b64url(hash_hmac('sha256', "$h.$p", jwt_secret(), true));
    if (!hash_equals($expected, $sig)) {
        return null;
    }
    $header = json_decode((string) b64url_decode($h), true);
    if (($header['alg'] ?? '') !== 'HS256') {
        return null;
    }
    $payload = json_decode((string) b64url_decode($p), true);
    if (!is_array($payload) || ($payload['exp'] ?? 0) < time()) {
        return null;
    }
    return $payload;
}

/** Short fingerprint of the password hash: tokens die when the password changes. */
function password_fingerprint(string $hash): string
{
    return substr(hash('sha256', $hash), 0, 12);
}

function issue_token(array $user): string
{
    return jwt_encode([
        'sub' => (int) $user['id'],
        'role' => $user['role'],
        'pf' => password_fingerprint($user['password_hash']),
        'iat' => time(),
        'exp' => time() + TOKEN_TTL,
    ]);
}

/** Token from Authorization: Bearer or X-Auth-Token (some cPanel hosts strip Authorization). */
function request_token(): ?string
{
    $candidates = [
        $_SERVER['HTTP_AUTHORIZATION'] ?? null,
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null,
    ];
    if (function_exists('apache_request_headers')) {
        $h = array_change_key_case(apache_request_headers(), CASE_LOWER);
        $candidates[] = $h['authorization'] ?? null;
    }
    foreach ($candidates as $c) {
        if ($c && preg_match('/^Bearer\s+(\S+)$/i', trim($c), $m)) {
            return $m[1];
        }
    }
    $x = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? null;
    return $x ? trim($x) : null;
}

/** The logged-in user, or null. Validates token, active flag and password fingerprint. */
function user_or_null(): ?array
{
    if (array_key_exists('GM_USER', $GLOBALS)) {
        return $GLOBALS['GM_USER'];
    }
    $GLOBALS['GM_USER'] = null;
    $token = request_token();
    if (!$token) {
        return null;
    }
    $payload = jwt_decode($token);
    if (!$payload) {
        return null;
    }
    $u = row('SELECT * FROM users WHERE id = ?', [(int) $payload['sub']]);
    if (!$u || !(int) $u['active'] || password_fingerprint($u['password_hash']) !== ($payload['pf'] ?? '')) {
        return null;
    }
    return $GLOBALS['GM_USER'] = $u;
}

function current_user(): array
{
    $u = user_or_null();
    if (!$u) {
        fail(401, 'unauthorized', 'Please log in again');
    }
    return $u;
}

function uid(): int
{
    return (int) current_user()['id'];
}

function is_role(string ...$roles): bool
{
    $u = user_or_null();
    return $u !== null && in_array($u['role'], $roles, true);
}

function require_role(string ...$roles): array
{
    $u = current_user();
    if (!in_array($u['role'], $roles, true)) {
        fail(403, 'forbidden', 'You do not have permission for this action');
    }
    return $u;
}

function can_see_cost(): bool
{
    return is_role(ROLE_OWNER, ROLE_INVENTORY);
}

/** Remove cost fields from a row (recursively for nested arrays) unless the user may see them. */
function strip_cost(array $data): array
{
    if (can_see_cost()) {
        return $data;
    }
    return strip_cost_force($data);
}

function strip_cost_force(array $data): array
{
    foreach ($data as $k => $v) {
        if (is_string($k) && in_array($k, COST_FIELDS, true)) {
            unset($data[$k]);
        } elseif (is_array($v)) {
            $data[$k] = strip_cost_force($v);
        }
    }
    return $data;
}

/** Public view of a user row. */
function public_user(array $u): array
{
    return [
        'id' => (int) $u['id'],
        'name' => $u['name'],
        'username' => $u['username'],
        'phone' => $u['phone'],
        'role' => $u['role'],
        'language' => $u['language'],
        'must_change_password' => (int) $u['must_change_password'],
        'active' => (int) $u['active'],
        'last_login_at' => $u['last_login_at'] ?? null,
    ];
}

/* ------------------------------------------------------------------ login rate limit */

function login_locked(string $username, string $ip): bool
{
    $since = date('Y-m-d H:i:s', time() - LOGIN_LOCK_MINUTES * 60);
    // Failures since the last success in the window
    $lastOk = val('SELECT MAX(id) FROM login_attempts WHERE username = ? AND ip = ? AND success = 1', [$username, $ip]) ?? 0;
    $fails = (int) val(
        'SELECT COUNT(*) FROM login_attempts WHERE username = ? AND ip = ? AND success = 0 AND created_at >= ? AND id > ?',
        [$username, $ip, $since, (int) $lastOk]
    );
    return $fails >= LOGIN_MAX_FAILS;
}

function record_login_attempt(string $username, string $ip, bool $success): void
{
    insert('login_attempts', ['username' => $username, 'ip' => $ip, 'success' => $success ? 1 : 0]);
    if (random_int(1, 50) === 1) {
        q('DELETE FROM login_attempts WHERE created_at < ?', [date('Y-m-d H:i:s', time() - 86400 * 30)]);
    }
}

function validate_new_password(string $pw): void
{
    if (mb_strlen($pw) < 8) {
        fail(422, 'weak_password', 'Password must be at least 8 characters', ['new_password' => 'too_short']);
    }
}
