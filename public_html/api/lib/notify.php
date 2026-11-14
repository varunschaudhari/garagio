<?php
declare(strict_types=1);

/*
 * In-app notifications (bell list) plus best-effort Expo push.
 * Push failures never break the request that triggered them.
 */

/**
 * @param int[]  $userIds
 * @param string $type   e.g. request_new, approval_needed, parts_issued, parts_unavailable, bike_ready
 * @param array  $text   ['title_key' => i18n key, 'vars' => [...]] - each user gets it in their language
 */
function notify_users(array $userIds, string $type, string $titleKey, string $bodyKey, array $vars = [], ?string $link = null): void
{
    $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds))));
    if (!$userIds) {
        return;
    }
    $me = user_or_null();
    $users = rows('SELECT id, language, push_token FROM users WHERE active = 1 AND id IN (' . placeholders($userIds) . ')', $userIds);
    $pushes = [];
    foreach ($users as $u) {
        if ($me && (int) $me['id'] === (int) $u['id']) {
            continue; // do not notify yourself
        }
        $title = tr($titleKey, $u['language'], $vars);
        $body = tr($bodyKey, $u['language'], $vars);
        insert('notifications', [
            'user_id' => $u['id'],
            'type' => $type,
            'title' => mb_substr($title, 0, 150),
            'body' => mb_substr($body, 0, 255),
            'link' => $link,
        ]);
        if ($u['push_token'] && str_starts_with($u['push_token'], 'ExponentPushToken')) {
            $pushes[] = [
                'to' => $u['push_token'],
                'title' => $title,
                'body' => $body,
                'sound' => 'default',
                'priority' => 'high',
                'channelId' => 'default',
                'data' => ['type' => $type, 'link' => $link],
            ];
        }
    }
    if ($pushes) {
        $GLOBALS['GM_PENDING_PUSH'] = array_merge($GLOBALS['GM_PENDING_PUSH'] ?? [], $pushes);
        if (!isset($GLOBALS['GM_PUSH_SHUTDOWN'])) {
            $GLOBALS['GM_PUSH_SHUTDOWN'] = true;
            // Send after the response so a slow push service never delays the user.
            register_shutdown_function('flush_pushes');
        }
    }
}

/** Users with any of the given roles. */
function user_ids_with_role(string ...$roles): array
{
    return array_map('intval', array_column(
        rows('SELECT id FROM users WHERE active = 1 AND role IN (' . placeholders($roles) . ')', $roles),
        'id'
    ));
}

function flush_pushes(): void
{
    $messages = $GLOBALS['GM_PENDING_PUSH'] ?? [];
    $GLOBALS['GM_PENDING_PUSH'] = [];
    if (!$messages) {
        return;
    }
    // Tests / local dev: write pushes to a file instead of calling Expo.
    if ($outbox = config('push_outbox')) {
        foreach ($messages as $m) {
            @file_put_contents($outbox, json_encode_api($m) . "\n", FILE_APPEND);
        }
        return;
    }
    if (config('push_disabled')) {
        return;
    }
    if (function_exists('fastcgi_finish_request')) {
        @fastcgi_finish_request();
    }
    foreach (array_chunk($messages, 100) as $chunk) {
        try {
            $ch = curl_init('https://exp.host/--/api/v2/push/send');
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
                CURLOPT_POSTFIELDS => json_encode($chunk),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 8,
            ]);
            curl_exec($ch);
            curl_close($ch);
        } catch (Throwable $e) {
            log_error($e);
        }
    }
}
