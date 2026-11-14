<?php
// Config for Playwright runs: database garage_e2e is rebuilt before each run.
return [
    'db' => ['host' => '127.0.0.1', 'port' => 3307, 'name' => 'garage_e2e', 'user' => 'root', 'pass' => 'devroot'],
    'jwt_secret' => 'e2e-secret-e2e-secret-e2e-secret-e2e-secret-0123',
    'app_url' => 'http://127.0.0.1:8098',
    'backup_dir' => sys_get_temp_dir() . '/garagio-e2e-backups',
    'debug' => true,
    'cors_origins' => [],
    'push_disabled' => true,
];
