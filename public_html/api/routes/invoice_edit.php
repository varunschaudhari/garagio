<?php
declare(strict_types=1);

/*
 * The owner edits a final sales bill and it keeps its number (decision 30). Lines change qty, price and discount or
 * go; a counter bill can also get new parts. Stock follows the difference (a job bill's parts go back to stock or out
 * again through the job). Money: when the bill goes up, the extra is collected now (or stays as credit for a trusted
 * customer); when it goes down, a customer's extra money becomes an advance and a walk-in customer gets it back
 * (bill_refunds, in the cash book). Not for bills with returns. POST …/edit/preview does everything and rolls back.
 */

/** Carries a dry run's result out of the transaction that is then rolled back. */
final class InvoiceEditPreview extends RuntimeException
{
    public function __construct(public array $result)
    {
        parent::__construct('preview');
    }
}

function invoice_edit_apply(int $id, array $body, bool $dry): array
{
    $in = clean($body, [
        'reason' => $dry ? 'str|max:255' : 'str|req|max:255',
        'bill_disc_pct' => 'num|min:0|max:100',
        'cust_name' => 'str|max:120',
        'cust_phone' => 'phone',
        'refund_mode' => 'enum:cash,upi,bank|def:cash',
    ]);
    $pay = null;
    if (is_array($body['payment'] ?? null) && (float) ($body['payment']['amount'] ?? 0) > 0) {
        $pay = clean($body['payment'], ['mode' => 'enum:cash,upi,card,bank|req', 'amount' => 'num|req|min:0.01|max:10000000', 'reference' => 'str|max:60']);
    }
    $specs = [];
    $added = [];
    foreach (array_values((array) ($body['lines'] ?? [])) as $i => $raw) {
        try {
            $l = clean(is_array($raw) ? $raw : [], ['item_id' => 'int', 'part_id' => 'int', 'qty' => 'num|min:0|max:10000', 'unit_price' => 'num|min:0|max:10000000', 'disc_pct' => 'num|min:0|max:100', 'remove' => 'bool']);
        } catch (ApiError $e) {
            fail(422, 'validation_failed', 'Check the lines', ["lines.$i" => $e->fields]);
        }
        if (!empty($l['item_id'])) {
            $specs[(int) $l['item_id']] = $l;
        } elseif (!empty($l['part_id']) && empty($l['remove'])) {
            if (empty($l['qty'])) {
                fail(422, 'validation_failed', 'Enter the quantity', ["lines.$i" => ['qty' => 'required']]);
            }
            $added[] = $l;
        }
    }

    $work = function () use ($id, $in, $pay, $specs, $added, $dry) {
        $inv = row('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [$id]) ?? not_found('Invoice');
        if ($inv['status'] !== 'final') {
            fail(409, 'invoice_not_final', 'Only a final bill can be edited');
        }
        if ((float) $inv['returned_total'] > 0) {
            fail(409, 'edit_has_returns', 'This bill has returns; it cannot be edited');
        }
        if ((int) $inv['gst_registered'] !== (gst_registered() ? 1 : 0)) {
            fail(409, 'gst_mode_changed', 'GST registration changed since this bill; cancel it and make a new one');
        }
        $no = (string) $inv['invoice_no'];
        $old = rows('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', [$id]);
        foreach (array_keys($specs) as $itemId) {
            if (!in_array($itemId, array_map('intval', array_column($old, 'id')), true)) {
                fail(422, 'validation_failed', 'A line is not on this bill', ['lines' => 'invalid_choice']);
            }
        }
        $discChanged = isset($in['bill_disc_pct']) && abs((float) $in['bill_disc_pct'] - (float) $inv['bill_disc_pct']) >= 0.005;
        foreach ($old as $it) {
            $s = $specs[(int) $it['id']] ?? [];
            if (isset($s['disc_pct']) && abs((float) $s['disc_pct'] - (float) $it['disc_pct']) >= 0.005) {
                $discChanged = true;
            }
        }
        foreach ($added as $a) {
            $discChanged = $discChanged || !empty($a['disc_pct']);
        }
        if ($discChanged && !can('give_discount')) {
            fail(403, 'discount_owner_only', 'Only the owner can give a discount');
        }
        $before = ['total' => (float) $inv['grand_total'], 'items' => array_map(static fn ($it) => pick($it, ['description_en', 'qty', 'unit_price', 'disc_pct', 'line_total']), $old)];
        $billDisc = isset($in['bill_disc_pct']) ? (float) $in['bill_disc_pct'] : (float) $inv['bill_disc_pct'];

        if ($inv['inv_type'] === 'counter') {
            $items = [];
            $oldQty = [];
            $newQty = [];
            $costByPart = [];
            foreach ($old as $it) {
                $pid = (int) $it['part_id'];
                $oldQty[$pid] = ($oldQty[$pid] ?? 0) + (float) $it['qty'];
                $costByPart[$pid] ??= (float) $it['unit_cost'];
                $s = $specs[(int) $it['id']] ?? [];
                $qty = isset($s['qty']) ? (float) $s['qty'] : (float) $it['qty'];
                if (!empty($s['remove']) || $qty <= 0) {
                    continue;
                }
                $items[] = ['part_id' => $pid, 'qty' => $qty, 'disc_pct' => (float) ($s['disc_pct'] ?? $it['disc_pct']), 'unit_price' => (float) ($s['unit_price'] ?? $it['unit_price'])];
                $newQty[$pid] = ($newQty[$pid] ?? 0) + $qty;
            }
            foreach ($added as $a) {
                $p = row('SELECT id, selling_price FROM parts WHERE id = ? AND active = 1', [$a['part_id']]) ?? not_found('Part');
                $items[] = ['part_id' => (int) $p['id'], 'qty' => (float) $a['qty'], 'disc_pct' => (float) ($a['disc_pct'] ?? 0), 'unit_price' => (float) ($a['unit_price'] ?? $p['selling_price'])];
                $newQty[(int) $p['id']] = ($newQty[(int) $p['id']] ?? 0) + (float) $a['qty'];
            }
            if (!$items) {
                fail(409, 'edit_empty', 'The bill would be empty; cancel it instead');
            }
            foreach (array_unique(array_merge(array_keys($oldQty), array_keys($newQty))) as $pid) {
                $diff = r2(($newQty[$pid] ?? 0) - ($oldQty[$pid] ?? 0));
                if ($diff > 0) {
                    $mv = stock_move($pid, -$diff, 'counter_sale', 'invoice', $id, null, $no . ' (edited)');
                    $costByPart[$pid] ??= (float) $mv['unit_cost'];
                } elseif ($diff < 0) {
                    stock_move($pid, -$diff, 'sale_cancel', 'invoice', $id, $costByPart[$pid] ?? null, 'Edit ' . $no);
                }
            }
            if ($inv['customer_id'] === null) {
                $walk = array_filter(pick($in, ['cust_name', 'cust_phone']), static fn ($v) => $v !== null);
                if ($walk) {
                    update_row('invoices', $id, $walk);
                }
            }
            rebuild_draft($id, $items, null, $billDisc, true);
            foreach (rows('SELECT id, part_id FROM invoice_items WHERE invoice_id = ?', [$id]) as $it) {
                q('UPDATE invoice_items SET unit_cost = ? WHERE id = ?', [$costByPart[(int) $it['part_id']] ?? 0, $it['id']]);
            }
        } else {
            if ($added) {
                fail(422, 'validation_failed', 'Add parts to a job on the job card', ['lines' => 'invalid_choice']);
            }
            $jobId = (int) $inv['job_card_id'];
            $discounts = [];
            foreach ($old as $it) {
                $s = $specs[(int) $it['id']] ?? [];
                $remove = !empty($s['remove']);
                if ($it['job_part_id']) {
                    $jp = row('SELECT * FROM job_parts WHERE id = ? FOR UPDATE', [$it['job_part_id']]);
                    $billed = (float) $jp['qty'] - (float) $jp['returned_qty'];
                    $qty = $remove ? 0.0 : (isset($s['qty']) ? (float) $s['qty'] : $billed);
                    $diff = r2($qty - $billed);
                    $set = [];
                    if ($diff < 0) {
                        stock_move((int) $jp['part_id'], -$diff, 'job_return', 'job', $jobId, (float) $jp['unit_cost'], 'Edit ' . $no);
                        $set['returned_qty'] = r2((float) $jp['returned_qty'] - $diff);
                    } elseif ($diff > 0) {
                        stock_move((int) $jp['part_id'], -$diff, 'job_issue', 'job', $jobId, null, 'Edit ' . $no);
                        $set['qty'] = r2((float) $jp['qty'] + $diff);
                    }
                    if (isset($s['unit_price'])) {
                        $set['unit_price'] = (float) $s['unit_price'];
                    }
                    if ($set) {
                        update_row('job_parts', (int) $jp['id'], $set);
                    }
                    $discounts['part:' . $jp['id']] = (float) ($s['disc_pct'] ?? $it['disc_pct']);
                } elseif ($it['job_labour_id']) {
                    if ($remove) {
                        q('DELETE FROM job_labour WHERE id = ?', [$it['job_labour_id']]);
                        continue;
                    }
                    $set = [];
                    if (isset($s['unit_price'])) {
                        $set['amount'] = (float) $s['unit_price'];
                    }
                    if (isset($s['qty']) && $it['item_type'] === 'part') {
                        $set['qty'] = max(0.01, (float) $s['qty']);
                    }
                    if ($set) {
                        update_row('job_labour', (int) $it['job_labour_id'], $set);
                    }
                    $discounts['labour:' . $it['job_labour_id']] = (float) ($s['disc_pct'] ?? $it['disc_pct']);
                }
            }
            rebuild_draft($id, [], $discounts, $billDisc);
        }

        // Money: what was paid stays; the bill now needs more, or some of it is free again.
        $inv = row('SELECT * FROM invoices WHERE id = ?', [$id]);
        $total = (float) $inv['grand_total'];
        if ($total <= 0) {
            fail(409, 'edit_empty', 'The bill would be empty; cancel it instead');
        }
        $customerId = $inv['customer_id'] ? (int) $inv['customer_id'] : null;
        $paid = r2((float) val('SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE invoice_id = ?', [$id]));
        $refund = 0.0;
        if ($paid > $total + 0.004) {
            $excess = r2($paid - $total);
            $left = $excess;
            foreach (rows('SELECT id, amount FROM payment_allocations WHERE invoice_id = ? ORDER BY id DESC', [$id]) as $a) {
                if ($left <= 0.004) {
                    break;
                }
                $cut = r2(min($left, (float) $a['amount']));
                if ($cut >= (float) $a['amount'] - 0.004) {
                    q('DELETE FROM payment_allocations WHERE id = ?', [$a['id']]);
                } else {
                    q('UPDATE payment_allocations SET amount = ? WHERE id = ?', [r2((float) $a['amount'] - $cut), $a['id']]);
                }
                $left = r2($left - $cut);
            }
            if (!$customerId) {
                $refund = $excess;
                insert('bill_refunds', ['invoice_id' => $id, 'amount' => $refund, 'mode' => $in['refund_mode'], 'refunded_on' => today(), 'note' => 'Edit ' . $no, 'user_id' => uid()]);
            }
        }
        refresh_invoice_payments($id);
        $due = r2((float) val('SELECT balance FROM invoices WHERE id = ?', [$id]));
        if ($pay && $due > 0.004) {
            if ($pay['amount'] > $due + 0.004) {
                fail(422, 'overpaid', 'Payments are more than what is due', ['payment' => 'out_of_range']);
            }
            record_customer_payment($customerId, (float) $pay['amount'], $pay['mode'], $pay['reference'] ?? null, $id, 'Edit ' . $no);
            $due = r2($due - (float) $pay['amount']);
        }
        $creditOk = true;
        if ($due > 0.004) {
            $c = $customerId ? row('SELECT is_trusted, credit_limit FROM customers WHERE id = ?', [$customerId]) : null;
            $creditOk = $c && (int) $c['is_trusted'] && !((float) $c['credit_limit'] > 0 && customer_balance($customerId) > (float) $c['credit_limit'] + 0.004);
            if (!$creditOk && !$dry) {
                fail(409, 'payment_needed', 'Collect ' . inr($due) . ' to save this change', ['payment' => 'required']);
            }
        }
        if ($customerId) {
            apply_customer_advance($customerId);
        }
        update_row('invoices', $id, ['edited_at' => now(), 'edited_by' => uid()]);
        $result = [
            'old_total' => $before['total'],
            'total' => $total,
            'paid' => $paid,
            'to_collect' => max(0.0, $due),
            'to_refund' => $refund,
            'walk_in' => $customerId === null,
            'credit_ok' => $creditOk,
            'item' => invoice_view($id),
        ];
        if (!$dry) {
            $after = row('SELECT grand_total FROM invoices WHERE id = ?', [$id]);
            $items = rows('SELECT description_en, qty, unit_price, disc_pct, line_total FROM invoice_items WHERE invoice_id = ? ORDER BY id', [$id]);
            audit('invoice_edit', 'invoice', $id, $before, ['total' => (float) $after['grand_total'], 'items' => $items, 'reason' => $in['reason'], 'refund' => $refund, 'payment' => $pay]);
        }
        return $result;
    };

    if (!$dry) {
        return tx($work);
    }
    try {
        tx(function () use ($work) {
            throw new InvoiceEditPreview($work());
        });
    } catch (InvoiceEditPreview $p) {
        return $p->result;
    }
    return [];
}

route('POST', '/invoices/{id}/edit/preview', function ($p) {
    return invoice_edit_apply((int) $p['id'], body(), true);
}, ['perm' => 'cancel_bills']);

route('PUT', '/invoices/{id}/edit', function ($p) {
    return invoice_edit_apply((int) $p['id'], body(), false);
}, ['perm' => 'cancel_bills']);
