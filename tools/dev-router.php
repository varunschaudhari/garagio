<?php
/*
 * Router for PHP's built-in server, mimicking the .htaccess rules:
 *   php -S 127.0.0.1:8080 -t public_html tools/dev-router.php
 */
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$root = realpath(__DIR__ . '/../public_html');

if (preg_match('#^/api/(lib|routes|templates|cron|storage)(/|$)#', $uri) || preg_match('#^/api/config(\.sample)?\.php#', $uri)) {
    http_response_code(403);
    echo 'Forbidden';
    return true;
}

if (preg_match('#^/e/([A-Za-z0-9_-]+)(/approve|/call)?/?$#', $uri, $m)) {
    $_GET['r'] = '/e/' . $m[1] . ($m[2] ?? '');
    $_SERVER['SCRIPT_NAME'] = '/api/index.php';
    require $root . '/api/index.php';
    return true;
}

if ($uri === '/api' || str_starts_with($uri, '/api/')) {
    if (is_file($root . $uri) && !str_ends_with($uri, '.php')) {
        return false;
    }
    $_SERVER['SCRIPT_NAME'] = '/api/index.php';
    require $root . '/api/index.php';
    return true;
}

// Static files; "/" → index.html
if ($uri === '/' || !is_file($root . $uri)) {
    if ($uri === '/' || !str_contains(basename($uri), '.')) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($root . '/index.html');
        return true;
    }
}
if (str_ends_with($uri, '.js')) {
    header('Content-Type: text/javascript; charset=utf-8');
    readfile($root . $uri);
    return true;
}
return false;
