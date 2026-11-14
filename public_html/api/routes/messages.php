<?php
declare(strict_types=1);

/* Reminders to send on WhatsApp (service due, payment due). Front desk / owner open each link. */
route('GET', '/messages/due', function () {
    return reminders_due();
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

/* ------------------------------------------------------------------ backups (owner) */

route('GET', '/backups', function () {
    return ['items' => list_backups(), 'dir_outside_web' => backup_dir_outside_web(backup_dir())];
}, ['roles' => [ROLE_OWNER]]);

route('POST', '/backups', function () {
    $file = backup_database();
    audit('backup', 'backup', null, null, ['file' => basename($file)]);
    return ['item' => ['name' => basename($file), 'size' => filesize($file)]];
}, ['roles' => [ROLE_OWNER]]);

route('GET', '/backups/latest', function () {
    $list = list_backups();
    if (!$list) {
        not_found('Backup');
    }
    $file = backup_dir() . '/' . $list[0]['name'];
    return new RawResponse((string) file_get_contents($file), 'application/gzip', 200, ['Content-Disposition' => 'attachment; filename="' . $list[0]['name'] . '"']);
}, ['roles' => [ROLE_OWNER]]);
