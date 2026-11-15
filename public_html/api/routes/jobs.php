<?php
declare(strict_types=1);

const JOB_RULES = [
    'odometer' => 'int|min:0|max:9999999',
    'fuel_level' => 'enum:E,1/4,1/2,3/4,F',
    'complaint' => 'text|max:2000',
    'inspection_notes' => 'text|max:4000',
    'mechanic_id' => 'int',
    'promised_at' => 'datetime',
];

const PHOTO_MAX = 4;
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

function check_mechanic(?int $id): void
{
    if ($id && !val("SELECT id FROM users WHERE id = ? AND role = 'mechanic' AND active = 1", [$id])) {
        fail(422, 'validation_failed', 'Choose an active mechanic', ['mechanic_id' => 'invalid_choice']);
    }
}

/** Full job detail for the job screen. */
function job_detail(int $id): array
{
    $j = job_row($id);
    $j['estimates'] = rows('SELECT e.*, u.name AS approved_by_name FROM estimates e LEFT JOIN users u ON u.id = e.approved_by WHERE e.job_card_id = ? ORDER BY e.version DESC', [$id]);
    $itemsBy = [];
    if ($j['estimates']) {
        $eids = array_map(static fn ($e) => (int) $e['id'], $j['estimates']);
        foreach (rows('SELECT * FROM estimate_items WHERE estimate_id IN (' . placeholders($eids) . ') ORDER BY id', $eids) as $it) {
            $itemsBy[(int) $it['estimate_id']][] = $it;
        }
    }
    foreach ($j['estimates'] as &$e) {
        $e['items'] = $itemsBy[(int) $e['id']] ?? [];
        unset($e['approval_token']);
    }
    unset($e);
    $j['labour'] = rows('SELECT jl.*, u.name AS user_name FROM job_labour jl LEFT JOIN users u ON u.id = jl.user_id WHERE jl.job_card_id = ? ORDER BY jl.id', [$id]);
    $j['parts'] = rows(
        'SELECT jp.*, p.part_no, p.name_en, p.name_mr, p.unit, u.name AS issued_by_name
         FROM job_parts jp JOIN parts p ON p.id = jp.part_id LEFT JOIN users u ON u.id = jp.issued_by
         WHERE jp.job_card_id = ? AND (jp.issued = 1 OR jp.qty > 0) ORDER BY jp.id',
        [$id]
    );
    $j['requests'] = requests_for_job($id);
    $j['photos'] = rows('SELECT id, created_at FROM job_photos WHERE job_card_id = ? ORDER BY id', [$id]);
    $j['invoice'] = $j['invoice_id'] ? row('SELECT id, invoice_no, status, grand_total, balance, pay_status FROM invoices WHERE id = ?', [$j['invoice_id']]) : null;
    $j['money'] = job_money($j);
    $j['timeline'] = rows(
        "SELECT a.action, a.after_json, a.created_at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.entity = 'job' AND a.entity_id = ? ORDER BY a.id",
        [$id]
    );
    foreach ($j['timeline'] as &$ev) {
        $ev['data'] = $ev['after_json'] ? json_decode($ev['after_json'], true) : null;
        unset($ev['after_json']);
    }
    unset($ev);
    // "Delivered" is offered only once the bill is final.
    $billed = $j['invoice'] && $j['invoice']['status'] === 'final';
    $j['allowed_status'] = array_values(array_filter(JOB_TRANSITIONS[$j['status']] ?? [], static fn ($s) => $s !== 'delivered' || $billed));
    $j['can_approve'] = !in_array($j['status'], ['delivered', 'cancelled'], true) && !$billed
        && (in_array($j['status'], ['pending', 'estimate_sent'], true) || $j['money']['revision_pending']);
    return strip_cost($j);
}

route('GET', '/jobs', function () {
    [$limit, $offset] = paging(100, 500);
    $u = current_user();
    $where = [];
    $params = [];
    if ($u['role'] === ROLE_MECHANIC) {
        $where[] = 'j.mechanic_id = ?';
        $params[] = (int) $u['id'];
    } elseif ($mech = qp_int('mechanic')) {
        $where[] = 'j.mechanic_id = ?';
        $params[] = $mech;
    }
    $status = qp('status');
    if ($status && in_array($status, JOB_STATUSES, true)) {
        $where[] = 'j.status = ?';
        $params[] = $status;
    } elseif (qp('board') || qp('active')) {
        // Board: open jobs plus those delivered today
        $where[] = "(j.status IN ('" . implode("','", JOB_OPEN) . "') OR (j.status = 'delivered' AND j.delivered_at >= ?))";
        $params[] = today() . ' 00:00:00';
    }
    if (($term = qp('q')) !== null && $term !== '') {
        $like = like($term);
        $where[] = '(j.job_no LIKE ? OR v.reg_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)';
        array_push($params, $like, like(normalize_reg_no($term)), $like, $like);
    }
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $base = "FROM job_cards j JOIN customers c ON c.id = j.customer_id JOIN vehicles v ON v.id = j.vehicle_id LEFT JOIN users m ON m.id = j.mechanic_id $w";
    $total = (int) val("SELECT COUNT(*) $base", $params);
    $items = rows(
        "SELECT j.id, j.job_no, j.status, j.complaint, j.promised_at, j.created_at, j.delivered_at, j.mechanic_id, j.approved_estimate_id,
                c.name AS customer_name, c.phone AS customer_phone, v.reg_no, v.make, v.model, m.name AS mechanic_name,
                (SELECT COUNT(*) FROM part_request_items i JOIN part_requests r ON r.id = i.request_id WHERE r.job_card_id = j.id AND r.status = 'open' AND i.status IN ('requested','approved')) AS open_lines,
                (SELECT COUNT(*) FROM part_request_items i JOIN part_requests r ON r.id = i.request_id WHERE r.job_card_id = j.id AND r.status = 'open' AND i.status = 'needs_approval') AS approval_lines
         $base ORDER BY FIELD(j.status, 'ready','waiting_parts','in_progress','approved','estimate_sent','pending','delivered','cancelled'), j.promised_at IS NULL, j.promised_at, j.id DESC
         LIMIT $limit OFFSET $offset",
        $params
    );
    return ['items' => $items, 'total' => $total];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC, ROLE_INVENTORY]]);

/*
 * New job card. Either customer_id + vehicle_id, or quick-create:
 *   customer: {name, phone, ...}  vehicle: {reg_no, make, model, ...}
 */
route('POST', '/jobs', function () {
    $body = body();
    $in = clean($body, JOB_RULES + ['customer_id' => 'int', 'vehicle_id' => 'int']);
    check_mechanic($in['mechanic_id'] ?? null);

    $jobId = tx(function () use ($in, $body) {
        $customerId = $in['customer_id'] ?? null;
        if (!$customerId) {
            $c = prepare_customer_input(clean(is_array($body['customer'] ?? null) ? $body['customer'] : [], CUSTOMER_RULES));
            $existing = val('SELECT id FROM customers WHERE phone = ?', [$c['phone']]);
            $customerId = $existing ? (int) $existing : insert('customers', $c + ['language' => 'mr', 'state_code' => setting('shop_state_code', '27')]);
        } elseif (!val('SELECT id FROM customers WHERE id = ?', [$customerId])) {
            fail(422, 'validation_failed', 'Unknown customer', ['customer_id' => 'invalid_choice']);
        }
        $vehicleId = $in['vehicle_id'] ?? null;
        if (!$vehicleId) {
            $raw = is_array($body['vehicle'] ?? null) ? $body['vehicle'] : [];
            $reg = normalize_reg_no((string) ($raw['reg_no'] ?? ''));
            $found = $reg ? row('SELECT id, customer_id FROM vehicles WHERE reg_no = ?', [$reg]) : null;
            if ($found && (int) $found['customer_id'] !== (int) $customerId) {
                fail(409, 'vehicle_other_customer', 'This bike number belongs to another customer', ['reg_no' => 'duplicate']);
            }
            $vehicleId = $found ? (int) $found['id'] : create_vehicle((int) $customerId, $raw);
        } elseif (!val('SELECT id FROM vehicles WHERE id = ? AND customer_id = ?', [$vehicleId, $customerId])) {
            fail(422, 'validation_failed', 'This bike does not belong to the customer', ['vehicle_id' => 'invalid_choice']);
        }
        $open = row("SELECT job_no FROM job_cards WHERE vehicle_id = ? AND status NOT IN ('delivered','cancelled')", [$vehicleId]);
        if ($open) {
            fail(409, 'job_open', "This bike already has an open job card ({$open['job_no']})");
        }
        $id = insert('job_cards', [
            'job_no' => next_job_no(),
            'customer_id' => $customerId,
            'vehicle_id' => $vehicleId,
            'odometer' => $in['odometer'] ?? null,
            'fuel_level' => $in['fuel_level'] ?? null,
            'complaint' => $in['complaint'] ?? null,
            'mechanic_id' => $in['mechanic_id'] ?? null,
            'promised_at' => $in['promised_at'] ?? null,
            'status' => 'pending',
            'created_by' => uid(),
        ]);
        if (!empty($in['odometer'])) {
            q('UPDATE vehicles SET last_odometer = GREATEST(COALESCE(last_odometer, 0), ?), updated_at = ? WHERE id = ?', [$in['odometer'], now(), $vehicleId]);
        }
        job_event($id, 'job_created', ['status' => 'pending']);
        return $id;
    });
    // A job made from a scanned paper card keeps the card photo.
    $scan = is_string($body['scan_id'] ?? null) ? job_card_scan_file($body['scan_id']) : null;
    if ($scan) {
        $dir = photo_dir($jobId);
        if ((is_dir($dir) || mkdir($dir, 0750, true)) && rename($scan, $dir . '/' . basename($scan))) {
            insert('job_photos', ['job_card_id' => $jobId, 'path' => $jobId . '/' . basename($scan), 'user_id' => uid()]);
        }
    }
    $job = job_row($jobId);
    if ($job['mechanic_id']) {
        notify_users([(int) $job['mechanic_id']], 'job_assigned', 'notify.job_assigned_title', 'notify.job_assigned_body',
            ['job' => $job['job_no'], 'reg' => $job['reg_no'], 'complaint' => mb_substr((string) $job['complaint'], 0, 60)], '#/jobs/' . $jobId);
    }
    return ['item' => job_detail($jobId)];
}, ['perm' => 'jobs']);

/* Read a photo of a handwritten paper job card (Gemini) → fields to pre-fill New job. Staff check before saving. */
route('POST', '/jobs/scan-card', function () {
    if (!job_card_scan_enabled()) {
        fail(409, 'scan_not_configured', 'Reading job cards is not set up on this server');
    }
    if (job_card_scans_last_hour() >= JOBCARD_SCANS_PER_HOUR) {
        fail(429, 'scan_limit', 'Too many job card scans in the last hour');
    }
    $f = $_FILES['photo'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        fail(422, 'validation_failed', 'Choose a photo', ['photo' => 'required']);
    }
    if ($f['size'] > PHOTO_MAX_BYTES) {
        fail(422, 'validation_failed', 'Photo is too large (max 6 MB)', ['photo' => 'too_long']);
    }
    $info = @getimagesize($f['tmp_name']);
    $ext = match ($info[2] ?? 0) {
        IMAGETYPE_JPEG => 'jpg',
        IMAGETYPE_PNG => 'png',
        IMAGETYPE_WEBP => 'webp',
        default => null,
    };
    if (!$ext) {
        fail(422, 'validation_failed', 'Only JPEG, PNG or WebP photos', ['photo' => 'invalid']);
    }
    $mechanics = rows("SELECT id, name FROM users WHERE role = 'mechanic' AND active = 1 ORDER BY name");
    $scanId = job_card_store($f['tmp_name'], $ext);
    $raw = gemini_read_job_card(JOBCARD_SCAN_DIR . "/$scanId.$ext", (string) $info['mime'], $mechanics);
    return ['scan_id' => $scanId] + job_card_normalize($raw, $mechanics);
}, ['perm' => 'jobs']);

route('GET', '/jobs/{id}', function ($p) {
    $j = job_row((int) $p['id']);
    job_access($j);
    return ['item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC, ROLE_INVENTORY]]);

route('PUT', '/jobs/{id}', function ($p) {
    $j = job_row((int) $p['id']);
    job_access($j, true);
    if (in_array($j['status'], ['delivered', 'cancelled'], true)) {
        fail(409, 'job_closed', 'This job is closed');
    }
    // Mechanics may only write inspection notes on their own jobs.
    $rules = is_role(ROLE_MECHANIC) ? ['inspection_notes' => JOB_RULES['inspection_notes']] : JOB_RULES;
    $in = clean(body(), $rules, true);
    if (array_key_exists('mechanic_id', $in)) {
        check_mechanic($in['mechanic_id']);
    }
    update_row('job_cards', (int) $j['id'], $in);
    if (!empty($in['odometer'])) {
        q('UPDATE vehicles SET last_odometer = GREATEST(COALESCE(last_odometer, 0), ?), updated_at = ? WHERE id = ?', [$in['odometer'], now(), $j['vehicle_id']]);
    }
    if (!empty($in['mechanic_id']) && (int) $in['mechanic_id'] !== (int) $j['mechanic_id']) {
        notify_users([(int) $in['mechanic_id']], 'job_assigned', 'notify.job_assigned_title', 'notify.job_assigned_body',
            ['job' => $j['job_no'], 'reg' => $j['reg_no'], 'complaint' => mb_substr((string) $j['complaint'], 0, 60)], '#/jobs/' . $j['id']);
        job_event((int) $j['id'], 'job_mechanic', ['mechanic_id' => $in['mechanic_id']]);
    }
    return ['item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);

route('POST', '/jobs/{id}/status', function ($p) {
    $j = job_row((int) $p['id']);
    job_access($j, true);
    $in = clean(body(), ['status' => 'enum:' . implode(',', JOB_STATUSES) . '|req', 'note' => 'str|max:255']);
    $to = $in['status'];
    $from = $j['status'];
    if (!in_array($to, JOB_TRANSITIONS[$from] ?? [], true)) {
        fail(409, 'bad_transition', "Cannot change status from $from to $to");
    }
    if (is_role(ROLE_MECHANIC) && in_array($to, ['cancelled', 'delivered'], true)) {
        fail(403, 'forbidden', 'Only the front desk or owner can do this');
    }
    if ($to === 'cancelled') {
        if (empty($in['note'])) {
            fail(422, 'validation_failed', 'Give a reason for cancelling', ['note' => 'required']);
        }
        $held = (float) val('SELECT COALESCE(SUM(qty - returned_qty), 0) FROM job_parts WHERE job_card_id = ? AND issued = 1', [$j['id']]);
        if ($held > 0) {
            fail(409, 'return_parts_first', 'Return the issued parts to stock before cancelling');
        }
    }
    if ($to === 'delivered') {
        $inv = $j['invoice_id'] ? row('SELECT status FROM invoices WHERE id = ?', [$j['invoice_id']]) : null;
        if (!$inv || $inv['status'] !== 'final') {
            fail(409, 'invoice_required', 'Create the final bill before delivering the bike');
        }
    }
    tx(function () use ($j, $to, $from, $in) {
        $data = ['status' => $to];
        if ($to === 'delivered') {
            $data['delivered_at'] = now();
            q('UPDATE vehicles SET last_service_on = ?, last_service_odometer = COALESCE(?, last_service_odometer), updated_at = ? WHERE id = ?', [today(), $j['odometer'], now(), $j['vehicle_id']]);
        }
        if ($to === 'cancelled') {
            $data['cancel_reason'] = $in['note'];
            q("UPDATE part_request_items i JOIN part_requests r ON r.id = i.request_id SET i.status = 'cancelled', i.updated_at = ?
               WHERE r.job_card_id = ? AND i.status IN ('requested','needs_approval','approved')", [now(), $j['id']]);
            q("UPDATE part_requests SET status = 'cancelled', closed_at = ?, updated_at = ? WHERE job_card_id = ? AND status = 'open'", [now(), now(), $j['id']]);
        }
        update_row('job_cards', (int) $j['id'], $data);
        job_event((int) $j['id'], 'job_status', ['from' => $from, 'to' => $to, 'note' => $in['note'] ?? null]);
    });
    if ($to === 'ready') {
        notify_users(user_ids_with_perm(['jobs', 'make_bills']), 'bike_ready', 'notify.bike_ready_title', 'notify.bike_ready_body', ['job' => $j['job_no'], 'reg' => $j['reg_no']], '#/jobs/' . $j['id']);
    }
    return ['item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);

/* ------------------------------------------------------------------ labour */

route('POST', '/jobs/{id}/labour', function ($p) {
    $j = job_row((int) $p['id']);
    job_access($j, true);
    if (job_locked($j)) {
        fail(409, 'job_closed', 'This job is billed or closed');
    }
    $in = clean(body(), ['labour_rate_id' => 'int', 'description' => 'str|max:150', 'description_mr' => 'str|max:150', 'amount' => 'num|min:0|max:1000000']);
    $rate = !empty($in['labour_rate_id']) ? row('SELECT * FROM labour_rates WHERE id = ? AND active = 1', [$in['labour_rate_id']]) : null;
    if (!empty($in['labour_rate_id']) && !$rate) {
        fail(422, 'validation_failed', 'Unknown labour item', ['labour_rate_id' => 'invalid_choice']);
    }
    if (is_role(ROLE_MECHANIC)) {
        // Mechanics add labour from the rate list at the listed amount.
        if (!$rate) {
            fail(422, 'validation_failed', 'Choose labour from the rate list', ['labour_rate_id' => 'required']);
        }
        $in['amount'] = null;
    }
    $desc = $in['description'] ?? ($rate['name_en'] ?? null);
    if (!$desc) {
        fail(422, 'validation_failed', 'Describe the labour', ['description' => 'required']);
    }
    $amount = $in['amount'] ?? ($rate ? (float) $rate['amount'] : null);
    if ($amount === null) {
        fail(422, 'validation_failed', 'Enter the amount', ['amount' => 'required']);
    }
    insert('job_labour', [
        'job_card_id' => $j['id'],
        'labour_rate_id' => $rate['id'] ?? null,
        'description' => $desc,
        'description_mr' => $in['description_mr'] ?? ($rate['name_mr'] ?? null),
        'amount' => r2((float) $amount),
        'user_id' => uid(),
    ]);
    return ['item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);

route('DELETE', '/jobs/{id}/labour/{lid}', function ($p) {
    $j = job_row((int) $p['id']);
    job_access($j, true);
    if (job_locked($j)) {
        fail(409, 'job_closed', 'This job is billed or closed');
    }
    $l = row('SELECT * FROM job_labour WHERE id = ? AND job_card_id = ?', [(int) $p['lid'], $j['id']]) ?? not_found('Labour line');
    if (is_role(ROLE_MECHANIC) && (int) $l['user_id'] !== uid()) {
        fail(403, 'forbidden', 'You can remove only labour you added');
    }
    q('DELETE FROM job_labour WHERE id = ?', [$l['id']]);
    return ['item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);

/* ------------------------------------------------------------------ photos (stored outside the web root) */

function photo_dir(int $jobId): string
{
    return API_DIR . '/storage/photos/' . $jobId;
}

route('POST', '/jobs/{id}/photos', function ($p) {
    $j = job_row((int) $p['id']);
    job_access($j, true);
    if ((int) val('SELECT COUNT(*) FROM job_photos WHERE job_card_id = ?', [$j['id']]) >= PHOTO_MAX) {
        fail(409, 'too_many_photos', 'Up to ' . PHOTO_MAX . ' photos per job');
    }
    $f = $_FILES['photo'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        fail(422, 'validation_failed', 'Choose a photo', ['photo' => 'required']);
    }
    if ($f['size'] > PHOTO_MAX_BYTES) {
        fail(422, 'validation_failed', 'Photo is too large (max 6 MB)', ['photo' => 'too_long']);
    }
    $info = @getimagesize($f['tmp_name']);
    $ext = match ($info[2] ?? 0) {
        IMAGETYPE_JPEG => 'jpg',
        IMAGETYPE_PNG => 'png',
        IMAGETYPE_WEBP => 'webp',
        default => null,
    };
    if (!$ext) {
        fail(422, 'validation_failed', 'Only JPEG, PNG or WebP photos', ['photo' => 'invalid']);
    }
    $dir = photo_dir((int) $j['id']);
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        fail(500, 'storage_error', 'Cannot save the photo on the server');
    }
    $name = bin2hex(random_bytes(12)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], "$dir/$name") && !rename($f['tmp_name'], "$dir/$name")) {
        fail(500, 'storage_error', 'Cannot save the photo on the server');
    }
    insert('job_photos', ['job_card_id' => $j['id'], 'path' => $j['id'] . '/' . $name, 'user_id' => uid()]);
    return ['item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);

route('GET', '/jobs/{id}/photos/{pid}', function ($p) {
    $j = job_row((int) $p['id']);
    job_access($j);
    $ph = row('SELECT * FROM job_photos WHERE id = ? AND job_card_id = ?', [(int) $p['pid'], $j['id']]) ?? not_found('Photo');
    $file = API_DIR . '/storage/photos/' . $ph['path'];
    if (!is_file($file)) {
        not_found('Photo');
    }
    $type = match (strtolower(pathinfo($file, PATHINFO_EXTENSION))) {
        'png' => 'image/png',
        'webp' => 'image/webp',
        default => 'image/jpeg',
    };
    return new RawResponse((string) file_get_contents($file), $type, 200, ['Cache-Control' => 'private, max-age=86400']);
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC, ROLE_INVENTORY]]);

route('DELETE', '/jobs/{id}/photos/{pid}', function ($p) {
    $j = job_row((int) $p['id']);
    job_access($j, true);
    $ph = row('SELECT * FROM job_photos WHERE id = ? AND job_card_id = ?', [(int) $p['pid'], $j['id']]) ?? not_found('Photo');
    q('DELETE FROM job_photos WHERE id = ?', [$ph['id']]);
    @unlink(API_DIR . '/storage/photos/' . $ph['path']);
    return ['item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);

/* ------------------------------------------------------------------ returns: unused parts back to stock */

route('POST', '/jobs/{id}/return', function ($p) {
    $j = job_row((int) $p['id']);
    if (job_locked($j) && $j['status'] !== 'cancelled') {
        fail(409, 'job_closed', 'This job is already billed');
    }
    $in = clean(body(), ['job_part_id' => 'int|req', 'qty' => 'num|req|min:0.01|max:100000', 'reason' => 'str|max:200']);
    tx(function () use ($j, $in) {
        $jp = row('SELECT * FROM job_parts WHERE id = ? AND job_card_id = ? AND issued = 1 FOR UPDATE', [$in['job_part_id'], $j['id']]) ?? not_found('Issued part');
        $left = r2((float) $jp['qty'] - (float) $jp['returned_qty']);
        if ((float) $in['qty'] > $left + 0.0001) {
            fail(409, 'return_too_much', 'Only ' . fmt_qty($left) . ' can be returned');
        }
        stock_move((int) $jp['part_id'], (float) $in['qty'], 'job_return', 'job', (int) $j['id'], (float) $jp['unit_cost'], $in['reason'] ?? 'Unused part returned');
        q('UPDATE job_parts SET returned_qty = returned_qty + ?, updated_at = ? WHERE id = ?', [$in['qty'], now(), $jp['id']]);
        job_event((int) $j['id'], 'job_part_return', ['part_id' => (int) $jp['part_id'], 'qty' => (float) $in['qty']]);
    });
    return ['item' => job_detail((int) $j['id'])];
}, ['perm' => 'issue_parts']);

/* ------------------------------------------------------------------ approve at the counter */

/*
 * The customer agreed in person: approve the job. Approves the latest estimate if there is one (its parts and
 * labour go onto the job), otherwise just marks the job approved so work and billing can start.
 */
route('POST', '/jobs/{id}/approve', function ($p) {
    $j = job_row((int) $p['id']);
    $in = clean(body(), ['note' => 'str|max:255']);
    if (job_locked($j)) {
        fail(409, 'job_closed', 'This job is closed or already billed');
    }
    $latest = row("SELECT * FROM estimates WHERE job_card_id = ? AND status IN ('draft','sent') ORDER BY id DESC LIMIT 1", [$j['id']]);
    if (!$latest && !in_array($j['status'], ['pending', 'estimate_sent'], true)) {
        fail(409, 'already_approved', 'This job is already approved');
    }
    tx(function () use ($j, $latest, $in) {
        if ($latest) {
            $latest['items'] = rows('SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY id', [$latest['id']]);
            approve_estimate($latest, 'desk', $in['note'] ?? null);
        } else {
            update_row('job_cards', (int) $j['id'], ['status' => 'approved']);
            job_event((int) $j['id'], 'job_status', ['from' => $j['status'], 'to' => 'approved', 'note' => $in['note'] ?? null]);
        }
    });
    if ($latest) {
        notify_estimate_approved(job_row((int) $j['id']), $latest);
    }
    return ['item' => job_detail((int) $j['id'])];
}, ['perm' => 'jobs']);

/* Take a planned (estimate) part off the job before billing, e.g. the customer changed their mind. */
route('DELETE', '/jobs/{id}/parts/{jpid}', function ($p) {
    $j = job_row((int) $p['id']);
    if (job_locked($j)) {
        fail(409, 'job_closed', 'This job is closed or already billed');
    }
    $jp = row('SELECT * FROM job_parts WHERE id = ? AND job_card_id = ? AND issued = 0', [(int) $p['jpid'], $j['id']]) ?? not_found('Planned part');
    tx(function () use ($jp, $j) {
        q('UPDATE job_parts SET qty = 0, updated_at = ? WHERE id = ?', [now(), $jp['id']]);
        job_event((int) $j['id'], 'job_part_removed', ['part_id' => (int) $jp['part_id'], 'qty' => (float) $jp['qty']]);
    });
    return ['item' => job_detail((int) $j['id'])];
}, ['perm' => 'jobs']);

/* ------------------------------------------------------------------ WhatsApp: bike ready */

route('POST', '/jobs/{id}/whatsapp', function ($p) {
    $j = job_row((int) $p['id']);
    $in = clean(body(), ['template' => 'enum:ready|req']);
    $lang = $j['customer_language'] ?: 'mr';
    $text = wa_text($in['template'], ['name' => $j['customer_name'], 'reg' => $j['reg_no'], 'shop' => shop_name_for($lang)], $lang);
    log_message((int) $j['customer_id'], $in['template'], 'job', (int) $j['id'], $text);
    return ['url' => wa_url($j['customer_phone'], $text), 'text' => $text];
}, ['perm' => 'jobs']);
