<?php
// Config for Playwright runs: database garage_e2e is rebuilt before each run.
// GM_TEST_DB_* override the local Docker MySQL (CI uses its own service container).
return [
    'db' => [
        'host' => getenv('GM_TEST_DB_HOST') ?: '127.0.0.1',
        'port' => (int) (getenv('GM_TEST_DB_PORT') ?: 3307),
        'name' => 'garage_e2e',
        'user' => getenv('GM_TEST_DB_USER') ?: 'root',
        'pass' => getenv('GM_TEST_DB_PASS') !== false ? getenv('GM_TEST_DB_PASS') : 'devroot',
    ],
    'jwt_secret' => 'e2e-secret-e2e-secret-e2e-secret-e2e-secret-0123',
    'app_url' => 'http://127.0.0.1:8098',
    'backup_dir' => sys_get_temp_dir() . '/garagio-e2e-backups',
    'debug' => true,
    'cors_origins' => [],
    'push_disabled' => true,
];
