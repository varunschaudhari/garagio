<?php
declare(strict_types=1);

/*
 * Estimates: parts at selling price + labour (editable). Versions v1, v2… per job.
 * Sent as a WhatsApp message with a public approval link (random 32-byte token, expires).
 */

function estimate_row(int $id): array
{
    $e = row('SELECT * FROM estimates WHERE id = ?', [$id]) ?? not_found('Estimate');
    $e['items'] = rows('SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY item_type DESC, id', [$id]);
    return $e;
}

/** Approve an estimate (by link or call) and move the job forward. Runs inside tx(). */
function approve_estimate(array $e, string $via, ?string $note = null): void
{
    $now = now();
    update_row('estimates', (int) $e['id'], [
        'status' => 'approved',
        'approved_via' => $via,
        'approved_at' => $now,
        'approved_by' => $via === 'call' ? (user_or_null()['id'] ?? null) : null,
        'note' => $note ?? $e['note'],
    ]);
    // Older sent estimates for this job are replaced by this one.
    q("UPDATE estimates SET status = 'superseded', updated_at = ? WHERE job_card_id = ? AND id <> ? AND status IN ('draft','sent')", [$now, $e['job_card_id'], $e['id']]);
    $job = row('SELECT * FROM job_cards WHERE id = ?', [$e['job_card_id']]);
    $data = ['approved_estimate_id' => $e['id']];
    if (in_array($job['status'], ['pending', 'estimate_sent'], true)) {
        $data['status'] = 'approved';
    }
    update_row('job_cards', (int) $job['id'], $data);
    // Approved labour goes onto the job so the bill needs no re-typing (skips lines already on the job).
    $have = array_map('mb_strtolower', array_column(rows('SELECT description FROM job_labour WHERE job_card_id = ?', [$job['id']]), 'description'));
    foreach ($e['items'] as $it) {
        if ($it['item_type'] !== 'labour' || in_array(mb_strtolower($it['description']), $have, true)) {
            continue;
        }
        insert('job_labour', [
            'job_card_id' => $job['id'],
            'labour_rate_id' => $it['labour_rate_id'],
            'description' => $it['description'],
            'description_mr' => $it['description_mr'],
            'amount' => $it['amount'],
            'user_id' => user_or_null()['id'] ?? null,
        ]);
        $have[] = mb_strtolower($it['description']);
    }
    job_event((int) $job['id'], 'estimate_approved', ['est_no' => $e['est_no'], 'via' => $via, 'total' => (float) $e['grand_total']]);
}

route('POST', '/jobs/{id}/estimates', function ($p) {
    $j = job_row((int) $p['id']);
    if (in_array($j['status'], ['delivered', 'cancelled'], true)) {
        fail(409, 'job_closed', 'This job is closed');
    }
    $body = body();
    $in = clean($body, ['note' => 'str|max:255']);
    $itemsIn = $body['items'] ?? null;
    if (!is_array($itemsIn) || !$itemsIn) {
        fail(422, 'validation_failed', 'Add at least one part or labour line', ['items' => 'required']);
    }
    $items = [];
    $errors = [];
    foreach (array_values($itemsIn) as $i => $raw) {
        try {
            $it = clean(is_array($raw) ? $raw : [], [
                'item_type' => 'enum:part,labour|req',
                'part_id' => 'int',
                'labour_rate_id' => 'int',
                'description' => 'str|max:150',
                'qty' => 'num|min:0.01|max:10000|def:1',
                'amount' => 'num|min:0|max:1000000',
                'unit_price' => 'num|min:0|max:1000000',
            ]);
            if ($it['item_type'] === 'part') {
                if (!empty($it['part_id'])) {
                    $part = row('SELECT id, name_en, name_mr, selling_price, gst_rate FROM parts WHERE id = ?', [$it['part_id']]) ?? throw new ApiError(422, 'validation_failed', 'Unknown part', ['part_id' => 'invalid_choice']);
                    // Catalogue parts are priced at the selling price.
                    $items[] = ['item_type' => 'part', 'part_id' => (int) $part['id'], 'labour_rate_id' => null, 'description' => $part['name_en'], 'description_mr' => $part['name_mr'],
                        'qty' => (float) $it['qty'], 'unit_price' => (float) $part['selling_price'], 'gst_rate' => (float) $part['gst_rate']];
                } else {
                    if (empty($it['description']) || !isset($it['unit_price'])) {
                        throw new ApiError(422, 'validation_failed', 'Describe the part and its price', ['description' => 'required']);
                    }
                    $items[] = ['item_type' => 'part', 'part_id' => null, 'labour_rate_id' => null, 'description' => $it['description'], 'description_mr' => null,
                        'qty' => (float) $it['qty'], 'unit_price' => (float) $it['unit_price'], 'gst_rate' => setting_num('default_part_gst_rate')];
                }
            } else {
                $rate = !empty($it['labour_rate_id']) ? row('SELECT * FROM labour_rates WHERE id = ?', [$it['labour_rate_id']]) : null;
                $desc = $it['description'] ?? ($rate['name_en'] ?? null);
                $amount = $it['amount'] ?? ($rate ? (float) $rate['amount'] : null);
                if (!$desc || $amount === null) {
                    throw new ApiError(422, 'validation_failed', 'Labour needs a description and amount', ['amount' => 'required']);
                }
                $items[] = ['item_type' => 'labour', 'part_id' => null, 'labour_rate_id' => $rate['id'] ?? null, 'description' => $desc, 'description_mr' => $rate['name_mr'] ?? null,
                    'qty' => 1.0, 'unit_price' => (float) $amount, 'gst_rate' => setting_num('labour_gst_rate')];
            }
        } catch (ApiError $e) {
            $errors["items.$i"] = $e->fields ?: ['_' => $e->getMessage()];
        }
    }
    if ($errors) {
        fail(422, 'validation_failed', 'Some lines need attention', $errors);
    }

    $bill = gst_bill(array_map(static fn ($i) => $i + ['disc_pct' => 0], $items), setting('prices_include_gst') === '1', false);
    $partsTotal = 0.0;
    $labourTotal = 0.0;
    foreach ($items as $it) {
        if ($it['item_type'] === 'part') {
            $partsTotal += $it['qty'] * $it['unit_price'];
        } else {
            $labourTotal += $it['unit_price'];
        }
    }

    $id = tx(function () use ($j, $items, $bill, $partsTotal, $labourTotal, $in) {
        // An unsent draft is replaced by the new version.
        q("UPDATE estimates SET status = 'superseded', updated_at = ? WHERE job_card_id = ? AND status = 'draft'", [now(), $j['id']]);
        $version = (int) val('SELECT COALESCE(MAX(version), 0) FROM estimates WHERE job_card_id = ?', [$j['id']]) + 1;
        $eid = insert('estimates', [
            'job_card_id' => $j['id'],
            'version' => $version,
            'est_no' => next_estimate_no(),
            'parts_total' => r2($partsTotal),
            'labour_total' => r2($labourTotal),
            'grand_total' => $bill['totals']['grand_total'],
            'status' => 'draft',
            'note' => $in['note'] ?? null,
            'created_by' => uid(),
        ]);
        foreach ($items as $it) {
            insert('estimate_items', [
                'estimate_id' => $eid,
                'item_type' => $it['item_type'],
                'part_id' => $it['part_id'],
                'labour_rate_id' => $it['labour_rate_id'],
                'description' => mb_substr($it['description'], 0, 150),
                'description_mr' => $it['description_mr'],
                'qty' => $it['qty'],
                'unit_price' => $it['unit_price'],
                'amount' => r2($it['qty'] * $it['unit_price']),
            ]);
        }
        job_event((int) $j['id'], 'estimate_created', ['version' => $version, 'total' => $bill['totals']['grand_total']]);
        return $eid;
    });
    return ['item' => estimate_row($id)];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

route('GET', '/estimates/{id}', function ($p) {
    $e = estimate_row((int) $p['id']);
    job_access(job_row((int) $e['job_card_id']));
    unset($e['approval_token']);
    return ['item' => $e];
}, ['roles' => [ROLE_OWNER, ROLE_DESK, ROLE_MECHANIC]]);

/* Send on WhatsApp: creates the public link and returns a wa.me URL with the bilingual message. */
route('POST', '/estimates/{id}/send', function ($p) {
    $e = estimate_row((int) $p['id']);
    if (!in_array($e['status'], ['draft', 'sent'], true)) {
        fail(409, 'estimate_closed', 'This estimate can no longer be sent');
    }
    $j = job_row((int) $e['job_card_id']);
    $token = $e['approval_token'] ?: random_token(32);
    $days = max(1, (int) setting('estimate_link_days', '7'));
    tx(function () use ($e, $j, $token, $days) {
        update_row('estimates', (int) $e['id'], [
            'status' => 'sent',
            'approval_token' => $token,
            'sent_at' => now(),
            'expires_at' => date('Y-m-d H:i:s', time() + $days * 86400),
        ]);
        q("UPDATE estimates SET status = 'superseded', updated_at = ? WHERE job_card_id = ? AND id <> ? AND status = 'sent'", [now(), $j['id'], $e['id']]);
        if ($j['status'] === 'pending') {
            update_row('job_cards', (int) $j['id'], ['status' => 'estimate_sent']);
        }
        job_event((int) $j['id'], 'estimate_sent', ['est_no' => $e['est_no'], 'total' => (float) $e['grand_total']]);
    });
    $link = app_url() . '/e/' . $token;
    $lang = $j['customer_language'] ?: 'mr';
    $text = wa_text('estimate', ['name' => $j['customer_name'], 'reg' => $j['reg_no'], 'est' => $e['est_no'], 'total' => inr((float) $e['grand_total']), 'link' => $link, 'shop' => shop_name_for($lang)], $lang);
    log_message((int) $j['customer_id'], 'estimate', 'estimate', (int) $e['id'], $text);
    return ['link' => $link, 'url' => wa_url($j['customer_phone'], $text), 'text' => $text, 'item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

route('POST', '/estimates/{id}/approve-call', function ($p) {
    $e = estimate_row((int) $p['id']);
    if (!in_array($e['status'], ['draft', 'sent'], true)) {
        fail(409, 'estimate_closed', 'This estimate is already ' . $e['status']);
    }
    $in = clean(body(), ['note' => 'str|req|max:255']);
    tx(fn () => approve_estimate($e, 'call', $in['note']));
    $j = job_row((int) $e['job_card_id']);
    notify_estimate_approved($j, $e);
    return ['item' => job_detail((int) $j['id'])];
}, ['roles' => [ROLE_OWNER, ROLE_DESK]]);

function notify_estimate_approved(array $j, array $e): void
{
    $ids = user_ids_with_role(ROLE_OWNER, ROLE_DESK);
    if ($j['mechanic_id']) {
        $ids[] = (int) $j['mechanic_id'];
    }
    notify_users($ids, 'estimate_approved', 'notify.estimate_approved_title', 'notify.estimate_approved_body',
        ['job' => $j['job_no'], 'reg' => $j['reg_no'], 'total' => inr((float) $e['grand_total'])], '#/jobs/' . $j['id']);
}

/* ------------------------------------------------------------------ public approval page (no login) */

/** Find an estimate by token; returns [estimate, job, state] where state is ok|expired|approved|superseded. */
function public_estimate(string $token): array
{
    if (!preg_match('/^[A-Za-z0-9_-]{20,64}$/', $token)) {
        not_found('Estimate');
    }
    $e = row('SELECT * FROM estimates WHERE approval_token = ?', [$token]) ?? not_found('Estimate');
    $e['items'] = rows('SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY item_type DESC, id', [$e['id']]);
    $j = job_row((int) $e['job_card_id']);
    $state = match (true) {
        $e['status'] === 'approved' => 'approved',
        $e['status'] === 'superseded', $e['status'] === 'rejected' => 'superseded',
        $e['expires_at'] && strtotime((string) $e['expires_at']) < time() => 'expired',
        default => 'ok',
    };
    return [$e, $j, $state];
}

function render_public_estimate(array $e, array $j, string $state, ?string $flash = null): RawResponse
{
    $lang = $j['customer_language'] ?: 'mr';
    ob_start();
    include API_DIR . '/templates/estimate_public.php';
    $html = (string) ob_get_clean();
    $r = html_response($html);
    $r->headers['X-Robots-Tag'] = 'noindex';
    $r->headers['Referrer-Policy'] = 'no-referrer';
    return $r;
}

route('GET', '/e/{token}', function ($p) {
    [$e, $j, $state] = public_estimate($p['token']);
    return render_public_estimate($e, $j, $state);
}, ['public' => true]);

route('POST', '/e/{token}/approve', function ($p) {
    [$e, $j, $state] = public_estimate($p['token']);
    if ($state === 'ok') {
        tx(fn () => approve_estimate($e, 'link'));
        notify_estimate_approved($j, $e);
        [$e, $j, $state] = public_estimate($p['token']);
        return render_public_estimate($e, $j, $state, 'approved_done');
    }
    return render_public_estimate($e, $j, $state);
}, ['public' => true]);

route('POST', '/e/{token}/call', function ($p) {
    [$e, $j, $state] = public_estimate($p['token']);
    if ($state !== 'expired') {
        // At most one call request per estimate per hour
        $recent = (int) val("SELECT COUNT(*) FROM notifications WHERE type = 'customer_call' AND link = ? AND created_at >= ?", ['#/jobs/' . $j['id'], date('Y-m-d H:i:s', time() - 3600)]);
        if (!$recent) {
            notify_users(user_ids_with_role(ROLE_OWNER, ROLE_DESK), 'customer_call', 'notify.customer_call_title', 'notify.customer_call_body',
                ['job' => $j['job_no'], 'name' => $j['customer_name'], 'phone' => $j['customer_phone']], '#/jobs/' . $j['id']);
        }
    }
    return render_public_estimate($e, $j, $state, 'call_done');
}, ['public' => true]);
