<?php
declare(strict_types=1);

/*
 * Tiny test harness: test registry, assertions, HTTP client, DB reset, server start/stop.
 */

// Same clock as the API (lib/bootstrap.php), so date('Y-m-d') in tests matches the server's "today".
date_default_timezone_set('Asia/Kolkata');

const DEMO_PASSWORD = 'garage123';
const NEW_PASSWORD = 'Trimurti@2026';

$GLOBALS['T_TESTS'] = [];
$GLOBALS['T_TOKENS'] = [];
$GLOBALS['T_BASE'] = '';

final class AssertionFailed extends Exception
{
}

function test(string $name, callable $fn): void
{
    $GLOBALS['T_TESTS'][] = [$name, $fn];
}

function ok($cond, string $msg = 'expected true'): void
{
    if (!$cond) {
        throw new AssertionFailed($msg);
    }
}

function eq($expected, $actual, string $msg = ''): void
{
    $same = is_float($expected) || is_float($actual)
        ? abs((float) $expected - (float) $actual) < 0.005
        : $expected === $actual;
    if (!$same) {
        throw new AssertionFailed(($msg ? "$msg: " : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function status(int $expected, array $res, string $msg = ''): array
{
    if ($res['status'] !== $expected) {
        throw new AssertionFailed(($msg ? "$msg: " : '') . "expected HTTP $expected, got {$res['status']}: " . substr($res['body'], 0, 400));
    }
    return $res['json'] ?? [];
}

/* ------------------------------------------------------------------ HTTP */

function http(string $method, string $path, ?array $body = null, ?string $token = null, array $headers = []): array
{
    $ch = curl_init($GLOBALS['T_BASE'] . '/api' . $path);
    $h = ['Accept: application/json'];
    if ($body !== null) {
        $h[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    if ($token) {
        $h[] = 'Authorization: Bearer ' . $token;
    }
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => array_merge($h, $headers),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    $out = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    $json = str_contains($type, 'json') ? json_decode((string) $out, true) : null;
    return ['status' => $code, 'json' => $json, 'body' => (string) $out, 'type' => $type];
}

function get(string $path, string $as): array
{
    return http('GET', $path, null, token($as));
}

function post(string $path, array $body, string $as): array
{
    return http('POST', $path, $body, token($as));
}

function put(string $path, array $body, string $as): array
{
    return http('PUT', $path, $body, token($as));
}

function del(string $path, string $as): array
{
    return http('DELETE', $path, null, token($as));
}

/** Token for a seeded user; changes the demo password on first use. */
function token(string $username): string
{
    if (isset($GLOBALS['T_TOKENS'][$username])) {
        return $GLOBALS['T_TOKENS'][$username];
    }
    $res = http('POST', '/auth/login', ['username' => $username, 'password' => NEW_PASSWORD]);
    if ($res['status'] !== 200) {
        $res = http('POST', '/auth/login', ['username' => $username, 'password' => DEMO_PASSWORD]);
        $j = status(200, $res, "login $username");
        $res = http('POST', '/auth/password', ['current_password' => DEMO_PASSWORD, 'new_password' => NEW_PASSWORD], $j['token']);
        $j = status(200, $res, "change password $username");
        return $GLOBALS['T_TOKENS'][$username] = $j['token'];
    }
    return $GLOBALS['T_TOKENS'][$username] = status(200, $res)['token'];
}

/* ------------------------------------------------------------------ database */

function test_pdo(array $cfg, bool $withDb = true): PDO
{
    $c = $cfg['db'];
    $dsn = "mysql:host={$c['host']};port={$c['port']};charset=utf8mb4" . ($withDb ? ";dbname={$c['name']}" : '');
    return new PDO($dsn, $c['user'], $c['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
}

function tdb(): PDO
{
    static $pdo = null;
    return $pdo ??= test_pdo($GLOBALS['T_CFG']);
}

function tval(string $sql, array $p = [])
{
    $st = tdb()->prepare($sql);
    $st->execute($p);
    return $st->fetchColumn();
}

function trows(string $sql, array $p = []): array
{
    $st = tdb()->prepare($sql);
    $st->execute($p);
    return $st->fetchAll();
}

/** Split a .sql file into statements (handles quotes and -- comments). */
function split_sql(string $sql): array
{
    $out = [];
    $buf = '';
    $len = strlen($sql);
    $quote = null;
    for ($i = 0; $i < $len; $i++) {
        $ch = $sql[$i];
        if ($quote === null && $ch === '-' && ($sql[$i + 1] ?? '') === '-') {
            $nl = strpos($sql, "\n", $i);
            $i = $nl === false ? $len : $nl;
            $buf .= "\n";
            continue;
        }
        if ($quote !== null) {
            $buf .= $ch;
            if ($ch === '\\') {
                $buf .= $sql[++$i] ?? '';
            } elseif ($ch === $quote) {
                $quote = null;
            }
            continue;
        }
        if ($ch === "'" || $ch === '"' || $ch === '`') {
            $quote = $ch;
        }
        if ($ch === ';') {
            if (trim($buf) !== '') {
                $out[] = trim($buf);
            }
            $buf = '';
            continue;
        }
        $buf .= $ch;
    }
    if (trim($buf) !== '') {
        $out[] = trim($buf);
    }
    return $out;
}

function reset_database(array $cfg): void
{
    $root = test_pdo($cfg, false);
    $name = $cfg['db']['name'];
    $root->exec("DROP DATABASE IF EXISTS `$name`");
    $root->exec("CREATE DATABASE `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo = test_pdo($cfg);
    $pdo->exec("SET time_zone = '+05:30'");
    foreach (['schema.sql', 'seed.sql'] as $file) {
        foreach (split_sql((string) file_get_contents(dirname(__DIR__, 2) . '/database/' . $file)) as $stmt) {
            $pdo->exec($stmt);
        }
    }
}

/* ------------------------------------------------------------------ server */

function start_server(string $configPath, int $port)
{
    $root = realpath(dirname(__DIR__, 2));
    $cmd = [PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $root . '/public_html', $root . '/tools/dev-router.php'];
    $env = getenv();
    $env['GM_CONFIG'] = $configPath;
    $env['PHP_CLI_SERVER_WORKERS'] = '4';
    $nul = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $nul, 'w'], 2 => ['file', $nul, 'w']], $pipes, $root, $env, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        throw new RuntimeException('Could not start PHP server');
    }
    $GLOBALS['T_BASE'] = "http://127.0.0.1:$port";
    for ($i = 0; $i < 50; $i++) {
        $fp = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.2);
        if ($fp) {
            fclose($fp);
            return $proc;
        }
        usleep(100000);
    }
    throw new RuntimeException("PHP server did not start on port $port");
}

function stop_server($proc): void
{
    if (!is_resource($proc)) {
        return;
    }
    $status = proc_get_status($proc);
    if (PHP_OS_FAMILY === 'Windows') {
        exec('taskkill /F /T /PID ' . (int) $status['pid'] . ' 2>NUL');
    } else {
        proc_terminate($proc);
    }
    proc_close($proc);
}

/* ------------------------------------------------------------------ runner */

function run_tests(?string $filter): int
{
    $pass = 0;
    $failed = [];
    $start = microtime(true);
    foreach ($GLOBALS['T_TESTS'] as [$name, $fn]) {
        if ($filter && stripos($name, $filter) === false) {
            continue;
        }
        try {
            $fn();
            $pass++;
            echo "  \033[32m✓\033[0m $name\n";
        } catch (Throwable $e) {
            $failed[] = $name;
            $where = $e instanceof AssertionFailed ? '' : ' (' . get_class($e) . ' @ ' . basename($e->getFile()) . ':' . $e->getLine() . ')';
            echo "  \033[31m✗ $name\033[0m\n      " . $e->getMessage() . "$where\n";
        }
    }
    printf("\n%d passed, %d failed in %.1fs\n", $pass, count($failed), microtime(true) - $start);
    return $failed ? 1 : 0;
}
