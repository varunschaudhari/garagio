<?php
declare(strict_types=1);

/*
 * Stock count: walk a location rack by rack, enter counted quantities.
 * The difference is posted as a stock_count movement; nothing is typed into current_stock.
 */
route('POST', '/stock-counts', function () {
    $in = clean(body(), ['location_id' => 'int', 'note' => 'str|max:255']);
    $lines = body()['lines'] ?? null;
    if (!is_array($lines) || !$lines) {
        fail(422, 'validation_failed', 'Count at least one part', ['lines' => 'required']);
    }
    $clean = [];
    $errors = [];
    foreach ($lines as $i => $l) {
        try {
            $clean[] = clean(is_array($l) ? $l : [], ['part_id' => 'int|req', 'counted' => 'num|req|min:0|max:100000', 'reason' => 'str|max:200']);
        } catch (ApiError $e) {
            $errors["lines.$i"] = $e->fields;
        }
    }
    if ($errors) {
        fail(422, 'validation_failed', 'Some counted lines are invalid', $errors);
    }

    $result = tx(function () use ($in, $clean) {
        $scId = insert('stock_counts', [
            'location_id' => $in['location_id'] ?? null,
            'lines_counted' => count($clean),
            'lines_changed' => 0,
            'note' => $in['note'] ?? null,
            'user_id' => uid(),
        ]);
        $changes = [];
        foreach ($clean as $l) {
            $part = row('SELECT id, part_no, name_en, name_mr, current_stock FROM parts WHERE id = ? FOR UPDATE', [$l['part_id']]) ?? not_found('Part');
            $diff = r2((float) $l['counted'] - (float) $part['current_stock']);
            if ($diff == 0.0) {
                continue;
            }
            $reason = $l['reason'] ?? $in['note'] ?? 'Stock count';
            stock_move((int) $part['id'], $diff, 'stock_count', 'stock_count', $scId, null, $reason);
            $changes[] = [
                'part_id' => (int) $part['id'],
                'part_no' => $part['part_no'],
                'name_en' => $part['name_en'],
                'name_mr' => $part['name_mr'],
                'before' => (float) $part['current_stock'],
                'counted' => (float) $l['counted'],
                'diff' => $diff,
            ];
        }
        update_row('stock_counts', $scId, ['lines_changed' => count($changes)]);
        audit('stock_count', 'stock_count', $scId, null, ['lines' => count($clean), 'changes' => $changes]);
        return ['id' => $scId, 'lines_counted' => count($clean), 'lines_changed' => count($changes), 'changes' => $changes];
    });
    return $result;
}, ['perm' => 'edit_parts']);

route('GET', '/stock-counts', function () {
    [$limit, $offset] = paging(30, 200);
    $total = (int) val('SELECT COUNT(*) FROM stock_counts');
    $items = rows(
        "SELECT s.*, u.name AS user_name, l.name_en AS location_en, l.name_mr AS location_mr
         FROM stock_counts s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN storage_locations l ON l.id = s.location_id
         ORDER BY s.id DESC LIMIT $limit OFFSET $offset"
    );
    return ['items' => $items, 'total' => $total];
}, ['perm' => 'edit_parts']);

route('GET', '/stock-counts/{id}', function ($p) {
    $sc = row(
        'SELECT s.*, u.name AS user_name, l.name_en AS location_en, l.name_mr AS location_mr
         FROM stock_counts s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN storage_locations l ON l.id = s.location_id
         WHERE s.id = ?',
        [(int) $p['id']]
    ) ?? not_found('Stock count');
    $sc['movements'] = rows(
        "SELECT m.part_id, m.qty, m.balance_after, m.note, p.part_no, p.name_en, p.name_mr, p.rack
         FROM stock_movements m JOIN parts p ON p.id = m.part_id
         WHERE m.ref_type = 'stock_count' AND m.ref_id = ? ORDER BY p.rack, p.part_no",
        [(int) $p['id']]
    );
    return ['item' => $sc];
}, ['perm' => 'edit_parts']);

/*
 * Reorder list = low-stock parts + request lines marked unavailable in the last 30 days,
 * grouped by the supplier each part was last bought from. Shared on WhatsApp by the clients.
 */
route('GET', '/reorder', function () {
    $since = date('Y-m-d H:i:s', time() - 30 * 86400);
    $short = [];
    foreach (rows(
        "SELECT i.part_id, SUM(GREATEST(i.qty - i.issued_qty, 0)) AS qty_short, COUNT(*) AS times
         FROM part_request_items i
         WHERE i.status = 'unavailable' AND i.part_id IS NOT NULL AND i.handled_at >= ?
         GROUP BY i.part_id",
        [$since]
    ) as $r) {
        $short[(int) $r['part_id']] = $r;
    }
    $ids = array_keys($short);
    $partSql = PART_SELECT . ' WHERE p.active = 1 AND (p.current_stock <= p.min_stock' . ($ids ? ' OR p.id IN (' . placeholders($ids) . ')' : '') . ') ORDER BY p.name_en';
    $parts = rows($partSql, $ids);

    // Last supplier per part
    $lastSupplier = [];
    if ($parts) {
        $pids = array_map(static fn ($p) => (int) $p['id'], $parts);
        foreach (rows(
            'SELECT pi.part_id, pu.supplier_id, pu.bill_date FROM purchase_items pi
             JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.id IN (SELECT MAX(pi2.id) FROM purchase_items pi2 WHERE pi2.part_id IN (' . placeholders($pids) . ') GROUP BY pi2.part_id)',
            $pids
        ) as $r) {
            $lastSupplier[(int) $r['part_id']] = ['id' => (int) $r['supplier_id'], 'last_bought' => $r['bill_date']];
        }
    }
    $suppliers = [];
    if ($lastSupplier) {
        $sids = array_values(array_unique(array_column($lastSupplier, 'id')));
        foreach (rows('SELECT id, name, phone FROM suppliers WHERE id IN (' . placeholders($sids) . ')', $sids) as $s) {
            $suppliers[(int) $s['id']] = $s;
        }
    }

    $groups = [];
    foreach ($parts as $p) {
        $pid = (int) $p['id'];
        $cur = (float) $p['current_stock'];
        $min = (float) $p['min_stock'];
        $isLow = $cur <= $min;
        $qtyShort = isset($short[$pid]) ? (float) $short[$pid]['qty_short'] : 0.0;
        $suggest = max(0.0, 2 * $min - $cur) + $qtyShort;
        $item = [
            'part_id' => $pid,
            'part_no' => $p['part_no'],
            'name_en' => $p['name_en'],
            'name_mr' => $p['name_mr'],
            'unit' => $p['unit'],
            'rack' => $p['rack'],
            'location_en' => $p['location_en'],
            'location_mr' => $p['location_mr'],
            'current_stock' => $cur,
            'min_stock' => $min,
            'qty_short' => $qtyShort,
            'reasons' => array_values(array_filter([$isLow ? 'low' : null, $qtyShort > 0 || isset($short[$pid]) ? 'unavailable' : null])),
            'suggested_qty' => max(1.0, ceil($suggest)),
            'last_purchase_price' => (float) $p['last_purchase_price'],
            'last_purchase_disc_pct' => (float) $p['last_purchase_disc_pct'],
            'last_bought' => $lastSupplier[$pid]['last_bought'] ?? null,
        ];
        $sid = $lastSupplier[$pid]['id'] ?? 0;
        $groups[$sid] ??= ['supplier' => $sid ? ($suppliers[$sid] ?? null) : null, 'items' => []];
        $groups[$sid]['items'][] = $item;
    }
    // Suppliers by name, "no supplier yet" last
    uasort($groups, static fn ($a, $b) => [$a['supplier'] === null, $a['supplier']['name'] ?? ''] <=> [$b['supplier'] === null, $b['supplier']['name'] ?? '']);

    // Free-text lines that were never linked to a catalogue part
    $unlinked = rows(
        "SELECT i.custom_name, SUM(i.qty) AS qty, MAX(i.handled_at) AS handled_at FROM part_request_items i
         WHERE i.status = 'unavailable' AND i.part_id IS NULL AND i.handled_at >= ? GROUP BY i.custom_name ORDER BY i.custom_name",
        [$since]
    );
    return ['groups' => array_values($groups), 'unlinked' => $unlinked, 'total_items' => count($parts)];
}, ['perm' => 'purchases']);
