<?php
declare(strict_types=1);

/*
 * Test runner.
 *   docker compose up -d          (MySQL on 127.0.0.1:3307)
 *   php tests/run.php             run everything
 *   php tests/run.php gst         only tests whose name contains "gst"
 *
 * The garage_test database is dropped and rebuilt from database/schema.sql + seed.sql each run.
 */

require __DIR__ . '/lib/harness.php';

$configPath = __DIR__ . '/config.test.php';
$GLOBALS['T_CFG'] = require $configPath;

echo "Resetting test database…\n";
reset_database($GLOBALS['T_CFG']);
// The seed is for Trimurti Auto, not yet GST-registered. Most billing tests check GST maths, so the test
// shop is registered (without a GSTIN, so the health check still has something to flag); 08_golive.php
// switches registration off to test plain bills.
test_pdo($GLOBALS['T_CFG'])->exec("UPDATE settings SET svalue = '1' WHERE skey = 'gst_registered'");

// Load the API libraries in-process for unit tests of pure functions.
putenv('GM_CONFIG=' . $configPath);
require dirname(__DIR__) . '/public_html/api/lib/bootstrap.php';
restore_error_handler();

$server = start_server($configPath, 8099);
register_shutdown_function(static fn () => stop_server($server));

foreach (glob(__DIR__ . '/cases/*.php') as $file) {
    require $file;
}

echo "Running tests…\n";
exit(run_tests($argv[1] ?? null));
