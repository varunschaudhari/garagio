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

/*
 * Parts import from the shop's own Excel sheet. Headings are matched loosely (English or Marathi, any case,
 * spaces or dots): "Part No", "Part Name", "MRP", "Rate", "Qty" … all work. Numbers may carry ₹, %, commas.
 */
const PART_IMPORT_ALIASES = [
    'part_no' => ['part_no', 'part_number', 'partno', 'part_code', 'code', 'item_code', 'sku', 'पार्ट_नं', 'पार्ट_नंबर', 'पार्ट_क्रमांक', 'पार्ट_क्र'],
    'name_en' => ['name_en', 'name', 'part_name', 'item_name', 'item', 'description', 'product', 'product_name', 'spare_part', 'spare_part_name', 'english_name', 'name_english', 'name_in_english', 'पार्टचे_नाव', 'पार्ट_नाव', 'नाव'],
    'name_mr' => ['name_mr', 'marathi_name', 'name_marathi', 'name_in_marathi', 'marathi', 'मराठी_नाव', 'मराठी'],
    'selling_price' => ['selling_price', 'mrp', 'sale_price', 'sales_price', 'sell_price', 'selling_rate', 'sale_rate', 'price', 'एमआरपी', 'विक्री_किंमत', 'किंमत'],
    'last_purchase_price' => ['last_purchase_price', 'purchase_price', 'purchase_rate', 'purchase_cost', 'rate', 'cost', 'cost_price', 'buying_price', 'खरेदी_किंमत', 'खरेदी_दर', 'दर'],
    'last_purchase_disc_pct' => ['last_purchase_disc_pct', 'disc', 'discount', 'disc_pct', 'discount_pct', 'discount_percent', 'purchase_disc', 'purchase_discount', 'सूट'],
    'gst_rate' => ['gst_rate', 'gst', 'gst_pct', 'gst_percent', 'tax', 'tax_rate', 'जीएसटी'],
    'opening_stock' => ['opening_stock', 'qty', 'quantity', 'stock', 'available_qty', 'available_quantity', 'available_stock', 'current_stock', 'closing_stock', 'opening_qty', 'नग', 'स्टॉक', 'उपलब्ध_नग'],
    'opening_cost' => ['opening_cost'],
    'min_stock' => ['min_stock', 'minimum_stock', 'min_qty', 'minimum_qty', 'reorder_level', 'reorder_qty', 'किमान_स्टॉक', 'किमान_नग'],
    'category' => ['category', 'group', 'item_group', 'प्रकार'],
    'brand' => ['brand', 'company', 'make', 'कंपनी'],
    'compatible_models' => ['compatible_models', 'models', 'model', 'bike_models', 'bike_model', 'vehicle', 'vehicles', 'fits', 'गाडी'],
    'unit' => ['unit', 'uom', 'units'],
    'hsn' => ['hsn', 'hsn_code', 'hsn_sac'],
    'location' => ['location', 'store', 'godown', 'जागा'],
    'rack' => ['rack', 'rack_no', 'shelf', 'bin', 'रॅक'],
];
const PART_IMPORT_NUMBERS = ['selling_price', 'last_purchase_price', 'last_purchase_disc_pct', 'gst_rate', 'opening_stock', 'opening_cost', 'min_stock'];
/** Loose heading rules for other people's sheets, checked in this order after the exact aliases. */
const PART_IMPORT_FUZZY = [
    ['min_stock', ['min', 'reorder']],
    ['gst_rate', ['gst', 'tax']],
    ['selling_price', ['mrp', 'selling', 'sale', 'sell']],
    ['last_purchase_disc_pct', ['disc']],
    ['opening_stock', ['qty', 'quantity', 'stock', 'balance', 'closing']],
    ['hsn', ['hsn']],
    ['part_no', ['part_no', 'partno', 'part_number', 'code', 'sku']],
    ['name_mr', ['marathi', 'मराठी']],
    ['category', ['category', 'group']],
    ['brand', ['brand', 'company', 'make']],
    ['compatible_models', ['model', 'vehicle', 'bike']],
    ['location', ['location', 'godown']],
    ['rack', ['rack', 'shelf', 'bin']],
    ['last_purchase_price', ['rate', 'price', 'cost', 'purchase']],
    ['unit', ['unit', 'uom']],
    ['name_en', ['description', 'particular', 'item', 'product', 'name', 'goods', 'नाव']],
];

/** One sheet row (heading => cell) → part fields; headings that match nothing are collected in $unused. */
function import_part_row(array $raw, array &$unused): array
{
    return import_map_row($raw, PART_IMPORT_ALIASES, PART_IMPORT_NUMBERS, $unused, PART_IMPORT_FUZZY);
}

/** Next free automatic part number: P00001, P00002 … */
function next_auto_part_no(): string
{
    $n = (int) val('SELECT COUNT(*) FROM parts') + 1;
    do {
        $no = sprintf('P%05d', $n++);
    } while (val('SELECT id FROM parts WHERE part_no = ?', [$no]));
    return $no;
}

/* A sample sheet to fill in, with a "How to fill" page in English and Marathi. */
route('GET', '/parts/import-sample', function () {
    $rows = [
        ['Part No', 'Part Name', 'Marathi Name', 'MRP', 'Purchase Rate', 'Discount %', 'GST %', 'Available Qty', 'Min Qty', 'Category', 'Brand', 'Bike Models', 'Unit', 'HSN', 'Location', 'Rack'],
        ['001', 'Brake lines', 'ब्रेक लाइन्स', 185, 156.78, 22, 18, 10, 2, 'Brakes', '', 'Splendor, Passion', 'pcs', '', 'Counter', 'A1'],
        ['SP-CPR7EA9', 'Spark plug', 'स्पार्क प्लग', 150, 85, 5, 18, 40, 10, 'Engine', 'NGK', 'Splendor, Activa', 'pcs', '85111000', 'Counter', 'A2'],
        ['', 'Engine oil 1 litre', 'इंजिन ऑईल 1 लिटर', 420, 330, 0, 18, 24, 6, 'Oil', 'Castrol', '', 'pcs', '27101980', 'Store room', 'B1'],
    ];
    $help = [['English', 'मराठी']];
    foreach (['required', 'part_no', 'mrp', 'rate', 'discount', 'qty', 'min', 'headings', 'update', 'file'] as $k) {
        $help[] = [tr("parts.sample.$k", 'en'), tr("parts.sample.$k", 'mr')];
    }
    return new RawResponse(xlsx_build(['Parts' => $rows, 'How to fill' => $help]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, [
        'Content-Disposition' => 'attachment; filename="parts-import-sample.xlsx"',
        'Cache-Control' => 'no-store',
    ]);
}, ['perm' => 'edit_parts']);

/*
 * MRPs change: a new MRP from the bill screen (counter sale or a draft bill). It becomes the part's selling price
 * (audited); with invoice_id the draft is worked out again, and a job's parts take the new price too.
 */
route('POST', '/parts/{id}/mrp', function ($p) {
    $in = clean(body(), ['mrp' => 'num|req|min:0.01|max:10000000', 'invoice_id' => 'int']);
    $id = (int) $p['id'];
    if (!empty($in['invoice_id']) && !can('make_bills')) {
        fail(403, 'forbidden', 'You may not change bills');
    }
    tx(function () use ($id, $in) {
        $part = row('SELECT id, selling_price FROM parts WHERE id = ? FOR UPDATE', [$id]) ?? not_found('Part');
        $inv = null;
        if (!empty($in['invoice_id'])) {
            $inv = row('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [$in['invoice_id']]) ?? not_found('Invoice');
            if ($inv['status'] !== 'draft') {
                fail(409, 'invoice_final', 'Only a draft bill can be changed');
            }
        }
        if (abs((float) $part['selling_price'] - (float) $in['mrp']) >= 0.005) {
            q('UPDATE parts SET selling_price = ?, updated_at = ? WHERE id = ?', [$in['mrp'], now(), $id]);
            audit('price_change', 'part', $id, ['selling_price' => (float) $part['selling_price']], ['selling_price' => (float) $in['mrp'], 'invoice_id' => $in['invoice_id'] ?? null]);
        }
        if ($inv) {
            if ($inv['inv_type'] === 'job') {
                q('UPDATE job_parts SET unit_price = ?, updated_at = ? WHERE job_card_id = ? AND part_id = ?', [$in['mrp'], now(), $inv['job_card_id'], $id]);
            }
            rebuild_draft((int) $inv['id']);
        }
    });
    return [
        'item' => strip_cost(row(PART_SELECT . ' WHERE p.id = ?', [$id])),
        'invoice' => !empty($in['invoice_id']) ? invoice_view((int) $in['invoice_id']) : null,
    ];
}, ['perm' => 'change_mrp']);

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
/** Thrown inside the replace transaction when any row is wrong: nothing of the upload is kept. */
final class PartsImportAborted extends RuntimeException
{
}

/** Parts that appear on a purchase, a bill, a job, a request, an estimate or a return keep their history. */
function part_is_used(int $id): bool
{
    foreach (['purchase_items', 'invoice_items', 'job_parts', 'part_request_items', 'estimate_items', 'sale_return_items'] as $t) {
        if (val("SELECT 1 FROM `$t` WHERE part_id = ? LIMIT 1", [$id])) {
            return true;
        }
    }
    return false;
}

/*
 * set_stock: the sheet's quantity becomes the stock of parts already in the app (a stock adjustment "Excel upload").
 * replace (owner): the sheet is the whole parts list. A backup is taken first; any wrong row stops the whole upload.
 * Parts not in the sheet are deleted when never used, otherwise hidden with their stock set to 0 (history stays).
 */
route('POST', '/parts/import', function () {
    $body = body();
    $rowsIn = $body['rows'] ?? null;
    $firstRow = 2;
    // A whole sheet: the heading row is found (shop name / address lines above the table are fine).
    if (is_array($body['table'] ?? null) && $body['table']) {
        ['rows' => $rowsIn, 'first_row' => $firstRow] = import_table_rows($body['table'], PART_IMPORT_ALIASES, PART_IMPORT_FUZZY);
    }
    if (!is_array($rowsIn) || !$rowsIn) {
        fail(422, 'validation_failed', 'No rows to import', ['rows' => 'required']);
    }
    if (count($rowsIn) > 3000) {
        fail(422, 'too_many_rows', 'Import at most 3000 rows at a time');
    }
    $opt = clean($body, ['set_stock' => 'bool', 'replace' => 'bool']);
    $setStock = !empty($opt['set_stock']);
    $replace = !empty($opt['replace']);
    if ($replace && !is_role(ROLE_OWNER)) {
        fail(403, 'forbidden', 'Only the owner can replace the whole parts list');
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

    $n = ['created' => 0, 'updated' => 0, 'auto_numbered' => 0, 'stock_set' => 0, 'deleted' => 0, 'hidden' => 0];
    $errors = [];
    $unused = [];
    $seen = [];
    $run = function () use ($rowsIn, $firstRow, $setStock, $findOrCreate, &$catCache, &$locCache, &$n, &$errors, &$unused, &$seen) {
        foreach (array_values($rowsIn) as $i => $raw) {
            $rowNo = $i + $firstRow; // row number in the sheet
            $r = is_array($raw) ? import_part_row($raw, $unused) : null;
            try {
                if ($r === null) {
                    throw new ApiError(422, 'bad_row', 'Row is not an object');
                }
                if (!$r) {
                    continue; // nothing we know in this row (an empty or notes row)
                }
                tx(function () use (&$r, $setStock, $findOrCreate, &$catCache, &$locCache, &$n, &$seen) {
                    if (empty($r['name_en']) && !empty($r['name_mr'])) {
                        $r['name_en'] = $r['name_mr'];
                    }
                    if (empty($r['part_no'])) {
                        // No part number in the sheet: the same name updates that part, otherwise a new number.
                        $same = !empty($r['name_en']) ? val('SELECT part_no FROM parts WHERE LOWER(name_en) = ? LIMIT 1', [mb_strtolower((string) $r['name_en'])]) : null;
                        $auto = !$same;
                        $r['part_no'] = $same ?: next_auto_part_no();
                    }
                    if (!empty($r['category'])) {
                        $r['category_id'] = $findOrCreate('categories', (string) $r['category'], $catCache);
                    }
                    if (!empty($r['location'])) {
                        $r['location_id'] = $findOrCreate('storage_locations', (string) $r['location'], $locCache);
                    }
                    $existing = row('SELECT id, current_stock FROM parts WHERE part_no = ?', [strtoupper((string) preg_replace('/\s+/', '', (string) $r['part_no']))]);
                    if ($existing) {
                        $id = (int) $existing['id'];
                        $in = prepare_part_input(clean($r, PART_RULES, true));
                        $in['active'] = 1; // in the sheet = in use
                        update_row('parts', $id, $in);
                        $n['updated']++;
                        if ($setStock && isset($r['opening_stock'])) {
                            $qty = clean($r, ['opening_stock' => 'num|min:0|max:100000'])['opening_stock'] ?? null;
                            $diff = $qty === null ? 0.0 : r2((float) $qty - (float) $existing['current_stock']);
                            if (abs($diff) >= 0.005) {
                                stock_move($id, $diff, 'adjustment', 'part', $id, null, 'Excel upload');
                                $n['stock_set']++;
                            }
                        }
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
                        $n['created']++;
                        if (!empty($auto)) {
                            $n['auto_numbered']++;
                        }
                    }
                    $seen[$id] = true;
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
    };

    $backup = null;
    $aborted = false;
    if ($replace) {
        $backup = basename(backup_database('before-parts-replace'));
        try {
            tx(function () use ($run, &$errors, &$seen, &$n) {
                $run();
                if ($errors) {
                    throw new PartsImportAborted();
                }
                foreach (rows('SELECT id, current_stock FROM parts ORDER BY id') as $p) {
                    $id = (int) $p['id'];
                    if (isset($seen[$id])) {
                        continue;
                    }
                    if (!part_is_used($id)) {
                        q('DELETE FROM stock_movements WHERE part_id = ?', [$id]);
                        q('DELETE FROM parts WHERE id = ?', [$id]);
                        $n['deleted']++;
                        continue;
                    }
                    if (abs((float) $p['current_stock']) >= 0.005) {
                        stock_move($id, -(float) $p['current_stock'], 'adjustment', 'part', $id, null, 'Not in the uploaded parts list');
                    }
                    q('UPDATE parts SET active = 0, updated_at = ? WHERE id = ?', [now(), $id]);
                    $n['hidden']++;
                }
            });
        } catch (PartsImportAborted) {
            $aborted = true;
            $n = array_fill_keys(array_keys($n), 0);
        }
    } else {
        $run();
    }
    audit($replace ? 'parts_replace' : 'parts_import', 'part', null, null, $n + ['errors' => count($errors), 'set_stock' => $setStock, 'backup' => $backup, 'aborted' => $aborted]);
    return $n + ['errors' => $errors, 'unused_columns' => array_keys($unused), 'replaced' => $replace && !$aborted, 'aborted' => $aborted, 'backup' => $backup];
}, ['perm' => 'edit_parts']);
