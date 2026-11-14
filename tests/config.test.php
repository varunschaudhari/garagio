<?php
// Configuration used by tests/run.php (database is dropped and recreated on every run).
return [
    'db' => [
        'host' => getenv('GM_TEST_DB_HOST') ?: '127.0.0.1',
        'port' => (int) (getenv('GM_TEST_DB_PORT') ?: 3307),
        'name' => 'garage_test',
        'user' => getenv('GM_TEST_DB_USER') ?: 'root',
        'pass' => getenv('GM_TEST_DB_PASS') !== false ? getenv('GM_TEST_DB_PASS') : 'devroot',
    ],
    'jwt_secret' => 'test-secret-test-secret-test-secret-0123456789',
    'app_url' => 'http://127.0.0.1:8099',
    'backup_dir' => sys_get_temp_dir() . '/garagio-test-backups',
    'debug' => true,
    'cors_origins' => [],
    'push_disabled' => true,
    'push_outbox' => sys_get_temp_dir() . '/garagio-test-push.jsonl',
    // Canned Gemini answer instead of calling Google (job card scan tests).
    'ai_stub' => __DIR__ . '/fixtures/gemini-jobcard.json',
];
