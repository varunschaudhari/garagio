<?php
declare(strict_types=1);

/*
 * Database backup in pure PHP (shared hosts often disable exec(), so no mysqldump).
 * Writes a gzipped .sql file to config('backup_dir') - keep that folder outside public_html - and
 * keeps the newest BACKUP_KEEP files.
 */

const BACKUP_KEEP = 14;
const BACKUP_PATTERN = '/^garage-(golive-)?\d{8}-\d{6}\.sql\.gz$/';
/** Backups taken before a go-live reset are kept for good (never pruned). */
const BACKUP_KEEP_FOREVER = 'golive';

/** Folder names that hosts serve to the web; a backup must never sit below one of them. */
const WEB_FOLDER_NAMES = ['public_html', 'www', 'htdocs', 'httpdocs', 'wwwroot', 'html'];

function backup_dir(): string
{
    $dir = rtrim((string) config('backup_dir', dirname(WEB_ROOT) . '/backups'), '/\\');
    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException("Cannot create backup folder $dir");
    }
    // Defence in depth: if the folder ever ends up inside a website (e.g. a subdomain installed in
    // public_html/garage puts the default "../backups" in public_html), Apache still refuses to serve it.
    if (!is_file("$dir/.htaccess") && is_writable($dir)) {
        @file_put_contents("$dir/.htaccess", "Require all denied\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
        @file_put_contents("$dir/index.html", '');
    }
    return $dir;
}

/**
 * Is the backup folder outside every website folder? False when it is inside this site, or below a
 * folder the host serves (public_html, www, …) - which covers a subdomain installed in public_html/<sub>.
 */
function backup_dir_outside_web(string $dir): bool
{
    $real = realpath($dir);
    $web = realpath(WEB_ROOT);
    if ($real === false || $web === false) {
        return false;
    }
    $norm = static fn (string $p) => rtrim(str_replace('\\', '/', $p), '/') . '/';
    $cmp = PHP_OS_FAMILY === 'Windows' ? 'strtolower' : static fn ($x) => $x;
    if (str_starts_with($cmp($norm($real)), $cmp($norm($web)))) {
        return false;
    }
    $segments = array_map($cmp, explode('/', trim($norm($real), '/')));
    return !array_intersect($segments, WEB_FOLDER_NAMES);
}

/** Dump every table (structure + data) and return the file path. $tag 'golive' keeps the file forever. */
function backup_database(string $tag = ''): string
{
    $dir = backup_dir();
    $file = $dir . '/garage-' . ($tag ? "$tag-" : '') . date('Ymd-His') . '.sql.gz';
    $gz = gzopen($file, 'wb6');
    if (!$gz) {
        throw new RuntimeException("Cannot write $file");
    }
    $pdo = db();
    gzwrite($gz, "-- Garage Manager backup " . now() . "\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n");
    foreach ($pdo->query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"')->fetchAll(PDO::FETCH_NUM) as [$table]) {
        $create = $pdo->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_NUM)[1];
        gzwrite($gz, "DROP TABLE IF EXISTS `$table`;\n$create;\n\n");
        $st = $pdo->query("SELECT * FROM `$table`", PDO::FETCH_ASSOC);
        $batch = [];
        foreach ($st as $row) {
            $vals = array_map(static fn ($v) => $v === null ? 'NULL' : (is_int($v) || is_float($v) ? (string) $v : $pdo->quote((string) $v)), array_values($row));
            $batch[] = '(' . implode(',', $vals) . ')';
            if (count($batch) >= 200) {
                gzwrite($gz, "INSERT INTO `$table` VALUES\n" . implode(",\n", $batch) . ";\n");
                $batch = [];
            }
        }
        if ($batch) {
            gzwrite($gz, "INSERT INTO `$table` VALUES\n" . implode(",\n", $batch) . ";\n");
        }
        gzwrite($gz, "\n");
    }
    gzwrite($gz, "SET FOREIGN_KEY_CHECKS = 1;\n");
    gzclose($gz);
    prune_backups($dir);
    return $file;
}

/** Remove our own old backup files beyond the newest BACKUP_KEEP. */
function prune_backups(string $dir): void
{
    $files = array_values(array_filter(list_backups(), static fn ($f) => !str_contains($f['name'], '-' . BACKUP_KEEP_FOREVER . '-')));
    foreach (array_slice($files, BACKUP_KEEP) as $f) {
        if (preg_match(BACKUP_PATTERN, $f['name'])) {
            @unlink($dir . '/' . $f['name']);
        }
    }
}

/** Newest first. */
function list_backups(): array
{
    $dir = backup_dir();
    $out = [];
    foreach (scandir($dir) ?: [] as $name) {
        if (preg_match(BACKUP_PATTERN, $name)) {
            $out[] = ['name' => $name, 'size' => filesize("$dir/$name"), 'created_at' => date('Y-m-d H:i:s', filemtime("$dir/$name"))];
        }
    }
    // Newest first by time (names with a tag would not sort by date).
    usort($out, static fn ($a, $b) => [$b['created_at'], $b['name']] <=> [$a['created_at'], $a['name']]);
    return $out;
}
