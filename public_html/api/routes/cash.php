<?php
declare(strict_types=1);

/*
 * Cash book (decision 21): shop expenses and the end-of-day cash count. The day's expected cash is worked out
 * from what the app already knows (cash taken from customers, cash given back on returns, cash paid to
 * suppliers, cash expenses, mechanic pay); someone counts the drawer and the difference is kept. What is left
 * in the drawer (counted − taken out to the bank / owner) is the next day's opening.
 */

/** Category codes sent by phone apps before the owner could change the list (app 1.0.4 and older) → ids. */
const LEGACY_EXPENSE_CATEGORIES = ['tea_snacks' => 1, 'tools' => 4, 'rent' => 7, 'electricity' => 8, 'fuel' => 9, 'salary' => 10, 'repairs' => 11, 'transport' => 12, 'other' => 13];

const EXPENSE_SELECT = 'SELECT e.*, c.name_en AS category_en, c.name_mr AS category_mr, u.name AS user_name
    FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.user_id';

function cash_date(?string $raw): string
{
    $d = $raw ?: today();
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !strtotime($d)) {
        fail(422, 'validation_failed', 'Invalid date', ['date' => 'invalid_date']);
    }
    if ($d > today()) {
        fail(422, 'validation_failed', 'The day has not come yet', ['date' => 'future_date']);
    }
    return $d;
}

function day_closed(string $date): bool
{
    return (bool) val('SELECT id FROM cash_closes WHERE close_date = ?', [$date]);
}

/** Everything about one day's cash: opening, money in and out by kind, expected drawer, other modes, close. */
function cash_day(string $date): array
{
    $prev = row('SELECT close_date, counted, taken_out FROM cash_closes WHERE close_date < ? ORDER BY close_date DESC LIMIT 1', [$date]);
    $sum = static fn (string $sql) => r2((float) val($sql, [$date]));
    $in = [
        'customer_payments' => $sum("SELECT COALESCE(SUM(amount), 0) FROM customer_payments WHERE mode = 'cash' AND received_on = ?"),
    ];
    $out = [
        'refunds' => $sum("SELECT COALESCE(SUM(refund_amount), 0) FROM sale_returns WHERE refund_mode = 'cash' AND return_date = ?"),
        'supplier_payments' => $sum("SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE mode = 'cash' AND paid_on = ?"),
        'expenses' => $sum("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE mode = 'cash' AND spent_on = ?"),
        // Mechanic pay is handed over in cash, on the day it is entered.
        'mechanic_payments' => $sum('SELECT COALESCE(SUM(amount), 0) FROM mechanic_payments WHERE DATE(created_at) = ?'),
    ];
    $opening = $prev ? r2((float) $prev['counted'] - (float) $prev['taken_out']) : 0.0;
    $cashIn = r2(array_sum($in));
    $cashOut = r2(array_sum($out));
    $other = [];
    foreach (rows("SELECT mode, SUM(amount) AS amount FROM customer_payments WHERE mode <> 'cash' AND received_on = ? GROUP BY mode", [$date]) as $r) {
        $other[$r['mode']] = r2((float) $r['amount']);
    }
    return [
        'date' => $date,
        'opening' => $opening,
        'opening_from' => $prev['close_date'] ?? null,
        'in' => $in,
        'out' => $out,
        'cash_in' => $cashIn,
        'cash_out' => $cashOut,
        'expected' => r2($opening + $cashIn - $cashOut),
        'other_modes' => $other,
        'expenses' => rows(EXPENSE_SELECT . ' WHERE e.spent_on = ? ORDER BY e.id', [$date]),
        'expenses_total' => $sum('SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE spent_on = ?'),
        'close' => row('SELECT c.*, u.name AS user_name FROM cash_closes c LEFT JOIN users u ON u.id = c.user_id WHERE c.close_date = ?', [$date]),
    ];
}

route('GET', '/expenses', function () {
    [$limit, $offset] = paging(50, 500);
    $where = [];
    $params = [];
    if ($from = qp('from')) {
        $where[] = 'e.spent_on >= ?';
        $params[] = $from;
    }
    if ($to = qp('to')) {
        $where[] = 'e.spent_on <= ?';
        $params[] = $to;
    }
    if ($cat = qp_int('category_id')) {
        $where[] = 'e.category_id = ?';
        $params[] = $cat;
    }
    $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    return [
        'items' => rows(EXPENSE_SELECT . " $w ORDER BY e.spent_on DESC, e.id DESC LIMIT $limit OFFSET $offset", $params),
        'total' => (int) val("SELECT COUNT(*) FROM expenses e $w", $params),
        'sum_total' => r2((float) val("SELECT COALESCE(SUM(e.amount), 0) FROM expenses e $w", $params)),
    ];
}, ['perm' => 'cash_book']);

route('POST', '/expenses', function () {
    $body = body();
    if (empty($body['category_id']) && is_string($body['category'] ?? null) && isset(LEGACY_EXPENSE_CATEGORIES[$body['category']])) {
        $body['category_id'] = LEGACY_EXPENSE_CATEGORIES[$body['category']];
    }
    $in = clean($body, [
        'spent_on' => 'date',
        'category_id' => 'int|req',
        'amount' => 'num|req|min:0.01|max:10000000',
        'mode' => 'enum:cash,upi,bank|def:cash',
        'note' => 'str|max:255',
    ]);
    if (!val('SELECT id FROM expense_categories WHERE id = ?', [$in['category_id']])) {
        fail(422, 'validation_failed', 'Choose what the money was for', ['category_id' => 'invalid_choice']);
    }
    $in['spent_on'] = cash_date($in['spent_on'] ?? null);
    $id = tx(function () use ($in) {
        if (day_closed($in['spent_on'])) {
            fail(409, 'day_closed', 'This day\'s cash is already counted; reopen it first');
        }
        return insert('expenses', $in + ['user_id' => uid()]);
    });
    return ['item' => row(EXPENSE_SELECT . ' WHERE e.id = ?', [$id])];
}, ['perm' => 'cash_book']);

route('DELETE', '/expenses/{id}', function ($p) {
    tx(function () use ($p) {
        $e = row(EXPENSE_SELECT . ' WHERE e.id = ? FOR UPDATE', [(int) $p['id']]) ?? not_found('Expense');
        if (day_closed($e['spent_on'])) {
            fail(409, 'day_closed', 'This day\'s cash is already counted; reopen it first');
        }
        q('DELETE FROM expenses WHERE id = ?', [$e['id']]);
        audit('expense_delete', 'expense', (int) $e['id'], ['date' => $e['spent_on'], 'category' => $e['category_en'], 'amount' => (float) $e['amount'], 'note' => $e['note']], null);
    });
    return ['ok' => true];
}, ['perm' => 'cash_book']);

route('GET', '/cash/day', function () {
    return cash_day(cash_date(qp('date')));
}, ['perm' => 'cash_book']);

route('GET', '/cash/closes', function () {
    $to = qp('to') ?: today();
    $from = qp('from') ?: date('Y-m-d', strtotime($to . ' -30 days'));
    return ['items' => rows(
        'SELECT c.*, u.name AS user_name FROM cash_closes c LEFT JOIN users u ON u.id = c.user_id WHERE c.close_date BETWEEN ? AND ? ORDER BY c.close_date DESC',
        [$from, $to]
    )];
}, ['perm' => 'cash_book']);

/* Count the drawer at the end of the day. The opening is only asked for on the very first count. */
route('POST', '/cash/close', function () {
    $in = clean(body(), [
        'date' => 'date',
        'counted' => 'num|req|min:0|max:100000000',
        'taken_out' => 'num|min:0|max:100000000|def:0',
        'opening' => 'num|min:0|max:100000000',
        'note' => 'str|max:255',
    ]);
    $date = cash_date($in['date'] ?? null);
    if ((float) $in['taken_out'] > (float) $in['counted'] + 0.004) {
        fail(422, 'validation_failed', 'Cannot take out more than was counted', ['taken_out' => 'out_of_range']);
    }
    tx(function () use ($in, $date) {
        if (day_closed($date)) {
            fail(409, 'day_closed', 'This day\'s cash is already counted');
        }
        $d = cash_day($date);
        $opening = $d['opening_from'] === null && isset($in['opening']) ? r2((float) $in['opening']) : $d['opening'];
        $expected = r2($opening + $d['cash_in'] - $d['cash_out']);
        $diff = r2((float) $in['counted'] - $expected);
        $id = insert('cash_closes', [
            'close_date' => $date,
            'opening' => $opening,
            'cash_in' => $d['cash_in'],
            'cash_out' => $d['cash_out'],
            'expected' => $expected,
            'counted' => r2((float) $in['counted']),
            'difference' => $diff,
            'taken_out' => r2((float) $in['taken_out']),
            'note' => $in['note'] ?? null,
            'user_id' => uid(),
        ]);
        audit('cash_close', 'cash_close', $id, null, ['date' => $date, 'expected' => $expected, 'counted' => r2((float) $in['counted']), 'difference' => $diff, 'taken_out' => r2((float) $in['taken_out'])]);
    });
    return cash_day($date);
}, ['perm' => 'cash_book']);

/* Owner: undo a day's count (to fix an expense or count again). */
route('DELETE', '/cash/close/{date}', function ($p) {
    $date = cash_date($p['date']);
    tx(function () use ($date) {
        $c = row('SELECT * FROM cash_closes WHERE close_date = ? FOR UPDATE', [$date]) ?? not_found('Cash count');
        q('DELETE FROM cash_closes WHERE id = ?', [$c['id']]);
        audit('cash_reopen', 'cash_close', (int) $c['id'], ['date' => $date, 'expected' => (float) $c['expected'], 'counted' => (float) $c['counted'], 'difference' => (float) $c['difference']], null);
    });
    return cash_day($date);
}, ['roles' => [ROLE_OWNER]]);
