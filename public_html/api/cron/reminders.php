<?php
declare(strict_types=1);

/*
 * Daily cron (cPanel → Cron Jobs, 8 AM):
 *   php ~/public_html/api/cron/reminders.php
 * Builds the service / payment reminder list and tells the owner and front desk how many are waiting.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
require dirname(__DIR__) . '/lib/bootstrap.php';
foreach (glob(dirname(__DIR__) . '/routes/*.php') as $f) {
    require $f;
}
$due = reminders_due();
$s = count($due['service']);
$p = count($due['payment']);
if ($s + $p > 0) {
    notify_users(user_ids_with_perm('customers'), 'reminders_due', 'notify.reminders_title', 'notify.reminders_body', ['service' => $s, 'payment' => $p], '#/reminders');
    flush_pushes();
}
save_setting('cron_reminders_at', now());
echo now() . " reminders: service=$s payment=$p\n";
