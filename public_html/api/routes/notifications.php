<?php
declare(strict_types=1);

/* In-app notifications (bell). Clients poll every 20 s while open. */

route('GET', '/notifications', function () {
    $uid = uid();
    $where = 'user_id = ?';
    if (qp('unread')) {
        $where .= ' AND read_at IS NULL';
    }
    $since = qp_int('since_id');
    $params = [$uid];
    if ($since) {
        $where .= ' AND id > ?';
        $params[] = $since;
    }
    $items = rows("SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE $where ORDER BY id DESC LIMIT 50", $params);
    $unread = (int) val('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', [$uid]);
    return ['items' => $items, 'unread' => $unread];
});

route('POST', '/notifications/read', function () {
    $body = body();
    $uid = uid();
    if (!empty($body['all'])) {
        q('UPDATE notifications SET read_at = ?, updated_at = ? WHERE user_id = ? AND read_at IS NULL', [now(), now(), $uid]);
    } else {
        $ids = array_values(array_filter(array_map('intval', (array) ($body['ids'] ?? []))));
        if ($ids) {
            q('UPDATE notifications SET read_at = ?, updated_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (' . placeholders($ids) . ')', [now(), now(), $uid, ...$ids]);
        }
    }
    return ['unread' => (int) val('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', [$uid])];
});

/* Record that a WhatsApp message was opened for sending (click-to-send). */
route('POST', '/messages/log', function () {
    $in = clean(body(), ['customer_id' => 'int', 'template' => 'str|req|max:30', 'ref_type' => 'str|max:20', 'ref_id' => 'int', 'payload' => 'text|max:5000']);
    log_message($in['customer_id'] ?? null, $in['template'], $in['ref_type'] ?? null, $in['ref_id'] ?? null, (string) ($in['payload'] ?? ''));
    return ['ok' => true];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_INVENTORY]]);
