<?php
declare(strict_types=1);

const PART_RULES = [
    'part_no' => 'str|req|max:40',
    'name_en' => 'str|req|max:150',
    'name_mr' => 'str|max:150',
    'category_id' => 'int',
    'brand' => 'str|max:60',
    'compatible_models' => 'str|max:255',
    'unit' => 'str|max:10',
    'hsn' => 'str|max:10',
    'gst_rate' => 'num|min:0|max:40',
    'selling_price' => 'num|req|min:0|max:10000000',
    'last_purchase_price' => 'num|min:0|max:10000000|def:0',
    'last_purchase_disc_pct' => 'num|min:0|max:100|def:0',
    'location_id' => 'int',
    'rack' => 'str|max:20',
    'min_stock' => 'num|min:0|max:100000|def:0',
    'active' => 'bool',
];

const PART_SELECT = "SELECT p.*, c.name_en AS category_en, c.name_mr AS category_mr,
    l.name_en AS location_en, l.name_mr AS location_mr,
    (p.active = 1 AND p.current_stock <= p.min_stock) AS is_low,
    ROUND(p.current_stock * p.avg_cost, 2) AS stock_value
  FROM parts p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN storage_locations l ON l.id = p.location_id";

function part_by_id(int $id): array
{
    return row(PART_SELECT . ' WHERE p.id = ?', [$id]) ?? not_found('Part');
}

/** Normalise part fields shared by create, update and import. */
function prepare_part_input(array $in): array
{
    if (isset($in['part_no'])) {
        $in['part_no'] = strtoupper(preg_replace('/\s+/', '', $in['part_no']));
        if ($in['part_no'] === '') {
            fail(422, 'validation_failed', 'Part number is required', ['part_no' => 'required']);
        }
    }
    if (array_key_exists('gst_rate', $in)) {
        $in['gst_rate'] = $in['gst_rate'] ?? setting_num('default_part_gst_rate');
        check_gst_rate((float) $in['gst_rate']);
    }
    if (array_key_exists('unit', $in) && !$in['unit']) {
        $in['unit'] = 'pcs';
    }
    if (isset($in['rack'])) {
        $in['rack'] = strtoupper($in['rack']);
    }
    foreach (['category_id' => 'categories', 'location_id' => 'storage_locations'] as $f => $table) {
        if (!empty($in[$f]) && !val("SELECT id FROM `$table` WHERE id = ?", [$in[$f]])) {
            fail(422, 'validation_failed', 'Unknown ' . str_replace('_id', '', $f), [$f => 'invalid_choice']);
        }
    }
    return $in;
}

route('GET', '/parts', function () {
    [$limit, $offset] = paging(50, 1000);
    $where = [];
    $params = [];
    $term = qp('q');
    if (!qp('all')) {
        $where[] = 'p.active = 1';
    }
    if ($term !== null && $term !== '') {
        $like = like($term);
        $where[] = '(p.part_no LIKE ? OR p.name_en LIKE ? OR p.name_mr LIKE ? OR p.rack LIKE ? OR p.brand LIKE ? OR p.compatible_models LIKE ?)';
        array_push($params, $like, $like, $like, $like, $like, $like);
    }
    if ($cat = qp_int('category')) {
        $where[] = 'p.category_id = ?';
        $params[] = $cat;
    }
    if ($loc = qp_int('location')) {
        $where[] = 'p.location_id = ?';
        $params[] = $loc;
    }
    if (($rack = qp('rack')) !== null && $rack !== '') {
        $where[] = 'p.rack = ?';
        $params[] = strtoupper($rack);
    }
    if (qp('low')) {
        $where[] = 'p.current_stock <= p.min_stock';
    }
    if (qp('in_stock')) {
        $where[] = 'p.current_stock > 0';
    }
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $order = match (qp('sort', 'name')) {
        'part_no' => 'p.part_no',
        'rack' => 'COALESCE(l.sort_order, 9999), l.id, p.rack IS NULL, p.rack, p.part_no',
        'stock' => 'p.current_stock, p.name_en',
        'stock_desc' => 'p.current_stock DESC, p.name_en',
        'price' => 'p.selling_price DESC',
        'updated' => 'p.updated_at DESC',
        default => 'p.name_en',
    };
    $orderParams = [];
    if ($term !== null && $term !== '') {
        $order = '(p.part_no = ?) DESC, ' . $order;
        $orderParams[] = strtoupper($term);
    }

    $total = (int) val("SELECT COUNT(*) FROM parts p LEFT JOIN storage_locations l ON l.id = p.location_id $w", $params);
    $items = rows(PART_SELECT . " $w ORDER BY $order LIMIT $limit OFFSET $offset", [...$params, ...$orderParams]);
    return strip_cost(['items' => $items, 'total' => $total]);
});

route('GET', '/parts/by-code/{code}', function ($p) {
    $code = strtoupper(trim(urldecode($p['code'])));
    $id = val('SELECT id FROM parts WHERE part_no = ?', [$code]);
    if (!$id) {
        fail(404, 'part_not_found', "No part with code $code");
    }
    return strip_cost(['item' => part_by_id((int) $id)]);
});

route('GET', '/parts/labels', function () {
    $mode = qp('mode', 'part');
    $where = ['p.active = 1'];
    $params = [];
    if ($ids = qp('ids')) {
        $list = array_values(array_filter(array_map('intval', explode(',', $ids))));
        if ($list) {
            $where[] = 'p.id IN (' . placeholders($list) . ')';
            array_push($params, ...$list);
        }
    }
    if ($loc = qp_int('location')) {
        $where[] = 'p.location_id = ?';
        $params[] = $loc;
    }
    if (($rack = qp('rack')) !== null && $rack !== '') {
        $where[] = 'p.rack = ?';
        $params[] = strtoupper($rack);
    }
    $sql = PART_SELECT . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY COALESCE(l.sort_order, 9999), p.rack, p.part_no LIMIT 2000';
    $parts = rows($sql, $params);
    $labels = [];
    if ($mode === 'rack') {
        $seen = [];
        foreach ($parts as $pt) {
            if (!$pt['rack']) {
                continue;
            }
            $key = $pt['location_id'] . '|' . $pt['rack'];
            if (isset($seen[$key])) {
                $seen[$key]['count']++;
                continue;
            }
            $seen[$key] = [
                'code' => 'RACK|' . (int) $pt['location_id'] . '|' . $pt['rack'],
                'title' => 'Rack ' . $pt['rack'],
                'sub' => trim(($pt['location_en'] ?? '') . ' · ' . ($pt['location_mr'] ?? ''), ' ·'),
                'count' => 1,
            ];
        }
        foreach ($seen as $s) {
            $labels[] = ['code' => $s['code'], 'title' => $s['title'], 'line2' => $s['sub'], 'line3' => $s['count'] . ' parts', 'price' => ''];
        }
    } else {
        $copies = max(1, min(50, qp_int('copies', 1)));
        foreach ($parts as $pt) {
            for ($i = 0; $i < $copies; $i++) {
                $labels[] = [
                    'code' => $pt['part_no'],
                    'title' => $pt['part_no'],
                    'line2' => $pt['name_en'],
                    'line3' => $pt['name_mr'] ?? '',
                    'price' => trim(($pt['location_en'] ? $pt['location_en'] . ' · ' : '') . ($pt['rack'] ? 'Rack ' . $pt['rack'] : '') . ' · MRP ' . inr((float) $pt['selling_price']), ' ·'),
                ];
            }
        }
    }
    ob_start();
    include API_DIR . '/templates/labels.php';
    return html_response((string) ob_get_clean());
});

route('GET', '/parts/{id}', function ($p) {
    $part = part_by_id((int) $p['id']);
    $part['open_request_qty'] = (float) val(
        "SELECT COALESCE(SUM(i.qty - i.issued_qty), 0) FROM part_request_items i
         JOIN part_requests r ON r.id = i.request_id
         WHERE i.part_id = ? AND r.status = 'open' AND i.status IN ('requested','needs_approval','approved')",
        [$part['id']]
    );
    return strip_cost(['item' => $part]);
});

route('POST', '/parts', function () {
    $in = clean(body(), PART_RULES + ['opening_stock' => 'num|min:0|max:100000', 'opening_cost' => 'num|min:0|max:10000000']);
    $in['gst_rate'] = $in['gst_rate'] ?? null;
    $in = prepare_part_input($in);
    $opening = (float) ($in['opening_stock'] ?? 0);
    $openingCost = $in['opening_cost'] ?? null;
    unset($in['opening_stock'], $in['opening_cost']);
    $in['active'] = $in['active'] ?? 1;
    $in['current_stock'] = 0;

    $id = tx(function () use ($in, $opening, $openingCost) {
        $id = insert('parts', $in);
        if ($opening > 0) {
            $cost = $openingCost ?? net_cost((float) ($in['last_purchase_price'] ?? 0), (float) ($in['last_purchase_disc_pct'] ?? 0));
            stock_move($id, $opening, 'opening', 'part', $id, (float) $cost, 'Opening stock');
        }
        return $id;
    });
    return strip_cost(['item' => part_by_id($id)]);
}, ['perm' => 'edit_parts']);

route('PUT', '/parts/{id}', function ($p) {
    $id = (int) $p['id'];
    $before = part_by_id($id);
    $in = prepare_part_input(clean(body(), PART_RULES, true));
    // Stock is never typed directly.
    unset($in['current_stock'], $in['avg_cost']);
    update_row('parts', $id, $in);
    $after = part_by_id($id);
    if ((float) $before['selling_price'] !== (float) $after['selling_price']) {
        audit('price_change', 'part', $id, ['selling_price' => $before['selling_price']], ['selling_price' => $after['selling_price']]);
    }
    return strip_cost(['item' => $after]);
}, ['perm' => 'edit_parts']);

route('GET', '/parts/{id}/ledger', function ($p) {
    $id = (int) $p['id'];
    $part = part_by_id($id);
    [$limit, $offset] = paging(100, 1000);
    $where = 'm.part_id = ?';
    $params = [$id];
    if ($from = qp_date('from')) {
        $where .= ' AND m.created_at >= ?';
        $params[] = $from . ' 00:00:00';
    }
    if ($to = qp_date('to')) {
        $where .= ' AND m.created_at <= ?';
        $params[] = $to . ' 23:59:59';
    }
    $total = (int) val("SELECT COUNT(*) FROM stock_movements m WHERE $where", $params);
    $items = rows(
        "SELECT m.*, u.name AS user_name FROM stock_movements m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE $where ORDER BY m.id DESC LIMIT $limit OFFSET $offset",
        $params
    );
    $items = attach_movement_refs($items);
    $check = (float) val('SELECT COALESCE(SUM(qty), 0) FROM stock_movements WHERE part_id = ?', [$id]);
    return strip_cost([
        'part' => $part,
        'items' => $items,
        'total' => $total,
        'ledger_sum' => r2($check),
        'balanced' => abs($check - (float) $part['current_stock']) < 0.001,
    ]);
});

/** Add a human label for each movement's reference (job no, bill no, invoice no). */
function attach_movement_refs(array $items): array
{
    $byType = [];
    foreach ($items as $m) {
        if ($m['ref_type'] && $m['ref_id']) {
            $byType[$m['ref_type']][] = (int) $m['ref_id'];
        }
    }
    $labels = [];
    $lookups = [
        'job' => ['job_cards', 'job_no'],
        'purchase' => ['purchases', 'bill_no'],
        'invoice' => ['invoices', 'invoice_no'],
    ];
    foreach ($byType as $type => $ids) {
        if (!isset($lookups[$type])) {
            continue;
        }
        [$table, $col] = $lookups[$type];
        $ids = array_values(array_unique($ids));
        foreach (rows("SELECT id, `$col` AS label FROM `$table` WHERE id IN (" . placeholders($ids) . ')', $ids) as $r) {
            $labels[$type][(int) $r['id']] = $r['label'];
        }
    }
    foreach ($items as &$m) {
        $t = $m['ref_type'];
        $m['ref_label'] = match ($t) {
            'job', 'purchase', 'invoice' => $labels[$t][(int) $m['ref_id']] ?? null,
            'stock_count' => 'SC-' . $m['ref_id'],
            default => null,
        };
    }
    unset($m);
    return $items;
}

route('POST', '/parts/{id}/adjust', function ($p) {
    $id = (int) $p['id'];
    part_by_id($id);
    $in = clean(body(), ['qty' => 'num|req|min:-100000|max:100000', 'reason' => 'str|req|max:200']);
    if ((float) $in['qty'] == 0.0) {
        fail(422, 'validation_failed', 'Quantity must not be zero', ['qty' => 'zero']);
    }
    $mv = tx(function () use ($id, $in) {
        $mv = stock_move($id, (float) $in['qty'], 'adjustment', null, null, null, $in['reason']);
        audit('stock_adjust', 'part', $id, ['stock' => $mv['previous']], ['stock' => $mv['balance_after'], 'qty' => $in['qty'], 'reason' => $in['reason']]);
        return $mv;
    });
    return strip_cost(['item' => part_by_id($id), 'movement_id' => $mv['id']]);
}, ['perm' => 'edit_parts']);

/*
 * Import / upsert by part_no. The browser parses Excel or CSV and posts rows.
 * Category and location may be given by name (English or Marathi); missing ones are created.
 * opening_stock is used only for new parts - stock of existing parts is never overwritten.
 */
route('POST', '/parts/import', function () {
    $rowsIn = body()['rows'] ?? null;
    if (!is_array($rowsIn) || !$rowsIn) {
        fail(422, 'validation_failed', 'No rows to import', ['rows' => 'required']);
    }
    if (count($rowsIn) > 3000) {
        fail(422, 'too_many_rows', 'Import at most 3000 rows at a time');
    }
    $catCache = [];
    $locCache = [];
    $findOrCreate = static function (string $table, string $name, array &$cache): int {
        $key = mb_strtolower(trim($name));
        if (isset($cache[$key])) {
            return $cache[$key];
        }
        $id = val("SELECT id FROM `$table` WHERE LOWER(name_en) = ? OR LOWER(name_mr) = ? LIMIT 1", [$key, $key]);
        if (!$id) {
            $id = insert($table, ['name_en' => trim($name), 'name_mr' => null, 'active' => 1]);
        }
        return $cache[$key] = (int) $id;
    };

    $created = 0;
    $updated = 0;
    $errors = [];
    foreach ($rowsIn as $i => $r) {
        $rowNo = $i + 2; // +1 for header, +1 for 1-based
        try {
            if (!is_array($r)) {
                throw new ApiError(422, 'bad_row', 'Row is not an object');
            }
            tx(function () use ($r, $findOrCreate, &$catCache, &$locCache, &$created, &$updated) {
                if (!empty($r['category'])) {
                    $r['category_id'] = $findOrCreate('categories', (string) $r['category'], $catCache);
                }
                if (!empty($r['location'])) {
                    $r['location_id'] = $findOrCreate('storage_locations', (string) $r['location'], $locCache);
                }
                $existing = isset($r['part_no']) ? row('SELECT id FROM parts WHERE part_no = ?', [strtoupper(preg_replace('/\s+/', '', (string) $r['part_no']))]) : null;
                if ($existing) {
                    $in = prepare_part_input(clean($r, PART_RULES, true));
                    update_row('parts', (int) $existing['id'], $in);
                    $updated++;
                } else {
                    $in = clean($r, PART_RULES + ['opening_stock' => 'num|min:0|max:100000', 'opening_cost' => 'num|min:0']);
                    $in['gst_rate'] = $in['gst_rate'] ?? null;
                    $in = prepare_part_input($in);
                    $opening = (float) ($in['opening_stock'] ?? 0);
                    $openingCost = $in['opening_cost'] ?? null;
                    unset($in['opening_stock'], $in['opening_cost']);
                    $in['active'] = $in['active'] ?? 1;
                    $id = insert('parts', $in);
                    if ($opening > 0) {
                        $cost = $openingCost ?? net_cost((float) ($in['last_purchase_price'] ?? 0), (float) ($in['last_purchase_disc_pct'] ?? 0));
                        stock_move($id, $opening, 'opening', 'part', $id, (float) $cost, 'Opening stock (import)');
                    }
                    $created++;
                }
            });
        } catch (ApiError $e) {
            $errors[] = ['row' => $rowNo, 'part_no' => $r['part_no'] ?? null, 'error' => $e->getMessage(), 'fields' => $e->fields];
        } catch (PDOException $e) {
            $dup = ($e->errorInfo[1] ?? 0) === 1062;
            if (!$dup) {
                throw $e;
            }
            $errors[] = ['row' => $rowNo, 'part_no' => $r['part_no'] ?? null, 'error' => 'Duplicate value', 'fields' => []];
        }
    }
    audit('parts_import', 'part', null, null, ['created' => $created, 'updated' => $updated, 'errors' => count($errors)]);
    return ['created' => $created, 'updated' => $updated, 'errors' => $errors];
}, ['perm' => 'edit_parts']);
