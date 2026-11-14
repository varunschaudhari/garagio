<?php
declare(strict_types=1);

/*
 * Database changes after the first release: api/migrations/NNN_short_name.sql, applied in name order by
 * cron/migrate.php (the deploy script runs it). Every change must also be made in database/schema.sql,
 * with an INSERT INTO schema_migrations line, so a fresh install starts with them all applied.
 */

const MIGRATIONS_DIR = API_DIR . '/migrations';

function ensure_migrations_table(): void
{
    db()->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(190) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}

/** Migration files not applied yet, in the order they must run. */
function pending_migrations(string $dir = MIGRATIONS_DIR): array
{
    $files = glob(rtrim($dir, '/\\') . '/*.sql') ?: [];
    sort($files, SORT_STRING);
    $done = array_column(rows('SELECT name FROM schema_migrations'), 'name', 'name');
    return array_values(array_filter($files, static fn ($f) => !isset($done[basename($f)])));
}

/** What the deploy script recorded (commit, time), or null on a manual upload. */
function deployed_version(): ?array
{
    $file = API_DIR . '/storage/deploy.json';
    if (!is_file($file)) {
        return null;
    }
    $j = json_decode((string) file_get_contents($file), true);
    return is_array($j) ? pick($j, ['commit', 'branch', 'deployed_at']) : null;
}
