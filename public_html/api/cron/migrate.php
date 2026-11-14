<?php
declare(strict_types=1);

/*
 * Apply new database changes: api/migrations/NNN_name.sql, in name order, each exactly once.
 * Run by the deploy script (tools/cpanel-deploy.sh) right after the new code is copied, or by hand:
 *   php ~/<site folder>/api/cron/migrate.php            apply what is pending
 *   php ~/<site folder>/api/cron/migrate.php --status   list applied / pending, change nothing
 *   --dir=<folder>  read migrations from another folder (tests)
 * Applied names are kept in schema_migrations. A fresh install from database/schema.sql already contains
 * every migration and lists them there, so nothing runs twice.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
require dirname(__DIR__) . '/lib/bootstrap.php';

/** Statements of a migration file: "--" comment lines dropped, split at ";" ending a line. */
function migration_statements(string $sql): array
{
    $lines = array_filter(preg_split('/\R/', $sql) ?: [], static fn ($l) => !preg_match('/^\s*--/', $l));
    $parts = preg_split('/;\s*(?:\R|$)/', implode("\n", $lines)) ?: [];
    return array_values(array_filter(array_map('trim', $parts), static fn ($s) => $s !== ''));
}

$opts = getopt('', ['dir:', 'status']);
$dir = rtrim((string) ($opts['dir'] ?? MIGRATIONS_DIR), '/\\');

try {
    ensure_migrations_table();
    $done = array_column(rows('SELECT name FROM schema_migrations ORDER BY name'), 'name');
    $pending = pending_migrations($dir);

    if (isset($opts['status'])) {
        foreach ($done as $n) {
            echo "applied  $n\n";
        }
        foreach ($pending as $f) {
            echo 'pending  ' . basename($f) . "\n";
        }
        exit(0);
    }

    foreach ($pending as $f) {
        $name = basename($f);
        echo now() . " migrate: $name\n";
        foreach (migration_statements((string) file_get_contents($f)) as $stmt) {
            db()->exec($stmt);
        }
        q('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [$name, now()]);
    }
    echo now() . ' migrate: ' . count($pending) . ' applied, ' . count($done) . " already done\n";
} catch (Throwable $e) {
    fwrite(STDERR, now() . ' migrate FAILED: ' . $e->getMessage() . "\n");
    exit(1);
}
