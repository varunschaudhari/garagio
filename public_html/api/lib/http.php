<?php
declare(strict_types=1);

/** An error that is sent to the client as {"error", "code"} with an HTTP status. */
final class ApiError extends RuntimeException
{
    public int $status;
    public string $errCode;
    public array $fields;

    public function __construct(int $status, string $errCode, string $message, array $fields = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->errCode = $errCode;
        $this->fields = $fields;
    }
}

/** A non-JSON response (HTML, CSV, file). Handlers return it instead of an array. */
final class RawResponse
{
    public function __construct(
        public string $body,
        public string $contentType = 'text/html; charset=utf-8',
        public int $status = 200,
        public array $headers = []
    ) {
    }
}

function fail(int $status, string $code, string $message, array $fields = []): never
{
    throw new ApiError($status, $code, $message, $fields);
}

function not_found(string $what = 'Record'): never
{
    fail(404, 'not_found', "$what not found");
}

function json_encode_api($data): string
{
    return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
}

function send_json($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode_api($data);
}

function send_raw(RawResponse $r): void
{
    http_response_code($r->status);
    header('Content-Type: ' . $r->contentType);
    header('Cache-Control: no-store');
    foreach ($r->headers as $k => $v) {
        header("$k: $v");
    }
    echo $r->body;
}

function html_response(string $html, int $status = 200): RawResponse
{
    return new RawResponse($html, 'text/html; charset=utf-8', $status);
}

/** Build a CSV download from a header row and data rows. */
/** Text typed by staff (names, notes) must not run as a formula when the CSV opens in Excel. */
function csv_safe($v)
{
    if (is_string($v) && $v !== '' && !is_numeric($v) && in_array($v[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
        return "'" . $v;
    }
    return $v;
}

function csv_response(string $filename, array $header, array $rows): RawResponse
{
    $fh = fopen('php://temp', 'r+');
    fwrite($fh, "\xEF\xBB\xBF"); // BOM so Excel opens Marathi text correctly
    fputcsv($fh, $header);
    foreach ($rows as $row) {
        fputcsv($fh, array_map('csv_safe', array_values($row)));
    }
    rewind($fh);
    $csv = stream_get_contents($fh);
    fclose($fh);
    return new RawResponse($csv, 'text/csv; charset=utf-8', 200, [
        'Content-Disposition' => 'attachment; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $filename) . '"',
    ]);
}

/** Decoded JSON body (or form fields for multipart requests). */
function body(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($type, 'multipart/form-data') !== false || stripos($type, 'application/x-www-form-urlencoded') !== false) {
        return $cache = $_POST;
    }
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return $cache = [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail(400, 'bad_json', 'Request body must be a JSON object');
    }
    return $cache = $data;
}

/** Query-string parameter. */
function qp(string $key, $default = null)
{
    $v = $_GET[$key] ?? $default;
    return is_string($v) ? trim($v) : $v;
}

function qp_int(string $key, ?int $default = null): ?int
{
    $v = qp($key);
    if ($v === null || $v === '') {
        return $default;
    }
    if (filter_var($v, FILTER_VALIDATE_INT) === false) {
        fail(400, 'bad_param', "Parameter $key must be a number");
    }
    return (int) $v;
}

function qp_date(string $key, ?string $default = null): ?string
{
    $v = qp($key);
    if ($v === null || $v === '') {
        return $default;
    }
    $d = DateTime::createFromFormat('!Y-m-d', $v);
    if (!$d || $d->format('Y-m-d') !== $v) {
        fail(400, 'bad_param', "Parameter $key must be a date (YYYY-MM-DD)");
    }
    return $v;
}

/** page / per_page from the query string → [limit, offset, page, per_page]. */
function paging(int $defaultPer = 50, int $maxPer = 500): array
{
    $page = max(1, qp_int('page', 1));
    $per = qp_int('per_page', $defaultPer);
    $per = max(1, min($maxPer, $per));
    return [$per, ($page - 1) * $per, $page, $per];
}

function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

/* ------------------------------------------------------------------ validation */

/**
 * Whitelist and validate input. Only fields named in $spec are returned.
 *
 * Rule string, pipe separated. First token is the type:
 *   str, text, int, num, bool, date, datetime, enum:a,b, phone, gstin, regno, username, lang, state
 * Modifiers: req, max:N, min:N, def:V (value used when the field is sent empty - for NOT NULL columns)
 *
 * With $partial = true missing fields are skipped instead of failing "required" (PUT updates).
 * Empty strings become null (or 0 for bool, or the def: value).
 */
function clean(array $in, array $spec, bool $partial = false): array
{
    $out = [];
    $errors = [];
    foreach ($spec as $field => $ruleStr) {
        $tokens = explode('|', $ruleStr);
        $type = array_shift($tokens);
        $typeArg = null;
        if (str_contains($type, ':')) {
            [$type, $typeArg] = explode(':', $type, 2);
        }
        $req = false;
        $min = null;
        $max = null;
        $def = null;
        foreach ($tokens as $tok) {
            if ($tok === 'req') {
                $req = true;
            } elseif (str_starts_with($tok, 'def:')) {
                $def = substr($tok, 4);
            } elseif (str_starts_with($tok, 'max:')) {
                $max = (float) substr($tok, 4);
            } elseif (str_starts_with($tok, 'min:')) {
                $min = (float) substr($tok, 4);
            }
        }

        if (!array_key_exists($field, $in)) {
            if ($req && !$partial) {
                $errors[$field] = 'required';
            } elseif ($def !== null && !$partial) {
                $out[$field] = match ($type) {
                    'int' => (int) $def,
                    'num' => (float) $def,
                    default => $def,
                };
            }
            continue;
        }
        $v = $in[$field];
        if (is_string($v)) {
            $v = trim($v);
        }
        if ($v === '' || $v === null) {
            if ($req) {
                $errors[$field] = 'required';
                continue;
            }
            if ($def !== null) {
                $out[$field] = match ($type) {
                    'int' => (int) $def,
                    'num' => (float) $def,
                    default => $def,
                };
            } else {
                $out[$field] = $type === 'bool' ? 0 : null;
            }
            continue;
        }
        if (is_array($v) && $type !== 'array') {
            $errors[$field] = 'invalid';
            continue;
        }

        switch ($type) {
            case 'str':
            case 'text':
                $v = (string) $v;
                $limit = $max ?? ($type === 'text' ? 5000 : 255);
                if (mb_strlen($v) > $limit) {
                    $errors[$field] = 'too_long';
                    continue 2;
                }
                if ($min !== null && mb_strlen($v) < $min) {
                    $errors[$field] = 'too_short';
                    continue 2;
                }
                break;
            case 'int':
                if (filter_var($v, FILTER_VALIDATE_INT) === false) {
                    $errors[$field] = 'not_integer';
                    continue 2;
                }
                $v = (int) $v;
                if (($min !== null && $v < $min) || ($max !== null && $v > $max)) {
                    $errors[$field] = 'out_of_range';
                    continue 2;
                }
                break;
            case 'num':
                if (!is_numeric($v)) {
                    $errors[$field] = 'not_number';
                    continue 2;
                }
                $v = (float) $v;
                if (($min !== null && $v < $min) || ($max !== null && $v > $max)) {
                    $errors[$field] = 'out_of_range';
                    continue 2;
                }
                break;
            case 'bool':
                $b = filter_var($v, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if ($b === null) {
                    $errors[$field] = 'invalid';
                    continue 2;
                }
                $v = $b ? 1 : 0;
                break;
            case 'date':
                $d = DateTime::createFromFormat('!Y-m-d', (string) $v);
                if (!$d || $d->format('Y-m-d') !== $v) {
                    $errors[$field] = 'invalid_date';
                    continue 2;
                }
                break;
            case 'datetime':
                $s = str_replace('T', ' ', (string) $v);
                if (strlen($s) === 16) {
                    $s .= ':00';
                }
                $d = DateTime::createFromFormat('Y-m-d H:i:s', $s);
                if (!$d) {
                    $errors[$field] = 'invalid_date';
                    continue 2;
                }
                $v = $d->format('Y-m-d H:i:s');
                break;
            case 'enum':
                $allowed = explode(',', (string) $typeArg);
                if (!in_array((string) $v, $allowed, true)) {
                    $errors[$field] = 'invalid_choice';
                    continue 2;
                }
                $v = (string) $v;
                break;
            case 'lang':
                if (!in_array($v, ['mr', 'en'], true)) {
                    $errors[$field] = 'invalid_choice';
                    continue 2;
                }
                break;
            case 'phone':
                $p = normalize_phone((string) $v);
                if ($p === null) {
                    $errors[$field] = 'invalid_phone';
                    continue 2;
                }
                $v = $p;
                break;
            case 'gstin':
                $g = strtoupper(preg_replace('/\s+/', '', (string) $v));
                if (!preg_match('/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/', $g)) {
                    $errors[$field] = 'invalid_gstin';
                    continue 2;
                }
                $v = $g;
                break;
            case 'state':
                if (!preg_match('/^\d{2}$/', (string) $v)) {
                    $errors[$field] = 'invalid_state';
                    continue 2;
                }
                $v = (string) $v;
                break;
            case 'regno':
                $r = normalize_reg_no((string) $v);
                if (!preg_match('/^[A-Z0-9]{4,12}$/', $r)) {
                    $errors[$field] = 'invalid_reg_no';
                    continue 2;
                }
                $v = $r;
                break;
            case 'username':
                $u = strtolower((string) $v);
                if (!preg_match('/^[a-z0-9._-]{3,30}$/', $u)) {
                    $errors[$field] = 'invalid_username';
                    continue 2;
                }
                $v = $u;
                break;
            default:
                throw new LogicException("Unknown validation type $type");
        }
        $out[$field] = $v;
    }
    if ($errors) {
        fail(422, 'validation_failed', 'Please check the highlighted fields', $errors);
    }
    return $out;
}

/** 10-digit Indian mobile number, or null. Accepts +91, 0 prefixes, spaces and dashes. */
function normalize_phone(string $p): ?string
{
    $d = preg_replace('/\D+/', '', $p);
    if (strlen($d) === 12 && str_starts_with($d, '91')) {
        $d = substr($d, 2);
    } elseif (strlen($d) === 11 && str_starts_with($d, '0')) {
        $d = substr($d, 1);
    }
    return preg_match('/^[6-9]\d{9}$/', $d) ? $d : null;
}

/** "mh 12 ab-1234" → "MH12AB1234" */
function normalize_reg_no(string $r): string
{
    return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $r));
}
