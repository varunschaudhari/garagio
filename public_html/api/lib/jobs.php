<?php
declare(strict_types=1);

const JOB_STATUSES = ['pending', 'estimate_sent', 'approved', 'in_progress', 'waiting_parts', 'ready', 'delivered', 'cancelled'];
const JOB_OPEN = ['pending', 'estimate_sent', 'approved', 'in_progress', 'waiting_parts', 'ready'];
/** Parts may be requested only once the customer has approved the work (decision 6). */
const JOB_REQUESTABLE = ['approved', 'in_progress', 'waiting_parts'];

/** Allowed manual status moves (estimate_sent / approved are set by the estimate flow). */
const JOB_TRANSITIONS = [
    'pending' => ['cancelled'],
    'estimate_sent' => ['cancelled'],
    'approved' => ['in_progress', 'ready', 'delivered', 'cancelled'],
    'in_progress' => ['waiting_parts', 'ready', 'delivered', 'cancelled'],
    'waiting_parts' => ['in_progress', 'ready', 'delivered', 'cancelled'],
    'ready' => ['in_progress', 'delivered', 'cancelled'],
    'delivered' => [],
    'cancelled' => [],
];

const JOB_SELECT = "SELECT j.*, c.name AS customer_name, c.phone AS customer_phone, c.language AS customer_language,
    v.reg_no, v.make, v.model, v.year, m.name AS mechanic_name
  FROM job_cards j
  JOIN customers c ON c.id = j.customer_id
  JOIN vehicles v ON v.id = j.vehicle_id
  LEFT JOIN users m ON m.id = j.mechanic_id";

function job_row(int $id): array
{
    return row(JOB_SELECT . ' WHERE j.id = ?', [$id]) ?? not_found('Job card');
}

/**
 * When the bike should come back (whichever comes first): what was written on the job card, otherwise the job
 * date + service_reminder_days and the job's km + service_reminder_km. $j needs created_at, odometer,
 * next_service_on, next_service_km.
 */
function job_next_service(array $j): array
{
    $on = $j['next_service_on'] ?? null;
    $km = $j['next_service_km'] ?? null;
    $custom = $on !== null || $km !== null;
    if (!$custom) {
        $on = date('Y-m-d', strtotime(substr((string) $j['created_at'], 0, 10) . ' +' . (int) setting('service_reminder_days', '90') . ' days'));
        $km = ($j['odometer'] ?? null) !== null ? (int) $j['odometer'] + (int) setting('service_reminder_km', '3000') : null;
    }
    return ['on' => $on, 'km' => $km !== null ? (int) $km : null, 'custom' => $custom];
}

/** "17-02-2027 or 15400 km, whichever comes first" in one language (bills, WhatsApp). */
function next_service_text(array $ns, string $lang): string
{
    if ($ns['on'] && $ns['km']) {
        return tr('inv.next_service_both', $lang, ['date' => fmt_date($ns['on']), 'km' => $ns['km']]);
    }
    return $ns['on'] ? fmt_date($ns['on']) : ($ns['km'] ? $ns['km'] . ' km' : '');
}

/**
 * Mechanics may only see and change their own jobs. Inventory managers may read jobs (to issue parts)
 * but not change them.
 */
function job_access(array $job, bool $write = false): void
{
    $u = current_user();
    if ($u['role'] === ROLE_MECHANIC && (int) $job['mechanic_id'] !== (int) $u['id']) {
        fail(403, 'not_your_job', 'This job is assigned to another mechanic');
    }
    if ($write && $u['role'] === ROLE_INVENTORY) {
        fail(403, 'forbidden', 'You do not have permission for this action');
    }
}

function job_locked(array $job): bool
{
    return in_array($job['status'], ['delivered', 'cancelled'], true)
        || ($job['invoice_id'] && val("SELECT status FROM invoices WHERE id = ?", [$job['invoice_id']]) === 'final');
}

/** Lines that would go on the bill now: issued parts (minus returns) + labour. */
function job_bill_lines(int $jobId): array
{
    $lines = [];
    foreach (rows(
        'SELECT jp.id, jp.part_id, jp.qty - jp.returned_qty AS qty, jp.unit_price, jp.unit_cost, p.gst_rate, p.hsn, p.name_en, p.name_mr, p.part_no
         FROM job_parts jp JOIN parts p ON p.id = jp.part_id WHERE jp.job_card_id = ? AND jp.qty - jp.returned_qty > 0 ORDER BY jp.id',
        [$jobId]
    ) as $p) {
        $lines[] = ['item_type' => 'part', 'job_part_id' => (int) $p['id'], 'part_id' => (int) $p['part_id'], 'qty' => (float) $p['qty'], 'unit_price' => (float) $p['unit_price'],
            'disc_pct' => 0, 'gst_rate' => (float) $p['gst_rate'], 'hsn' => $p['hsn'], 'description_en' => $p['name_en'], 'description_mr' => $p['name_mr'], 'part_no' => $p['part_no'], 'unit_cost' => (float) $p['unit_cost']];
    }
    foreach (rows('SELECT * FROM job_labour WHERE job_card_id = ? ORDER BY id', [$jobId]) as $l) {
        // kind 'part': a part typed on the estimate (not in the catalogue) – billed, no stock movement.
        $isPart = ($l['item_kind'] ?? 'labour') === 'part';
        $lines[] = ['item_type' => $isPart ? 'part' : 'labour', 'job_labour_id' => (int) $l['id'], 'part_id' => null,
            'qty' => $isPart ? max(0.01, (float) $l['qty']) : 1.0, 'unit_price' => (float) $l['amount'],
            'disc_pct' => 0, 'gst_rate' => $isPart ? setting_num('default_part_gst_rate') : setting_num('labour_gst_rate'),
            'hsn' => $isPart ? null : setting('labour_sac', '998714'), 'description_en' => $l['description'], 'description_mr' => $l['description_mr'], 'unit_cost' => 0.0];
    }
    return $lines;
}

/** Job statuses from which the bill can be made (any time after the job is approved). */
const JOB_BILLABLE = ['approved', 'in_progress', 'waiting_parts', 'ready'];

/**
 * Parts on the approved estimate become "planned" job parts (issued = 0): billed at the estimate price,
 * taken out of stock when the bill is finalised. Parts the store already issued to this job count against
 * the estimate, so nothing is billed twice. Free-text estimate parts (no catalogue part) are not copied.
 * Inside tx().
 */
function sync_planned_parts(int $jobId, array $estimateItems): void
{
    $want = [];
    foreach ($estimateItems as $it) {
        if (($it['item_type'] ?? '') !== 'part' || empty($it['part_id'])) {
            continue;
        }
        $pid = (int) $it['part_id'];
        $want[$pid] = [r2(($want[$pid][0] ?? 0) + (float) $it['qty']), (float) $it['unit_price']];
    }
    $issued = [];
    foreach (rows('SELECT part_id, SUM(qty - returned_qty) AS n FROM job_parts WHERE job_card_id = ? AND issued = 1 GROUP BY part_id', [$jobId]) as $r) {
        $issued[(int) $r['part_id']] = (float) $r['n'];
    }
    $planned = [];
    foreach (rows('SELECT id, part_id FROM job_parts WHERE job_card_id = ? AND issued = 0 ORDER BY id FOR UPDATE', [$jobId]) as $r) {
        $planned[(int) $r['part_id']] ??= (int) $r['id'];
    }
    // Rows are zeroed rather than deleted: a draft bill may still point at them until it is rebuilt.
    q('UPDATE job_parts SET qty = 0, updated_at = ? WHERE job_card_id = ? AND issued = 0', [now(), $jobId]);
    foreach ($want as $pid => [$qty, $price]) {
        $need = r2($qty - ($issued[$pid] ?? 0));
        if ($need <= 0) {
            continue;
        }
        if (isset($planned[$pid])) {
            q('UPDATE job_parts SET qty = ?, unit_price = ?, updated_at = ? WHERE id = ?', [$need, $price, now(), $planned[$pid]]);
        } else {
            insert('job_parts', ['job_card_id' => $jobId, 'part_id' => $pid, 'qty' => $need, 'returned_qty' => 0, 'issued' => 0, 'unit_price' => $price, 'unit_cost' => 0]);
        }
    }
}

/** Issuing a part from the store uses up a planned line for it (and keeps the agreed price). Inside tx(). */
function consume_planned_part(int $jobId, int $partId, float $qty): ?float
{
    $price = null;
    $left = $qty;
    foreach (rows('SELECT id, qty, unit_price FROM job_parts WHERE job_card_id = ? AND part_id = ? AND issued = 0 AND qty > 0 ORDER BY id FOR UPDATE', [$jobId, $partId]) as $p) {
        if ($left <= 0) {
            break;
        }
        $use = min($left, (float) $p['qty']);
        q('UPDATE job_parts SET qty = qty - ?, updated_at = ? WHERE id = ?', [$use, now(), $p['id']]);
        $price ??= (float) $p['unit_price'];
        $left = r2($left - $use);
    }
    return $price;
}

/** Money summary for a job: what has been used so far vs the approved estimate. */
function job_money(array $job): array
{
    $lines = job_bill_lines((int) $job['id']);
    $parts = 0.0;
    $labour = 0.0;
    foreach ($lines as $l) {
        if ($l['item_type'] === 'part') {
            $parts += $l['qty'] * $l['unit_price'];
        } else {
            $labour += $l['unit_price'];
        }
    }
    $current = $lines ? sale_bill($lines)['totals']['grand_total'] : 0.0;
    $approved = $job['approved_estimate_id'] ? (float) val('SELECT grand_total FROM estimates WHERE id = ?', [$job['approved_estimate_id']]) : null;
    $pendingRevision = (bool) val(
        "SELECT COUNT(*) FROM estimates WHERE job_card_id = ? AND status IN ('draft','sent') AND (? IS NULL OR id > ?)",
        [$job['id'], $job['approved_estimate_id'], $job['approved_estimate_id'] ?? 0]
    );
    return [
        'parts_total' => r2($parts),
        'labour_total' => r2($labour),
        'current_total' => r2($current),
        'approved_total' => $approved,
        // Issued parts + labour exceed what the customer approved → a revised estimate is needed.
        'revised_needed' => $approved !== null && $current > $approved + 0.5,
        'revision_pending' => $job['approved_estimate_id'] !== null && $pendingRevision,
    ];
}

/** Record a job event for the timeline (stored in audit_log). */
function job_event(int $jobId, string $action, array $data = []): void
{
    audit($action, 'job', $jobId, null, $data ?: null);
}

/* ------------------------------------------------------------------ WhatsApp click-to-send */

function wa_url(string $phone, string $text): string
{
    $digits = preg_replace('/\D+/', '', $phone);
    if (strlen($digits) === 10) {
        $digits = '91' . $digits;
    }
    return 'https://wa.me/' . $digits . '?text=' . rawurlencode($text);
}

/** Both languages, the customer's language first. */
function wa_text(string $key, array $vars, string $firstLang = 'mr'): string
{
    $mr = tr("wa.$key", 'mr', $vars);
    $en = tr("wa.$key", 'en', $vars);
    return $firstLang === 'en' ? "$en\n\n$mr" : "$mr\n\n$en";
}

/** The name customers see in WhatsApp messages: the full name from the signboard, as on the bills. */
function shop_name_for(string $lang): string
{
    return shop_full_name($lang);
}

function log_message(?int $customerId, string $template, ?string $refType, ?int $refId, string $payload): void
{
    insert('message_log', [
        'customer_id' => $customerId,
        'channel' => 'whatsapp',
        'template' => $template,
        'ref_type' => $refType,
        'ref_id' => $refId,
        'payload' => mb_substr($payload, 0, 5000),
        'status' => 'opened',
        'sent_by' => user_or_null()['id'] ?? null,
    ]);
}
