<?php
declare(strict_types=1);

/*
 * Reading a photo of a handwritten paper job card with Google Gemini, so the app can pre-fill New job.
 * Staff always check the result before saving.
 *
 * config.php: 'gemini_api_key' (required to enable), 'gemini_model' (optional).
 * Use a key from a Google Cloud project WITH BILLING ENABLED: on Google's free tier the photos (customer
 * names, phone numbers) may be used to improve Google's products and read by human reviewers.
 * Tests set 'ai_stub' to a file holding a canned Gemini response instead of calling Google.
 */

const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent';
const JOBCARD_FIELDS = ['customer_name', 'phone', 'reg_no', 'make', 'model', 'odometer', 'fuel_level', 'complaint', 'mechanic', 'promised_at'];
const JOBCARD_SCAN_DIR = API_DIR . '/storage/scans';
const JOBCARD_SCANS_PER_HOUR = 60;

function job_card_scan_enabled(): bool
{
    return (string) config('gemini_api_key', '') !== '' || (string) config('ai_stub', '') !== '';
}

function job_card_schema(): array
{
    $s = static fn (string $d) => ['type' => ['string', 'null'], 'description' => $d];
    return [
        'type' => 'object',
        'properties' => [
            'customer_name' => $s('Customer name exactly as written; keep Marathi in Devanagari'),
            'phone' => $s('Customer mobile number, digits only'),
            'reg_no' => $s('Bike registration number, uppercase without spaces, e.g. MH19AB1234'),
            'make' => $s('Bike brand, e.g. Hero, Honda, Bajaj, TVS'),
            'model' => $s('Bike model, e.g. Splendor, Activa'),
            'odometer' => ['type' => ['integer', 'null'], 'description' => 'Kilometre reading, number only'],
            'fuel_level' => $s('Fuel level: one of E, 1/4, 1/2, 3/4, F'),
            'complaint' => $s('Complaints / work asked for, as written, separated by commas'),
            'mechanic' => $s('Mechanic name if written'),
            'mechanic_id' => ['type' => ['integer', 'null'], 'description' => 'id from the mechanic list that matches the written mechanic, else null'],
            'promised_at' => $s('Promised delivery as YYYY-MM-DD HH:MM:SS, else null'),
            'unclear' => ['type' => 'array', 'items' => ['type' => 'string', 'enum' => JOBCARD_FIELDS], 'description' => 'Fields you could not read confidently'],
        ],
        'required' => array_merge(JOBCARD_FIELDS, ['mechanic_id', 'unclear']),
    ];
}

function job_card_prompt(array $mechanics): string
{
    $list = $mechanics ? implode('; ', array_map(static fn ($m) => "{$m['id']} = {$m['name']}", $mechanics)) : 'none';
    return "This photo shows a handwritten job card from " . setting('shop_name', 'a garage') . ", a two-wheeler repair shop in "
        . "Maharashtra, India. Writing may be Marathi (Devanagari), English or both. Read the card and fill the fields.\n"
        . "- Copy the customer name and complaints as written; keep Marathi in Devanagari script.\n"
        . "- phone: Indian mobile number (10 digits). reg_no: Indian registration number, uppercase, no spaces or dashes.\n"
        . "- odometer: kilometres as a whole number. fuel_level: only E, 1/4, 1/2, 3/4 or F.\n"
        . "- mechanic_id: pick from this list only if the written mechanic clearly matches (names may be written in Marathi): {$list}.\n"
        . "- Today is " . today() . " (" . date('l') . "). Turn a promised time like 'संध्या 6' or 'उद्या 12' into promised_at.\n"
        . "- Use null for anything not on the card. Do not guess numbers.\n"
        . "- List in 'unclear' every field whose handwriting you are not sure about.\n"
        . "Answer with the JSON object only.";
}

/** Call Gemini (or the test stub); returns the decoded field object. Throws ApiError on failure. */
function gemini_read_job_card(string $imagePath, string $mime, array $mechanics): array
{
    $stub = (string) config('ai_stub', '');
    if ($stub !== '') {
        return gemini_extract_json((string) file_get_contents($stub));
    }
    $key = (string) config('gemini_api_key', '');
    if ($key === '') {
        fail(409, 'scan_not_configured', 'Reading job cards is not set up on this server');
    }
    $parts = [
        ['inline_data' => ['mime_type' => $mime, 'data' => base64_encode((string) file_get_contents($imagePath))]],
        ['text' => job_card_prompt($mechanics)],
    ];
    $url = sprintf(GEMINI_URL, rawurlencode((string) config('gemini_model', GEMINI_DEFAULT_MODEL) ?: GEMINI_DEFAULT_MODEL));
    // Ask for schema-shaped JSON; if this API version rejects the schema fields, retry with the prompt alone.
    foreach ([['responseMimeType' => 'application/json', 'responseJsonSchema' => job_card_schema(), 'temperature' => 0], ['temperature' => 0]] as $i => $gen) {
        [$code, $body] = gemini_post($url, $key, ['contents' => [['parts' => $parts]], 'generationConfig' => $gen]);
        if ($code === 200) {
            return gemini_extract_json($body);
        }
        if ($code !== 400 || $i === 1) {
            log_error(new RuntimeException("Gemini HTTP $code: " . mb_substr($body, 0, 500)));
            fail(502, 'scan_failed', 'Could not read the job card (reading service error ' . $code . ')');
        }
    }
    fail(502, 'scan_failed', 'Could not read the job card');
}

function gemini_post(string $url, string $key, array $payload): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $key],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 45,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($body === false) {
        log_error(new RuntimeException('Gemini request failed: ' . $err));
        fail(502, 'scan_failed', 'Could not reach the reading service');
    }
    return [$code, (string) $body];
}

/** The JSON object inside a generateContent response (tolerates ```json fences and thought parts). */
function gemini_extract_json(string $response): array
{
    $r = json_decode($response, true);
    $text = '';
    foreach ($r['candidates'][0]['content']['parts'] ?? [] as $part) {
        if (empty($part['thought']) && isset($part['text'])) {
            $text .= $part['text'];
        }
    }
    $text = trim(preg_replace('/^```(?:json)?\s*|\s*```$/i', '', trim($text)) ?? '');
    $data = json_decode($text, true);
    if (!is_array($data)) {
        log_error(new RuntimeException('Gemini answer was not JSON: ' . mb_substr($response, 0, 500)));
        fail(502, 'scan_failed', 'Could not read the job card');
    }
    return $data;
}

/** Clean what was read, match existing customer / bike, and say which fields need a look. */
function job_card_normalize(array $raw, array $mechanics): array
{
    $str = static fn ($v, int $max) => is_scalar($v) && trim((string) $v) !== '' ? mb_substr(trim((string) $v), 0, $max) : null;
    $unclear = array_values(array_intersect(JOBCARD_FIELDS, is_array($raw['unclear'] ?? null) ? $raw['unclear'] : []));

    $phoneRaw = $str($raw['phone'] ?? null, 20);
    $phone = $phoneRaw ? normalize_phone($phoneRaw) : null;
    if ($phoneRaw && !$phone) {
        $unclear[] = 'phone';
    }
    $regRaw = $str($raw['reg_no'] ?? null, 20);
    $reg = $regRaw ? normalize_reg_no($regRaw) : null;
    $odo = $raw['odometer'] ?? null;
    $odo = is_numeric($odo) && (int) $odo >= 0 && (int) $odo < 10000000 ? (int) $odo : null;
    $fuel = in_array($raw['fuel_level'] ?? null, ['E', '1/4', '1/2', '3/4', 'F'], true) ? $raw['fuel_level'] : null;
    $mechIds = array_map(static fn ($m) => (int) $m['id'], $mechanics);
    $mechId = in_array((int) ($raw['mechanic_id'] ?? 0), $mechIds, true) ? (int) $raw['mechanic_id'] : null;
    $promised = $str($raw['promised_at'] ?? null, 19);
    if ($promised && !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $promised)) {
        $promised = null;
    }

    $fields = [
        'customer_name' => $str($raw['customer_name'] ?? null, 120),
        'phone' => $phone ?? $phoneRaw,
        'reg_no' => $reg ?: $regRaw,
        'make' => $str($raw['make'] ?? null, 40),
        'model' => $str($raw['model'] ?? null, 60),
        'odometer' => $odo,
        'fuel_level' => $fuel,
        'complaint' => $str($raw['complaint'] ?? null, 2000),
        'mechanic' => $str($raw['mechanic'] ?? null, 100),
        'mechanic_id' => $mechId,
        'promised_at' => $promised,
    ];

    // Existing customer / bike: the bike number wins (it is unique), then the phone.
    $match = ['customer' => null, 'vehicle_id' => null];
    $veh = $reg ? row('SELECT id, customer_id FROM vehicles WHERE reg_no = ?', [$reg]) : null;
    $custId = $veh ? (int) $veh['customer_id'] : ($phone ? (int) (val('SELECT id FROM customers WHERE phone = ? OR alt_phone = ?', [$phone, $phone]) ?: 0) : 0);
    if ($custId) {
        $c = customer_by_id($custId);
        $c['open_job'] = row("SELECT id, job_no, status, vehicle_id FROM job_cards WHERE customer_id = ? AND status NOT IN ('delivered','cancelled') ORDER BY id DESC LIMIT 1", [$custId]);
        $match = ['customer' => $c, 'vehicle_id' => $veh ? (int) $veh['id'] : null];
    }
    return ['fields' => $fields, 'unclear' => array_values(array_unique($unclear)), 'match' => $match];
}

/** Keep the uploaded card for up to two days so the job created from it can carry the photo. */
function job_card_store(string $tmp, string $ext): string
{
    if (!is_dir(JOBCARD_SCAN_DIR) && !mkdir(JOBCARD_SCAN_DIR, 0750, true) && !is_dir(JOBCARD_SCAN_DIR)) {
        fail(500, 'storage_error', 'Cannot save the photo on the server');
    }
    foreach (glob(JOBCARD_SCAN_DIR . '/*') ?: [] as $f) {
        if (filemtime($f) < time() - 2 * 86400) {
            @unlink($f);
        }
    }
    $id = bin2hex(random_bytes(12));
    if (!move_uploaded_file($tmp, JOBCARD_SCAN_DIR . "/$id.$ext") && !rename($tmp, JOBCARD_SCAN_DIR . "/$id.$ext")) {
        fail(500, 'storage_error', 'Cannot save the photo on the server');
    }
    return $id;
}

/** Path of a stored scan, or null. */
function job_card_scan_file(string $scanId): ?string
{
    if (!preg_match('/^[a-f0-9]{24}$/', $scanId)) {
        return null;
    }
    return (glob(JOBCARD_SCAN_DIR . "/$scanId.*") ?: [null])[0];
}

/** Scans in the last hour (a guard against a stuck button or a bug running up the Google bill). */
function job_card_scans_last_hour(): int
{
    $n = 0;
    foreach (glob(JOBCARD_SCAN_DIR . '/*') ?: [] as $f) {
        $n += filemtime($f) >= time() - 3600 ? 1 : 0;
    }
    return $n;
}
