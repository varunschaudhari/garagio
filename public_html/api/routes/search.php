<?php
declare(strict_types=1);

/*
 * Command palette search (Ctrl+K): customers, bikes, job numbers, parts and invoices.
 * Results follow the person's permissions: customers / bikes need "customers", bills need "make bills";
 * mechanics see parts and their own jobs only.
 */
route('GET', '/search', function () {
    $term = trim((string) qp('q', ''));
    if (mb_strlen($term) < 2) {
        return ['items' => []];
    }
    $like = like($term);
    $reg = like(normalize_reg_no($term));
    $u = current_user();
    $role = $u['role'];
    $out = [];

    foreach (rows(
        'SELECT id, part_no, name_en, name_mr, rack, current_stock FROM parts
         WHERE active = 1 AND (part_no LIKE ? OR name_en LIKE ? OR name_mr LIKE ?)
         ORDER BY (part_no = ?) DESC, name_en LIMIT 6',
        [$like, $like, $like, strtoupper($term)]
    ) as $r) {
        $out[] = ['type' => 'part', 'id' => $r['id'], 'title' => $r['part_no'] . ' · ' . $r['name_en'], 'title_mr' => $r['name_mr'],
            'sub' => ($r['rack'] ? 'Rack ' . $r['rack'] . ' · ' : '') . 'Stock ' . fmt_qty((float) $r['current_stock']), 'link' => '#/parts/' . $r['id']];
    }

    $jobWhere = $role === ROLE_MECHANIC ? ' AND j.mechanic_id = ' . (int) $u['id'] : '';
    foreach (rows(
        "SELECT j.id, j.job_no, j.status, v.reg_no, c.name FROM job_cards j
         JOIN vehicles v ON v.id = j.vehicle_id JOIN customers c ON c.id = j.customer_id
         WHERE (j.job_no LIKE ? OR v.reg_no LIKE ?) $jobWhere ORDER BY j.id DESC LIMIT 6",
        [$like, $reg]
    ) as $r) {
        $out[] = ['type' => 'job', 'id' => $r['id'], 'title' => $r['job_no'] . ' · ' . $r['reg_no'], 'sub' => $r['name'], 'status' => $r['status'], 'link' => '#/jobs/' . $r['id']];
    }

    if (can('customers')) {
        foreach (rows(
            'SELECT id, name, phone FROM customers WHERE name LIKE ? OR phone LIKE ? OR alt_phone LIKE ? ORDER BY name LIMIT 6',
            [$like, $like, $like]
        ) as $r) {
            $out[] = ['type' => 'customer', 'id' => $r['id'], 'title' => $r['name'], 'sub' => $r['phone'], 'link' => '#/customers/' . $r['id']];
        }
        foreach (rows(
            'SELECT v.id, v.reg_no, v.make, v.model, v.customer_id, c.name FROM vehicles v JOIN customers c ON c.id = v.customer_id
             WHERE v.reg_no LIKE ? ORDER BY v.reg_no LIMIT 6',
            [$reg]
        ) as $r) {
            $out[] = ['type' => 'vehicle', 'id' => $r['id'], 'title' => $r['reg_no'], 'sub' => trim($r['make'] . ' ' . $r['model']) . ' · ' . $r['name'], 'link' => '#/customers/' . $r['customer_id']];
        }
    }
    if (can('make_bills')) {
        foreach (rows(
            "SELECT id, invoice_no, cust_name, grand_total, status FROM invoices
             WHERE invoice_no LIKE ? OR cust_name LIKE ? OR cust_phone LIKE ? ORDER BY id DESC LIMIT 6",
            [$like, $like, $like]
        ) as $r) {
            $out[] = ['type' => 'invoice', 'id' => $r['id'], 'title' => ($r['invoice_no'] ?? 'Draft #' . $r['id']), 'sub' => $r['cust_name'] . ' · ' . inr((float) $r['grand_total']), 'status' => $r['status'], 'link' => '#/invoices/' . $r['id']];
        }
    }
    return ['items' => $out];
});
