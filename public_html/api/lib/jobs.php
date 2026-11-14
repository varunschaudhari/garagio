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
    'approved' => ['in_progress', 'cancelled'],
    'in_progress' => ['waiting_parts', 'ready', 'cancelled'],
    'waiting_parts' => ['in_progress', 'ready', 'cancelled'],
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
        $lines[] = ['item_type' => 'labour', 'job_labour_id' => (int) $l['id'], 'part_id' => null, 'qty' => 1.0, 'unit_price' => (float) $l['amount'],
            'disc_pct' => 0, 'gst_rate' => setting_num('labour_gst_rate'), 'hsn' => setting('labour_sac', '998714'), 'description_en' => $l['description'], 'description_mr' => $l['description_mr'], 'unit_cost' => 0.0];
    }
    return $lines;
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

function shop_name_for(string $lang): string
{
    return $lang === 'mr' ? (setting('shop_name_mr') ?: (string) setting('shop_name')) : (string) setting('shop_name');
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
