<?php
// Rebuild a local database from database/schema.sql + seed.sql.
//   php tools/reset-dev-db.php                                → garage_dev (public_html/api/config.php)
//   php tools/reset-dev-db.php tests/e2e/config.e2e.php --e2e → garage_e2e, demo users ready to log in
require __DIR__ . '/../tests/lib/harness.php';
$cfgPath = $argv[1] ?? (__DIR__ . '/../public_html/api/config.php');
$cfg = require $cfgPath;
reset_database($cfg);
if (in_array('--e2e', $argv, true)) {
    $pdo = test_pdo($cfg);
    // Every demo user except "desk" skips the first-login password change, so specs can log in directly.
    $pdo->exec("UPDATE users SET must_change_password = 0 WHERE username <> 'desk'");
    // Owner, stock and desk use English in specs; mechanics stay Marathi to exercise the Marathi UI.
    $pdo->exec("UPDATE users SET language = 'en' WHERE username IN ('admin', 'stock', 'desk')");
}
echo "{$cfg['db']['name']} rebuilt. Log in as admin / garage123\n";
