<?php
declare(strict_types=1);

/*
 * WhatsApp reminder lists (click-to-send in v1).
 * Service: the next service written on the bike's last job card (date reached, or estimated km reached), else
 *   last service ≥ service_reminder_days ago or estimated km since service ≥ service_reminder_km
 *   (km per day estimated from the bike's last two odometer readings - decision 8).
 * Payment: customers with dues whose oldest unpaid bill is older than payment_reminder_days.
 * A customer is not listed again for the same reminder within the waiting period.
 */

/** Estimated km per day from the two latest job cards with an odometer reading on different days. */
function km_per_day(int $vehicleId): ?float
{
    $r = rows('SELECT odometer, DATE(created_at) AS d FROM job_cards WHERE vehicle_id = ? AND odometer IS NOT NULL ORDER BY created_at DESC LIMIT 10', [$vehicleId]);
    if (count($r) < 2) {
        return null;
    }
    $latest = $r[0];
    foreach (array_slice($r, 1) as $prev) {
        $days = (strtotime($latest['d']) - strtotime($prev['d'])) / 86400;
        $km = (int) $latest['odometer'] - (int) $prev['odometer'];
        if ($days >= 1 && $km > 0) {
            return $km / $days;
        }
    }
    return null;
}

function reminders_due(): array
{
    $days = (int) setting('service_reminder_days', '90');
    $kmLimit = (int) setting('service_reminder_km', '3000');
    $payDays = (int) setting('payment_reminder_days', '7');
    $today = today();

    $service = [];
    $vehicles = rows(
        "SELECT v.id, v.reg_no, v.make, v.model, v.last_service_on, v.last_service_odometer, v.next_service_on, v.next_service_km, c.id AS customer_id, c.name, c.phone, c.language
         FROM vehicles v JOIN customers c ON c.id = v.customer_id
         WHERE v.last_service_on IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM job_cards j WHERE j.vehicle_id = v.id AND j.status NOT IN ('delivered','cancelled'))
           AND NOT EXISTS (SELECT 1 FROM message_log m WHERE m.customer_id = c.id AND m.template = 'service_reminder' AND m.ref_id = v.id AND m.created_at >= ?)",
        [date('Y-m-d H:i:s', strtotime('-30 days'))]
    );
    foreach ($vehicles as $v) {
        $since = (int) floor((strtotime($today) - strtotime($v['last_service_on'])) / 86400);
        $rate = km_per_day((int) $v['id']);
        $estKm = $rate !== null ? (int) round($rate * $since) : null;
        if ($v['next_service_on'] !== null || $v['next_service_km'] !== null) {
            $byDate = $v['next_service_on'] !== null && $today >= $v['next_service_on'];
            $byKm = $v['next_service_km'] !== null && $estKm !== null && $v['last_service_odometer'] !== null
                && (int) $v['last_service_odometer'] + $estKm >= (int) $v['next_service_km'];
            if (!$byDate && !$byKm) {
                continue;
            }
        } elseif ($since < $days && ($estKm === null || $estKm < $kmLimit)) {
            continue;
        }
        $lang = $v['language'] ?: 'mr';
        $text = wa_text('service_reminder', ['name' => $v['name'], 'reg' => $v['reg_no'], 'days' => $since, 'shop' => shop_name_for($lang)], $lang);
        $service[] = [
            'customer_id' => (int) $v['customer_id'], 'vehicle_id' => (int) $v['id'], 'name' => $v['name'], 'phone' => $v['phone'],
            'reg_no' => $v['reg_no'], 'model' => trim($v['make'] . ' ' . $v['model']), 'last_service_on' => $v['last_service_on'],
            'days' => $since, 'est_km' => $estKm, 'text' => $text, 'url' => wa_url($v['phone'], $text),
            'log' => ['customer_id' => (int) $v['customer_id'], 'template' => 'service_reminder', 'ref_type' => 'vehicle', 'ref_id' => (int) $v['id']],
        ];
    }

    $payment = [];
    $cutoff = date('Y-m-d', strtotime("-$payDays days"));
    $custs = rows(
        "SELECT c.id, c.name, c.phone, c.language, ROUND(" . CUSTOMER_BALANCE_SQL . ", 2) AS balance,
                (SELECT MIN(i.invoice_date) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'final' AND i.balance > 0) AS oldest
         FROM customers c
         WHERE NOT EXISTS (SELECT 1 FROM message_log m WHERE m.customer_id = c.id AND m.template = 'payment_reminder' AND m.created_at >= ?)
         HAVING balance > 0.004",
        [date('Y-m-d H:i:s', strtotime("-$payDays days"))]
    );
    foreach ($custs as $c) {
        if ($c['oldest'] !== null && $c['oldest'] > $cutoff) {
            continue; // newest dues still within the grace period
        }
        $lang = $c['language'] ?: 'mr';
        $text = wa_text('payment_reminder', ['name' => $c['name'], 'amount' => inr((float) $c['balance']), 'shop' => shop_name_for($lang)], $lang);
        $payment[] = [
            'customer_id' => (int) $c['id'], 'name' => $c['name'], 'phone' => $c['phone'], 'balance' => (float) $c['balance'],
            'oldest' => $c['oldest'], 'text' => $text, 'url' => wa_url($c['phone'], $text),
            'log' => ['customer_id' => (int) $c['id'], 'template' => 'payment_reminder', 'ref_type' => 'customer', 'ref_id' => (int) $c['id']],
        ];
    }
    usort($payment, static fn ($a, $b) => $b['balance'] <=> $a['balance']);
    return ['service' => $service, 'payment' => $payment];
}
