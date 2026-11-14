<?php
declare(strict_types=1);

/*
 * Garage Manager API - single entry point.
 * Pretty URLs (/api/parts/5) via .htaccess, or index.php?r=/parts/5 on hosts without mod_rewrite.
 */

require __DIR__ . '/lib/bootstrap.php';

foreach (glob(__DIR__ . '/routes/*.php') as $routeFile) {
    require $routeFile;
}

dispatch();
