<?php
declare(strict_types=1);

/*
 * Loads configuration and every library file. Included by index.php and by cron scripts.
 */

date_default_timezone_set('Asia/Kolkata');
mb_internal_encoding('UTF-8');

define('API_DIR', dirname(__DIR__));
define('WEB_ROOT', dirname(API_DIR));

$cfgFile = getenv('GM_CONFIG') ?: API_DIR . '/config.php';
if (!is_file($cfgFile)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Server not configured: copy api/config.sample.php to api/config.php', 'code' => 'not_configured']);
    exit;
}
$GLOBALS['GM_CONFIG'] = require $cfgFile;

/** Read a config value with dot notation, e.g. config('db.host'). */
function config(string $key, $default = null)
{
    $node = $GLOBALS['GM_CONFIG'];
    foreach (explode('.', $key) as $part) {
        if (!is_array($node) || !array_key_exists($part, $node)) {
            return $default;
        }
        $node = $node[$part];
    }
    return $node;
}

require __DIR__ . '/http.php';
require __DIR__ . '/db.php';
require __DIR__ . '/util.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/router.php';
require __DIR__ . '/stock.php';
require __DIR__ . '/gst.php';
require __DIR__ . '/i18n.php';
require __DIR__ . '/notify.php';
require __DIR__ . '/jobs.php';
require __DIR__ . '/reminders.php';
require __DIR__ . '/backup.php';
require __DIR__ . '/migrations.php';
require __DIR__ . '/jobcard.php';

set_error_handler(static function (int $no, string $msg, string $file, int $line): bool {
    if (!(error_reporting() & $no)) {
        return false;
    }
    throw new ErrorException($msg, 0, $no, $file, $line);
});
