<?php
declare(strict_types=1);

/*
 * Nightly cron (cPanel → Cron Jobs, 11 PM):
 *   php ~/public_html/api/cron/backup.php
 * Writes a gzipped SQL dump to backup_dir (outside public_html) and keeps the newest 14.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
require dirname(__DIR__) . '/lib/bootstrap.php';
$file = backup_database();
save_setting('cron_backup_at', now());
echo now() . ' backup: ' . $file . ' (' . filesize($file) . " bytes)\n";
