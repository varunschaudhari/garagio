<?php
declare(strict_types=1);

/*
 * The only place that changes parts.current_stock. Every change writes a stock_movements row
 * in the same transaction, so the ledger balance always equals current_stock.
 */

const MOVEMENT_TYPES = ['opening', 'purchase', 'job_issue', 'job_return', 'counter_sale', 'sale_cancel', 'adjustment', 'stock_count', 'purchase_cancel', 'sale_return'];

/** Inbound types that bring their own unit cost and update the weighted average. */
const COSTED_INBOUND = ['opening', 'purchase', 'job_return', 'sale_cancel', 'sale_return'];

/**
 * Post a stock movement. Must run inside tx(). Locks the part row.
 *
 * @param float      $qty      signed: + adds stock, - removes stock
 * @param float|null $unitCost net cost per unit (ex-GST) for costed inbound types; ignored otherwise
 * @return array the movement row (id, balance_after, unit_cost)
 */
function stock_move(
    int $partId,
    float $qty,
    string $mtype,
    ?string $refType = null,
    ?int $refId = null,
    ?float $unitCost = null,
    ?string $note = null
): array {
    if (!in_array($mtype, MOVEMENT_TYPES, true)) {
        throw new LogicException("Unknown movement type $mtype");
    }
    if (!db()->inTransaction()) {
        throw new LogicException('stock_move must run inside a transaction');
    }
    $qty = r2($qty);
    if ($qty == 0.0) {
        fail(422, 'zero_qty', 'Quantity must not be zero');
    }
    $part = row('SELECT id, part_no, name_en, current_stock, avg_cost, last_purchase_price, last_purchase_disc_pct FROM parts WHERE id = ? FOR UPDATE', [$partId]);
    if (!$part) {
        not_found('Part');
    }
    $cur = (float) $part['current_stock'];
    $avg = (float) $part['avg_cost'];
    $new = r2($cur + $qty);
    if ($new < 0) {
        fail(409, 'insufficient_stock', sprintf('Only %s in stock for %s', fmt_qty($cur), $part['name_en']), [
            'part_id' => $partId,
            'available' => $cur,
        ]);
    }

    if ($qty > 0 && in_array($mtype, COSTED_INBOUND, true) && $unitCost !== null) {
        $cost = max(0.0, $unitCost);
        $avg = $cur <= 0 ? $cost : (($cur * $avg) + ($qty * $cost)) / ($cur + $qty);
    } elseif ($qty < 0 && $mtype === 'purchase_cancel' && $unitCost !== null) {
        // A cancelled purchase leaves at the cost it came in at; the average is worked back without it.
        $cost = max(0.0, $unitCost);
        $avg = $new > 0 ? max(0.0, (($cur * $avg) + ($qty * $cost)) / $new) : $avg;
    } elseif ($qty > 0 && $avg <= 0 && ($fallback = net_cost((float) $part['last_purchase_price'], (float) $part['last_purchase_disc_pct'])) > 0) {
        // Uncosted stock (count / adjustment) on a part with no average cost yet: value only the
        // new units at the last purchase price; units already on hand keep their cost of 0.
        $cost = $fallback;
        $avg = $cur <= 0 ? $cost : (($cur * $avg) + ($qty * $cost)) / ($cur + $qty);
    } else {
        $cost = $avg;
    }

    q('UPDATE parts SET current_stock = ?, avg_cost = ?, updated_at = ? WHERE id = ?', [$new, round($avg, 4), now(), $partId]);
    $u = user_or_null();
    $id = insert('stock_movements', [
        'part_id' => $partId,
        'qty' => $qty,
        'balance_after' => $new,
        'mtype' => $mtype,
        'ref_type' => $refType,
        'ref_id' => $refId,
        'unit_cost' => round($cost, 4),
        'note' => $note === null ? null : mb_substr($note, 0, 255),
        'user_id' => $u['id'] ?? null,
    ]);
    return ['id' => $id, 'balance_after' => $new, 'unit_cost' => round($cost, 4), 'previous' => $cur];
}

/**
 * Go-live only: delete the whole stock ledger and set every balance to zero, so ledger and stock
 * agree before opening stock is posted again with stock_move(). Must run inside tx().
 * Returns [part_id => [qty, avg_cost]] for the parts that had stock.
 */
function stock_restart_ledger(): array
{
    if (!db()->inTransaction()) {
        throw new LogicException('stock_restart_ledger must run inside a transaction');
    }
    $had = [];
    foreach (rows('SELECT id, current_stock, avg_cost FROM parts WHERE current_stock <> 0 ORDER BY id FOR UPDATE') as $p) {
        $had[(int) $p['id']] = [(float) $p['current_stock'], (float) $p['avg_cost']];
    }
    q('DELETE FROM stock_movements');
    q('UPDATE parts SET current_stock = 0, updated_at = ? WHERE current_stock <> 0', [now()]);
    return $had;
}

function fmt_qty(float $q): string
{
    return rtrim(rtrim(number_format($q, 2, '.', ''), '0'), '.');
}

/** Net unit cost after a purchase discount, ex-GST. */
function net_cost(float $price, float $discPct): float
{
    return round($price * (1 - $discPct / 100), 4);
}
