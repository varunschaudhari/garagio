<?php
declare(strict_types=1);

/*
 * Activity log for the owner: who did what and when (discounts, cancelled bills, stock adjustments,
 * price changes, permission changes, …), from audit_log. Job steps are included on request.
 */
route('GET', '/audit', function () {
    [$limit, $offset] = paging(50, 200);
    $where = ['1 = 1'];
    $params = [];
    if (qp('kind', 'important') !== 'all') {
        $where[] = "a.entity <> 'job'";
    }
    if ($from = qp_date('from')) {
        $where[] = 'a.created_at >= ?';
        $params[] = $from . ' 00:00:00';
    }
    if ($to = qp_date('to')) {
        $where[] = 'a.created_at <= ?';
        $params[] = $to . ' 23:59:59';
    }
    if (($action = (string) qp('action', '')) !== '' && preg_match('/^[a-z_]{2,40}$/', $action)) {
        $where[] = 'a.action = ?';
        $params[] = $action;
    }
    if (($user = (int) qp('user_id', 0)) > 0) {
        $where[] = 'a.user_id = ?';
        $params[] = $user;
    }
    $w = implode(' AND ', $where);
    $total = (int) val("SELECT COUNT(*) FROM audit_log a WHERE $w", $params);
    $items = rows(
        "SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.before_json, a.after_json, a.ip, a.user_id, u.name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE $w ORDER BY a.id DESC LIMIT $limit OFFSET $offset",
        $params
    );
    foreach ($items as &$it) {
        $it['before'] = $it['before_json'] ? json_decode($it['before_json'], true) : null;
        $it['after'] = $it['after_json'] ? json_decode($it['after_json'], true) : null;
        unset($it['before_json'], $it['after_json']);
    }
    unset($it);
    return [
        'items' => $items,
        'total' => $total,
        'actions' => array_column(rows("SELECT DISTINCT action FROM audit_log ORDER BY action"), 'action'),
        'users' => rows('SELECT id, name FROM users ORDER BY name'),
    ];
}, ['roles' => [ROLE_OWNER]]);
