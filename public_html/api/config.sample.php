<?php
/*
 * Copy this file to config.php and fill in your values.
 * config.php is blocked from web access by .htaccess.
 */
return [
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'cpaneluser_garage',   // cPanel → MySQL Databases
        'user' => 'cpaneluser_garage',
        'pass' => 'CHANGE_ME',
    ],

    // At least 32 random characters. Changing it logs everyone out.
    // Generate one at https://www.random.org/strings/ or run: php -r "echo bin2hex(random_bytes(32));"
    'jwt_secret' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING_OF_64_CHARACTERS_OR_MORE_0000',

    // Public address of the site, used in WhatsApp estimate links. No trailing slash.
    'app_url' => 'https://trimurti.foreverstory.in',

    // Where nightly database backups are written. Keep it OUTSIDE public_html.
    // On cPanel always write the full path: /home/<cpanel-user>/backups
    // (The fallback "one folder above the site" is inside public_html when a subdomain's
    // document root is public_html/<sub> - Settings → System flags that.)
    'backup_dir' => dirname(__DIR__, 2) . '/backups',

    // Show real error messages in API responses. Keep false on the live site.
    'debug' => false,

    // Allowed browser origins for cross-site API calls. Not needed for the web app
    // (same site) or the Android app. Use ['*'] only for local development.
    'cors_origins' => [],

    // Reading photos of handwritten paper job cards (New job → "Scan paper job card"), optional.
    // Create the key in Google AI Studio for a Google Cloud project WITH BILLING ENABLED: on the free
    // tier Google may use the photos (customer names, phone numbers) to improve its products and people
    // may read them. Leave empty to switch the feature off.
    'gemini_api_key' => '',
    'gemini_model' => 'gemini-3.8-flash',

    // Set true to stop sending Expo push notifications (in-app notifications still work).
    'push_disabled' => false,
];
