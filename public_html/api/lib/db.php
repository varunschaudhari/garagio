<?php
declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config('db');
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $c['host'] ?? 'localhost',
            (int) ($c['port'] ?? 3306),
            $c['name']
        );
        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        $pdo->exec("SET time_zone = '+05:30'");
    }
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    foreach (array_values(array_is_list($params) ? $params : []) as $i => $v) {
        $st->bindValue($i + 1, $v, pdo_type($v));
    }
    if (!array_is_list($params)) {
        foreach ($params as $k => $v) {
            $st->bindValue(':' . ltrim((string) $k, ':'), $v, pdo_type($v));
        }
    }
    $st->execute();
    return $st;
}

function pdo_type($v): int
{
    return match (true) {
        is_int($v) => PDO::PARAM_INT,
        is_bool($v) => PDO::PARAM_BOOL,
        $v === null => PDO::PARAM_NULL,
        default => PDO::PARAM_STR,
    };
}

/** Fetch all rows; DECIMAL columns are converted to float so JSON carries numbers. */
function rows(string $sql, array $params = []): array
{
    $st = q($sql, $params);
    $decimals = decimal_columns($st);
    $out = $st->fetchAll();
    if ($decimals) {
        foreach ($out as &$r) {
            foreach ($decimals as $col) {
                if ($r[$col] !== null) {
                    $r[$col] = (float) $r[$col];
                }
            }
        }
        unset($r);
    }
    return $out;
}

function row(string $sql, array $params = []): ?array
{
    $st = q($sql, $params);
    $decimals = decimal_columns($st);
    $r = $st->fetch();
    if ($r === false) {
        return null;
    }
    foreach ($decimals as $col) {
        if ($r[$col] !== null) {
            $r[$col] = (float) $r[$col];
        }
    }
    return $r;
}

/** First column of the first row. */
function val(string $sql, array $params = [])
{
    $v = q($sql, $params)->fetchColumn();
    if ($v === false) {
        return null;
    }
    return is_string($v) && is_numeric($v) && str_contains($v, '.') ? (float) $v : $v;
}

function decimal_columns(PDOStatement $st): array
{
    $cols = [];
    $n = $st->columnCount();
    for ($i = 0; $i < $n; $i++) {
        $m = $st->getColumnMeta($i);
        if ($m && in_array($m['native_type'] ?? '', ['NEWDECIMAL', 'DECIMAL'], true)) {
            $cols[] = $m['name'];
        }
    }
    return $cols;
}

/** Insert a row, setting created_at / updated_at. Returns the new id. */
function insert(string $table, array $data): int
{
    $now = now();
    $data += ['created_at' => $now, 'updated_at' => $now];
    $cols = array_keys($data);
    $sql = sprintf(
        'INSERT INTO `%s` (`%s`) VALUES (%s)',
        $table,
        implode('`,`', $cols),
        implode(',', array_fill(0, count($cols), '?'))
    );
    q($sql, array_values($data));
    return (int) db()->lastInsertId();
}

/** Update a row by id, setting updated_at. */
function update_row(string $table, int $id, array $data): void
{
    if (!$data) {
        return;
    }
    $data['updated_at'] = now();
    $sets = implode(',', array_map(static fn ($c) => "`$c` = ?", array_keys($data)));
    q("UPDATE `$table` SET $sets WHERE id = ?", [...array_values($data), $id]);
}

/** Run $fn inside a transaction (nested calls join the outer one). */
function tx(callable $fn)
{
    $pdo = db();
    if ($pdo->inTransaction()) {
        return $fn();
    }
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

/** "?,?,?" for an IN list. */
function placeholders(array $items): string
{
    return implode(',', array_fill(0, max(1, count($items)), '?'));
}

/** LIKE pattern with % and _ escaped. */
function like(string $term): string
{
    return '%' . addcslashes($term, '%_\\') . '%';
}
