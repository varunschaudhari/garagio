<?php
declare(strict_types=1);

/*
 * Parts requests replace the paper slip:
 *   mechanic requests → lines worth ≥ approval_limit wait for owner / inventory approval
 *   → inventory issues (stock drops, part lands on the job) or marks unavailable.
 * Line statuses: requested, needs_approval, approved, issued, unavailable, rejected, cancelled.
 */

const LINE_OPEN = ['requested', 'needs_approval', 'approved'];
const LINE_DONE = ['issued', 'unavailable', 'rejected', 'cancelled'];

const REQUEST_ITEM_SELECT = "SELECT i.*, p.part_no, p.name_en, p.name_mr, p.unit, p.rack, p.current_stock, p.selling_price,
    l.name_en AS location_en, l.name_mr AS location_mr, l.sort_order AS location_sort,
    ua.name AS approved_by_name, uh.name AS handled_by_name
  FROM part_request_items i
  LEFT JOIN parts p ON p.id = i.part_id
  LEFT JOIN storage_locations l ON l.id = p.location_id
  LEFT JOIN users ua ON ua.id = i.approved_by
  LEFT JOIN users uh ON uh.id = i.handled_by";

function approval_limit(): float
{
    return setting_num('approval_limit');
}

/** Status for a line once its part (and price) is known. */
function line_status_for(float $value): string
{
    return $value >= approval_limit() ? 'needs_approval' : 'requested';
}

function request_items(array $requestIds): array
{
    if (!$requestIds) {
        return [];
    }
    $out = [];
    foreach (rows(REQUEST_ITEM_SELECT . ' WHERE i.request_id IN (' . placeholders($requestIds) . ') ORDER BY i.id', $requestIds) as $it) {
        $out[(int) $it['request_id']][] = $it;
    }
    return $out;
}

function requests_for_job(int $jobId): array
{
    $reqs = rows('SELECT r.*, u.name AS requested_by_name FROM part_requests r JOIN users u ON u.id = r.requested_by WHERE r.job_card_id = ? ORDER BY r.id DESC', [$jobId]);
    $items = request_items(array_map(static fn ($r) => (int) $r['id'], $reqs));
    foreach ($reqs as &$r) {
        $r['items'] = $items[(int) $r['id']] ?? [];
    }
    unset($r);
    return $reqs;
}

function request_by_id(int $id): array
{
    $r = row(
        'SELECT r.*, u.name AS requested_by_name, j.job_no, j.status AS job_status, j.mechanic_id, v.reg_no, v.make, v.model, m.name AS mechanic_name
         FROM part_requests r JOIN users u ON u.id = r.requested_by JOIN job_cards j ON j.id = r.job_card_id
         JOIN vehicles v ON v.id = j.vehicle_id LEFT JOIN users m ON m.id = j.mechanic_id WHERE r.id = ?',
        [$id]
    ) ?? not_found('Parts request');
    $r['items'] = request_items([$id])[$id] ?? [];
    return $r;
}

/** Item row locked for update, checked to belong to the request. */
function lock_item(int $requestId, int $itemId): array
{
    $it = row('SELECT * FROM part_request_items WHERE id = ? AND request_id = ? FOR UPDATE', [$itemId, $requestId]) ?? not_found('Request line');
    return $it;
}

/** Close the request when every line is finished. */
function maybe_close_request(int $requestId): void
{
    $open = (int) val('SELECT COUNT(*) FROM part_request_items WHERE request_id = ? AND status IN (' . placeholders(LINE_OPEN) . ')', [$requestId, ...LINE_OPEN]);
    if ($open === 0) {
        q("UPDATE part_requests SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'", [now(), now(), $requestId]);
    }
}

function line_label(array $it): string
{
    return $it['part_id'] ? (string) val('SELECT name_en FROM parts WHERE id = ?', [$it['part_id']]) : (string) $it['custom_name'];
}

/** People to tell about a line: the requester and the job's mechanic. */
function line_audience(array $req): array
{
    return array_values(array_unique(array_filter([(int) $req['requested_by'], (int) $req['mechanic_id']])));
}

/* ------------------------------------------------------------------ list / read */

route('GET', '/requests', function () {
    [$limit, $offset] = paging(50, 200);
    $u = current_user();
    $where = [];
    $params = [];
    $status = qp('status', 'open');
    if (in_array($status, ['open', 'closed', 'cancelled'], true)) {
        $where[] = 'r.status = ?';
        $params[] = $status;
    }
    if ($u['role'] === ROLE_MECHANIC || qp('mine')) {
        $where[] = '(r.requested_by = ? OR j.mechanic_id = ?)';
        array_push($params, (int) $u['id'], (int) $u['id']);
    }
    if ($job = qp_int('job')) {
        $where[] = 'r.job_card_id = ?';
        $params[] = $job;
    }
    if (qp('tab') === 'approvals') {
        $where[] = "EXISTS (SELECT 1 FROM part_request_items x WHERE x.request_id = r.id AND x.status = 'needs_approval')";
    }
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $base = "FROM part_requests r JOIN job_cards j ON j.id = r.job_card_id JOIN vehicles v ON v.id = j.vehicle_id
             JOIN users u ON u.id = r.requested_by LEFT JOIN users m ON m.id = j.mechanic_id $w";
    $total = (int) val("SELECT COUNT(*) $base", $params);
    // Queue: oldest first. Closed history: newest first.
    $order = $status === 'open' ? 'r.id ASC' : 'r.id DESC';
    $reqs = rows("SELECT r.*, j.job_no, j.status AS job_status, j.mechanic_id, v.reg_no, v.make, v.model, u.name AS requested_by_name, m.name AS mechanic_name
                  $base ORDER BY $order LIMIT $limit OFFSET $offset", $params);
    $items = request_items(array_map(static fn ($r) => (int) $r['id'], $reqs));
    foreach ($reqs as &$r) {
        $r['items'] = $items[(int) $r['id']] ?? [];
    }
    unset($r);
    $counts = [
        'open' => (int) val("SELECT COUNT(*) FROM part_requests WHERE status = 'open'"),
        'approvals' => (int) val("SELECT COUNT(*) FROM part_request_items i JOIN part_requests r ON r.id = i.request_id WHERE r.status = 'open' AND i.status = 'needs_approval'"),
    ];
    return ['items' => $reqs, 'total' => $total, 'counts' => $counts, 'approval_limit' => approval_limit()];
});

route('GET', '/requests/{id}', function ($p) {
    $r = request_by_id((int) $p['id']);
    if (is_role(ROLE_MECHANIC) && (int) $r['requested_by'] !== uid() && (int) $r['mechanic_id'] !== uid()) {
        fail(403, 'not_your_job', 'This request is for another mechanic\'s job');
    }
    return ['item' => $r];
});

/* ------------------------------------------------------------------ raise a request */

route('POST', '/requests', function () {
    $body = body();
    $in = clean($body, ['job_card_id' => 'int|req', 'note' => 'str|max:255']);
    $job = job_row((int) $in['job_card_id']);
    job_access($job, true);
    if (!in_array($job['status'], JOB_REQUESTABLE, true)) {
        fail(409, 'job_not_approved', 'Parts can be requested only after the customer approves the estimate');
    }
    $itemsIn = $body['items'] ?? null;
    if (!is_array($itemsIn) || !$itemsIn) {
        fail(422, 'validation_failed', 'Add at least one part', ['items' => 'required']);
    }
    $lines = [];
    $errors = [];
    foreach (array_values($itemsIn) as $i => $raw) {
        try {
            $it = clean(is_array($raw) ? $raw : [], ['part_id' => 'int', 'custom_name' => 'str|max:150', 'qty' => 'num|req|min:0.01|max:1000']);
            if (!empty($it['part_id'])) {
                $part = row('SELECT id, name_en, selling_price FROM parts WHERE id = ? AND active = 1', [$it['part_id']]) ?? throw new ApiError(422, 'validation_failed', 'Unknown part', ['part_id' => 'invalid_choice']);
                $value = r2((float) $it['qty'] * (float) $part['selling_price']);
                $lines[] = ['part_id' => (int) $part['id'], 'custom_name' => null, 'qty' => (float) $it['qty'], 'line_value' => $value, 'status' => line_status_for($value), 'label' => $part['name_en']];
            } elseif (!empty($it['custom_name'])) {
                // Free-text part: linked to the catalogue by the inventory manager before approval / issue.
                $lines[] = ['part_id' => null, 'custom_name' => $it['custom_name'], 'qty' => (float) $it['qty'], 'line_value' => 0.0, 'status' => 'requested', 'label' => $it['custom_name']];
            } else {
                throw new ApiError(422, 'validation_failed', 'Choose a part or type its name', ['part_id' => 'required']);
            }
        } catch (ApiError $e) {
            $errors["items.$i"] = $e->fields ?: ['_' => $e->getMessage()];
        }
    }
    if ($errors) {
        fail(422, 'validation_failed', 'Some lines need attention', $errors);
    }

    $rid = tx(function () use ($job, $lines, $in) {
        $rid = insert('part_requests', ['job_card_id' => $job['id'], 'requested_by' => uid(), 'status' => 'open', 'note' => $in['note'] ?? null]);
        foreach ($lines as $l) {
            insert('part_request_items', [
                'request_id' => $rid,
                'part_id' => $l['part_id'],
                'custom_name' => $l['custom_name'],
                'qty' => $l['qty'],
                'issued_qty' => 0,
                'line_value' => $l['line_value'],
                'status' => $l['status'],
            ]);
        }
        job_event((int) $job['id'], 'request_created', ['request_id' => $rid, 'lines' => count($lines)]);
        return $rid;
    });

    $by = current_user()['name'];
    notify_users(user_ids_with_role(ROLE_INVENTORY), 'request_new', 'notify.request_new_title', 'notify.request_new_body',
        ['job' => $job['job_no'], 'reg' => $job['reg_no'], 'by' => $by], '#/requests');
    foreach ($lines as $l) {
        if ($l['status'] === 'needs_approval') {
            notify_users(user_ids_with_role(ROLE_OWNER, ROLE_INVENTORY), 'approval_needed', 'notify.approval_needed_title', 'notify.approval_needed_body',
                ['part' => $l['label'], 'qty' => fmt_qty($l['qty']), 'value' => inr($l['line_value']), 'job' => $job['job_no']], '#/requests?tab=approvals');
        }
    }
    return ['item' => request_by_id($rid)];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);

/* ------------------------------------------------------------------ approval (≥ limit) */

route('POST', '/requests/{id}/items/{iid}/approve', function ($p) {
    $rid = (int) $p['id'];
    tx(function () use ($rid, $p) {
        $it = lock_item($rid, (int) $p['iid']);
        if ($it['status'] !== 'needs_approval') {
            fail(409, 'not_waiting_approval', 'This line is not waiting for approval');
        }
        update_row('part_request_items', (int) $it['id'], ['status' => 'approved', 'approved_by' => uid(), 'approved_at' => now()]);
    });
    return ['item' => request_by_id($rid)];
}, ['perm' => 'issue_parts']);

route('POST', '/requests/{id}/items/{iid}/reject', function ($p) {
    $rid = (int) $p['id'];
    $in = clean(body(), ['reason' => 'str|req|max:200']);
    $it = tx(function () use ($rid, $p, $in) {
        $it = lock_item($rid, (int) $p['iid']);
        if (!in_array($it['status'], LINE_OPEN, true) || (float) $it['issued_qty'] > 0) {
            fail(409, 'line_closed', 'This line can no longer be rejected');
        }
        update_row('part_request_items', (int) $it['id'], ['status' => 'rejected', 'remark' => $in['reason'], 'approved_by' => uid(), 'approved_at' => now(), 'handled_by' => uid(), 'handled_at' => now()]);
        maybe_close_request($rid);
        return $it;
    });
    $req = request_by_id($rid);
    notify_users(line_audience($req), 'line_rejected', 'notify.line_rejected_title', 'notify.line_rejected_body',
        ['part' => line_label($it), 'job' => $req['job_no'], 'reason' => $in['reason']], '#/jobs/' . $req['job_card_id']);
    return ['item' => $req];
}, ['perm' => 'issue_parts']);

/* ------------------------------------------------------------------ link a free-text line to the catalogue */

route('POST', '/requests/{id}/items/{iid}/link', function ($p) {
    $rid = (int) $p['id'];
    $in = clean(body(), ['part_id' => 'int|req']);
    tx(function () use ($rid, $p, $in) {
        $it = lock_item($rid, (int) $p['iid']);
        if (!in_array($it['status'], LINE_OPEN, true) || (float) $it['issued_qty'] > 0) {
            fail(409, 'line_closed', 'This line is already handled');
        }
        $part = row('SELECT id, selling_price FROM parts WHERE id = ? AND active = 1', [$in['part_id']]) ?? not_found('Part');
        $value = r2((float) $it['qty'] * (float) $part['selling_price']);
        // The approval rule is evaluated now that the price is known (decision 4).
        update_row('part_request_items', (int) $it['id'], ['part_id' => $part['id'], 'line_value' => $value, 'status' => line_status_for($value)]);
    });
    $req = request_by_id($rid);
    foreach ($req['items'] as $it) {
        if ((int) $it['id'] === (int) $p['iid'] && $it['status'] === 'needs_approval') {
            notify_users(user_ids_with_role(ROLE_OWNER, ROLE_INVENTORY), 'approval_needed', 'notify.approval_needed_title', 'notify.approval_needed_body',
                ['part' => $it['name_en'], 'qty' => fmt_qty((float) $it['qty']), 'value' => inr((float) $it['line_value']), 'job' => $req['job_no']], '#/requests?tab=approvals');
        }
    }
    return ['item' => $req];
}, ['perm' => 'issue_parts']);

/* ------------------------------------------------------------------ issue */

/**
 * Issue $qty of a line (null = everything still open). Inside tx(). Returns [item, issuedQty].
 * Refuses lines waiting for approval, unlinked free-text lines, and more than in stock.
 */
function issue_line(array $req, int $itemId, ?float $qty): array
{
    $it = lock_item((int) $req['id'], $itemId);
    if (!in_array($it['status'], ['requested', 'approved'], true)) {
        fail(409, $it['status'] === 'needs_approval' ? 'needs_approval' : 'line_closed',
            $it['status'] === 'needs_approval' ? 'This line needs approval before it can be issued' : 'This line is already handled');
    }
    if (!$it['part_id']) {
        fail(409, 'link_part_first', 'Link this line to a catalogue part first');
    }
    if (!in_array($req['job_status'], JOB_REQUESTABLE, true)) {
        fail(409, 'job_not_open', 'The job is not open for parts');
    }
    $remaining = r2((float) $it['qty'] - (float) $it['issued_qty']);
    $qty = $qty === null ? $remaining : r2($qty);
    if ($qty <= 0 || $qty > $remaining + 0.0001) {
        fail(422, 'validation_failed', 'Issue between 0 and ' . fmt_qty($remaining), ['qty' => 'out_of_range']);
    }
    $part = row('SELECT id, selling_price FROM parts WHERE id = ?', [$it['part_id']]);
    $mv = stock_move((int) $it['part_id'], -$qty, 'job_issue', 'job', (int) $req['job_card_id'], null, 'Request #' . $req['id']);
    $agreed = consume_planned_part((int) $req['job_card_id'], (int) $it['part_id'], $qty);
    insert('job_parts', [
        'job_card_id' => $req['job_card_id'],
        'part_id' => $it['part_id'],
        'qty' => $qty,
        'returned_qty' => 0,
        'unit_price' => $agreed ?? $part['selling_price'],
        'unit_cost' => $mv['unit_cost'],
        'request_item_id' => $it['id'],
        'issued_by' => uid(),
        'issued_at' => now(),
    ]);
    $issued = r2((float) $it['issued_qty'] + $qty);
    update_row('part_request_items', (int) $it['id'], [
        'issued_qty' => $issued,
        // Partial issue keeps the line open until everything is issued (decision 5).
        'status' => $issued + 0.0001 >= (float) $it['qty'] ? 'issued' : $it['status'],
        'handled_by' => uid(),
        'handled_at' => now(),
    ]);
    job_event((int) $req['job_card_id'], 'parts_issued', ['part' => line_label($it), 'qty' => $qty]);
    return [$it, $qty];
}

route('POST', '/requests/{id}/items/{iid}/issue', function ($p) {
    $req = request_by_id((int) $p['id']);
    $in = clean(body(), ['qty' => 'num|min:0.01|max:1000']);
    [$it, $qty] = tx(function () use ($req, $p, $in) {
        $res = issue_line($req, (int) $p['iid'], isset($in['qty']) ? (float) $in['qty'] : null);
        maybe_close_request((int) $req['id']);
        return $res;
    });
    notify_users(line_audience($req), 'parts_issued', 'notify.parts_issued_title', 'notify.parts_issued_body',
        ['part' => line_label($it), 'qty' => fmt_qty($qty), 'job' => $req['job_no']], '#/jobs/' . $req['job_card_id']);
    return ['item' => request_by_id((int) $req['id'])];
}, ['perm' => 'issue_parts']);

/* Issue every line that can be issued in full; report the rest. */
route('POST', '/requests/{id}/issue-all', function ($p) {
    $req = request_by_id((int) $p['id']);
    $issued = [];
    $skipped = [];
    foreach ($req['items'] as $it) {
        if (!in_array($it['status'], ['requested', 'approved'], true)) {
            continue;
        }
        try {
            [$line, $qty] = tx(fn () => issue_line($req, (int) $it['id'], null));
            $issued[] = ['part' => line_label($line), 'qty' => $qty];
        } catch (ApiError $e) {
            $skipped[] = ['item_id' => (int) $it['id'], 'part' => $it['name_en'] ?? $it['custom_name'], 'code' => $e->errCode, 'error' => $e->getMessage()];
        }
    }
    tx(fn () => maybe_close_request((int) $req['id']));
    if ($issued) {
        $parts = implode(', ', array_map(static fn ($x) => $x['part'] . ' × ' . fmt_qty($x['qty']), $issued));
        notify_users(line_audience($req), 'parts_issued', 'notify.parts_issued_title', 'notify.parts_issued_body',
            ['part' => mb_substr($parts, 0, 120), 'qty' => count($issued), 'job' => $req['job_no']], '#/jobs/' . $req['job_card_id']);
    }
    return ['item' => request_by_id((int) $req['id']), 'issued' => $issued, 'skipped' => $skipped];
}, ['perm' => 'issue_parts']);

route('POST', '/requests/{id}/items/{iid}/unavailable', function ($p) {
    $req = request_by_id((int) $p['id']);
    $in = clean(body(), ['remark' => 'str|max:200']);
    $it = tx(function () use ($req, $p, $in) {
        $it = lock_item((int) $req['id'], (int) $p['iid']);
        if (!in_array($it['status'], LINE_OPEN, true)) {
            fail(409, 'line_closed', 'This line is already handled');
        }
        update_row('part_request_items', (int) $it['id'], ['status' => 'unavailable', 'remark' => $in['remark'] ?? null, 'handled_by' => uid(), 'handled_at' => now()]);
        job_event((int) $req['job_card_id'], 'parts_unavailable', ['part' => line_label($it), 'remark' => $in['remark'] ?? null]);
        maybe_close_request((int) $req['id']);
        return $it;
    });
    notify_users(line_audience($req), 'parts_unavailable', 'notify.parts_unavailable_title', 'notify.parts_unavailable_body',
        ['part' => line_label($it), 'job' => $req['job_no'], 'remark' => !empty($in['remark']) ? '· ' . $in['remark'] : ''], '#/jobs/' . $req['job_card_id']);
    return ['item' => request_by_id((int) $req['id'])];
}, ['perm' => 'issue_parts']);

route('POST', '/requests/{id}/cancel', function ($p) {
    $req = request_by_id((int) $p['id']);
    if (is_role(ROLE_MECHANIC) && (int) $req['requested_by'] !== uid() && (int) $req['mechanic_id'] !== uid()) {
        fail(403, 'not_your_job', 'This request is for another mechanic\'s job');
    }
    tx(function () use ($req) {
        q("UPDATE part_request_items SET status = 'cancelled', updated_at = ? WHERE request_id = ? AND status IN ('requested','needs_approval','approved') AND issued_qty = 0", [now(), $req['id']]);
        // Partly issued lines end as issued for what was given.
        q("UPDATE part_request_items SET status = 'issued', updated_at = ? WHERE request_id = ? AND status IN ('requested','needs_approval','approved') AND issued_qty > 0", [now(), $req['id']]);
        q("UPDATE part_requests SET status = 'cancelled', closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'", [now(), now(), $req['id']]);
    });
    return ['item' => request_by_id((int) $req['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);
