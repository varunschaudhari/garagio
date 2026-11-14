<?php
declare(strict_types=1);

$GLOBALS['GM_ROUTES'] = [];

/**
 * Register a route.
 * $opts:
 *   'public' => true       no login needed
 *   'roles'  => [...]      allowed roles (default: any logged-in user)
 *   'pw'     => true       allowed while the user must still change the password
 */
function route(string $method, string $pattern, callable $handler, array $opts = []): void
{
    $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', rtrim($pattern, '/')) . '/?$#';
    $GLOBALS['GM_ROUTES'][] = [strtoupper($method), $regex, $handler, $opts];
}

/** Path after /api, from ?r= (hosts without mod_rewrite) or the request URI. */
function request_path(): string
{
    if (isset($_GET['r']) && is_string($_GET['r'])) {
        $p = '/' . ltrim($_GET['r'], '/');
    } else {
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $uri = rawurldecode($uri);
        $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php')), '/');
        if ($base !== '' && str_starts_with($uri, $base)) {
            $uri = substr($uri, strlen($base));
        }
        if (str_starts_with($uri, '/index.php')) {
            $uri = substr($uri, strlen('/index.php'));
        }
        $p = $uri === '' ? '/' : $uri;
    }
    return rtrim($p, '/') ?: '/';
}

function cors_headers(): void
{
    $origins = (array) config('cors_origins', []);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && (in_array('*', $origins, true) || in_array($origin, $origins, true))) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Max-Age: 86400');
    }
}

function dispatch(): void
{
    cors_headers();
    header('X-Content-Type-Options: nosniff');
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if ($method === 'OPTIONS') {
        http_response_code(204);
        return;
    }
    if ($method === 'HEAD') {
        $method = 'GET';
    }
    $path = request_path();

    try {
        $allowed = [];
        foreach ($GLOBALS['GM_ROUTES'] as [$m, $regex, $handler, $opts]) {
            if (!preg_match($regex, $path, $match)) {
                continue;
            }
            if ($m !== $method) {
                $allowed[] = $m;
                continue;
            }
            $params = array_filter($match, 'is_string', ARRAY_FILTER_USE_KEY);
            if (empty($opts['public'])) {
                $u = current_user();
                if ((int) $u['must_change_password'] && empty($opts['pw'])) {
                    fail(403, 'password_change_required', 'Please change your password first');
                }
                if (!empty($opts['roles']) && !in_array($u['role'], $opts['roles'], true)) {
                    fail(403, 'forbidden', 'You do not have permission for this action');
                }
            }
            $result = $handler($params);
            if ($result instanceof RawResponse) {
                send_raw($result);
            } else {
                send_json($result ?? ['ok' => true]);
            }
            return;
        }
        if ($allowed) {
            fail(405, 'method_not_allowed', 'Method not allowed');
        }
        fail(404, 'not_found', 'Unknown endpoint ' . $path);
    } catch (ApiError $e) {
        $out = ['error' => $e->getMessage(), 'code' => $e->errCode];
        if ($e->fields) {
            $out['fields'] = $e->fields;
        }
        send_json($out, $e->status);
    } catch (PDOException $e) {
        // Duplicate key → 409 with a readable message
        if (($e->errorInfo[1] ?? 0) === 1062) {
            send_json(['error' => 'This record already exists (duplicate value)', 'code' => 'duplicate'], 409);
            return;
        }
        log_error($e);
        send_json(['error' => config('debug') ? $e->getMessage() : 'Database error', 'code' => 'server_error'], 500);
    } catch (Throwable $e) {
        log_error($e);
        send_json(['error' => config('debug') ? $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine() : 'Server error', 'code' => 'server_error'], 500);
    }
}

function log_error(Throwable $e): void
{
    $dir = API_DIR . '/storage/logs';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    @file_put_contents(
        $dir . '/error-' . date('Y-m') . '.log',
        '[' . now() . '] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n" . $e->getTraceAsString() . "\n\n",
        FILE_APPEND
    );
}
