<?php
declare(strict_types=1);

/*
 * A small Excel (.xlsx) writer for downloads: the parts import sample, reports and data exports. No PHP extensions
 * needed (the ZIP is written by hand, uncompressed).
 *
 * A sheet is either a plain list of rows (first row bold), or a table:
 *   ['columns' => [key => heading], 'rows' => [[key => value]], 'totals' => [key => value], 'types' => [key => type]]
 * Table cells get a type (text, money, num, date, datetime; guessed by xlsx_types() when not given): money with
 * thousands separators and 2 decimals, dates as real Excel dates shown DD-MM-YYYY. The heading row is frozen
 * and has filter buttons; the totals row is bold.
 */

/** Columns that stay text even when they hold digits (phone numbers, bill numbers, HSN...). */
const XLSX_TEXT_KEYS = ['phone', 'alt_phone', 'cust_phone', 'gstin', 'part_no', 'invoice_no', 'bill_no', 'return_no', 'job_no', 'hsn', 'reg_no', 'month', 'rack', 'reference', 'username', 'note'];
/** Numeric columns that are counts or percentages, not money. */
const XLSX_NUM_KEYS = ['stock', 'jobs', 'qty', 'rate', 'gst_rate', 'disc_pct', 'min_stock', 'odometer', 'km', 'next_service_km', 'year', 'count'];

/** Guess each table column's type from its key and values. */
function xlsx_types(array $columns, array $rows): array
{
    $types = [];
    foreach (array_keys($columns) as $k) {
        if (in_array($k, XLSX_TEXT_KEYS, true)) {
            $types[$k] = 'text';
            continue;
        }
        $vals = array_filter(array_map(static fn ($r) => $r[$k] ?? null, $rows), static fn ($v) => $v !== null && $v !== '');
        if (!$vals) {
            $types[$k] = 'text';
        } elseif (!array_filter($vals, static fn ($v) => !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v))) {
            $types[$k] = 'date';
        } elseif (!array_filter($vals, static fn ($v) => !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', (string) $v))) {
            $types[$k] = 'datetime';
        } elseif (!array_filter($vals, static fn ($v) => !is_int($v) && !is_float($v) && !(is_string($v) && is_numeric($v)))) {
            $types[$k] = in_array($k, XLSX_NUM_KEYS, true) || str_ends_with($k, '_pct') || str_ends_with($k, '_km') ? 'num' : 'money';
        } else {
            $types[$k] = 'text';
        }
    }
    return $types;
}

/** Excel's day number for 'Y-m-d' or 'Y-m-d H:i[:s]' (days since 30-12-1899, the time as a fraction). */
function xlsx_serial(string $v): ?float
{
    $full = strlen($v) === 10 ? "$v 00:00:00" : (strlen($v) === 16 ? "$v:00" : $v);
    $d = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $full, new DateTimeZone('UTC'));
    return $d ? round($d->getTimestamp() / 86400 + 25569, 6) : null;
}

/** Style ids in styles.xml (cellXfs). */
const XLSX_S_HEAD = 1;
const XLSX_S_MONEY = 2;
const XLSX_S_DATE = 3;
const XLSX_S_MONEY_BOLD = 4;
const XLSX_S_BOLD = 5;
const XLSX_S_DATETIME = 6;

/**
 * Rows of [value, type, style] cells → <row> XML. Types: text, money, num, date, datetime, raw (as given).
 * Returns [xml, widest text per column index].
 */
function xlsx_rows_xml(array $rows): array
{
    $x = static fn (string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $xml = '';
    $widths = [];
    foreach (array_values($rows) as $r => $cells) {
        $xml .= '<row r="' . ($r + 1) . '">';
        foreach (array_values($cells) as $c => [$v, $type, $style]) {
            if ($v === null || $v === '') {
                continue;
            }
            $ref = xlsx_col($c) . ($r + 1);
            $s = $style ? ' s="' . $style . '"' : '';
            $len = mb_strlen((string) $v);
            $serial = ($type === 'date' || $type === 'datetime') ? xlsx_serial((string) $v) : null;
            if ($serial !== null) {
                $xml .= '<c r="' . $ref . '"' . $s . '><v>' . $serial . '</v></c>';
                $len = $type === 'date' ? 10 : 16;
            } elseif (($type === 'money' || $type === 'num') && is_numeric($v)) {
                $num = $type === 'money' ? round((float) $v, 2) : $v + 0;
                $xml .= '<c r="' . $ref . '"' . $s . '><v>' . $num . '</v></c>';
                $len = $type === 'money' ? strlen(number_format((float) $v, 2)) : strlen((string) $num);
            } elseif (is_int($v) || is_float($v)) {
                $xml .= '<c r="' . $ref . '"' . $s . '><v>' . $v . '</v></c>';
            } else {
                $xml .= '<c r="' . $ref . '" t="inlineStr"' . $s . '><is><t xml:space="preserve">' . $x((string) $v) . '</t></is></c>';
            }
            $widths[$c] = max($widths[$c] ?? 0, $len);
        }
        $xml .= '</row>';
    }
    return [$xml, $widths];
}

/** A table sheet (see the top of this file) → rows of [value, type, style] cells. */
function xlsx_table_cells(array $spec): array
{
    $columns = $spec['columns'];
    $types = ($spec['types'] ?? []) + xlsx_types($columns, $spec['rows']);
    $style = static fn (string $t, bool $bold) => match ($t) {
        'money' => $bold ? XLSX_S_MONEY_BOLD : XLSX_S_MONEY,
        'date' => XLSX_S_DATE,
        'datetime' => XLSX_S_DATETIME,
        default => $bold ? XLSX_S_BOLD : 0,
    };
    $out = [array_map(static fn ($h) => [(string) $h, 'text', XLSX_S_HEAD], array_values($columns))];
    foreach ($spec['rows'] as $row) {
        $out[] = array_map(static fn ($k) => [$row[$k] ?? null, $types[$k], $style($types[$k], false)], array_keys($columns));
    }
    if (!empty($spec['totals']) && $spec['rows']) {
        $keys = array_keys($columns);
        $line = array_map(static fn ($k) => [$spec['totals'][$k] ?? null, $types[$k], $style($types[$k], true)], $keys);
        if (($spec['totals'][$keys[0]] ?? null) === null) {
            $line[0] = ['Total', 'text', XLSX_S_BOLD];
        }
        $out[] = $line;
    }
    return $out;
}

/**
 * @param array<string, array> $sheets sheet name => plain rows, or a table (see the top of this file)
 */
function xlsx_build(array $sheets): string
{
    $x = static fn (string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $files = [];
    $n = count($sheets);
    $over = '';
    $wbSheets = '';
    $wbRels = '';
    $names = '';
    $i = 0;
    foreach ($sheets as $name => $sheet) {
        $i++;
        $name = mb_substr(str_replace([chr(92), '/', '?', '*', '[', ']', ':'], ' ', (string) $name), 0, 31);
        $over .= '<Override PartName="/xl/worksheets/sheet' . $i . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        $wbSheets .= '<sheet name="' . $x($name) . '" sheetId="' . $i . '" r:id="rId' . $i . '"/>';
        $wbRels .= '<Relationship Id="rId' . $i . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $i . '.xml"/>';
        $table = isset($sheet['columns']);
        if ($table) {
            $cells = xlsx_table_cells($sheet);
        } else {
            $cells = [];
            foreach (array_values($sheet) as $r => $row) {
                $cells[] = array_map(static fn ($v) => [$v, 'raw', $r === 0 ? XLSX_S_HEAD : 0], array_values($row));
            }
        }
        [$rowsXml, $widths] = xlsx_rows_xml($cells);
        $cols = '';
        foreach ($widths as $c => $w) {
            $cols .= '<col min="' . ($c + 1) . '" max="' . ($c + 1) . '" width="' . max(8, min($table ? 60 : 100, $w + 2)) . '" customWidth="1"/>';
        }
        $view = '';
        $filter = '';
        if ($table && count($sheet['columns'])) {
            $view = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
            $range = '$A$1:$' . xlsx_col(count($sheet['columns']) - 1) . '$' . (count($sheet['rows']) + 1);
            $filter = '<autoFilter ref="' . str_replace('$', '', $range) . '"/>';
            $names .= '<definedName name="_xlnm._FilterDatabase" localSheetId="' . ($i - 1) . '" hidden="1">' . $x("'" . str_replace("'", "''", $name) . "'!" . $range) . '</definedName>';
        }
        $files['xl/worksheets/sheet' . $i . '.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . $view . ($cols ? '<cols>' . $cols . '</cols>' : '') . '<sheetData>' . $rowsXml . '</sheetData>' . $filter . '</worksheet>';
    }
    $files['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        . '<Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        . $over . '</Types>';
    $files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        . '</Relationships>';
    $files['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        . '<sheets>' . $wbSheets . '</sheets>' . ($names ? '<definedNames>' . $names . '</definedNames>' : '') . '</workbook>';
    $files['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $wbRels
        . '<Relationship Id="rId' . ($n + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        . '</Relationships>';
    // Styles: 0 plain, 1 heading (bold, grey fill), 2 money, 3 date, 4 bold money, 5 bold, 6 date and time.
    $files['xl/styles.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/><numFmt numFmtId="165" formatCode="dd-mm-yyyy hh:mm"/></numFmts>'
        . '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        . '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        . '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F4"/><bgColor indexed="64"/></patternFill></fill></fills>'
        . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="7">'
        . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        . '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
        . '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
        . '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
        . '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
        . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        . '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
        . '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return zip_store($files);
}

/** An .xlsx download. */
function xlsx_response(string $filename, array $sheets): RawResponse
{
    return new RawResponse(xlsx_build($sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, [
        'Content-Disposition' => 'attachment; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $filename) . '"',
        'Cache-Control' => 'no-store',
    ]);
}

/** "Part No." → "part_no", "पार्ट नं." → "पार्ट_नं" (headings of a sheet people made themselves). */
function import_heading(string $h): string
{
    return trim((string) preg_replace('/[^\p{L}\p{M}\p{N}]+/u', '_', mb_strtolower(trim($h))), '_');
}

/** Headings that are money columns or serial numbers, never one of our fields (checked before the loose rules). */
const IMPORT_SKIP_WORDS = ['taxable', 'amount', 'value', 'total', 'sl_no', 'sr_no', 's_no', 'serial', 'supplier', 'customer', 'party', 'vendor', 'date', 'bill_no', 'invoice', 'batch', 'expiry'];

/**
 * Which of our fields a heading means: an exact alias first ("Part No", "MRP"), then loose rules in order
 * ($fuzzy = [[field, [words…]], …]: "Description of Goods" → name, "Quantity (Nos)" → qty). null = not used.
 */
function import_field(string $heading, array $aliases, array $fuzzy = []): ?string
{
    $h = import_heading($heading);
    if ($h === '') {
        return null;
    }
    foreach ($aliases as $field => $names) {
        if (in_array($h, $names, true)) {
            return $field;
        }
    }
    foreach (IMPORT_SKIP_WORDS as $w) {
        if (str_contains($h, $w)) {
            return null;
        }
    }
    foreach ($fuzzy as [$field, $words]) {
        foreach ($words as $w) {
            if (str_contains($h, $w)) {
                return $field;
            }
        }
    }
    return null;
}

/**
 * A whole sheet (rows of cells) → heading => cell rows. Sheets from billing software start with the shop's name and
 * address, so the heading row is the one (among the first 40) that names most of our fields.
 * @return array{rows: list<array<string,string>>, first_row: int} first_row = sheet row number of the first data row
 */
function import_table_rows(array $table, array $aliases, array $fuzzy = []): array
{
    $table = array_values(array_filter($table, 'is_array'));
    $best = 0;
    $bestScore = 0;
    foreach (array_slice($table, 0, 40) as $i => $cells) {
        $fields = [];
        foreach ($cells as $c) {
            $f = is_scalar($c) ? import_field((string) $c, $aliases, $fuzzy) : null;
            if ($f !== null) {
                $fields[$f] = true;
            }
        }
        if (count($fields) > $bestScore) {
            $best = $i;
            $bestScore = count($fields);
        }
    }
    $headings = [];
    foreach (array_values($table[$best] ?? []) as $c => $h) {
        $name = trim(is_scalar($h) ? (string) $h : '');
        $name = $name === '' ? 'Column ' . ($c + 1) : $name;
        while (in_array($name, $headings, true)) {
            $name .= ' (2)';
        }
        $headings[$c] = $name;
    }
    $rows = [];
    foreach (array_slice($table, $best + 1) as $cells) {
        $row = [];
        foreach (array_values($cells) as $c => $v) {
            $v = is_scalar($v) ? trim((string) $v) : '';
            if ($v !== '' && isset($headings[$c])) {
                $row[$headings[$c]] = $v;
            }
        }
        $rows[] = $row; // empty rows kept, so row numbers stay right
    }
    return ['rows' => $rows, 'first_row' => $best + 2];
}

/**
 * One sheet row (heading => cell) → our fields, by $aliases (field => accepted headings) and the loose $fuzzy rules.
 * Number fields lose ₹, Rs, %, commas, units ("10 Nos") and spaces. Headings that match nothing go to $unused.
 */
function import_map_row(array $raw, array $aliases, array $numbers, array &$unused, array $fuzzy = []): array
{
    $out = [];
    foreach ($raw as $heading => $value) {
        $field = import_field((string) $heading, $aliases, $fuzzy);
        if ($field === null) {
            $unused[(string) $heading] = true;
            continue;
        }
        $v = is_scalar($value) ? trim((string) $value) : '';
        if (in_array($field, $numbers, true)) {
            $v = (string) preg_replace('/[^0-9.\-]/', '', (string) preg_replace('/rs\.?/i', '', $v));
        }
        if ($v !== '' && !isset($out[$field])) {
            $out[$field] = $v;
        }
    }
    return $out;
}

/** 0 → A, 25 → Z, 26 → AA */
function xlsx_col(int $i): string
{
    $s = '';
    for ($i++; $i > 0; $i = intdiv($i - 1, 26)) {
        $s = chr(65 + ($i - 1) % 26) . $s;
    }
    return $s;
}

/** An uncompressed ZIP archive of name => content (UTF-8 names). */
function zip_store(array $files): string
{
    $data = '';
    $central = '';
    $offset = 0;
    foreach ($files as $name => $content) {
        $name = (string) $name;
        $crc = crc32($content);
        $len = strlen($content);
        $local = pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, 0, 0, 0x21, $crc, $len, $len, strlen($name), 0) . $name . $content;
        $central .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x0800, 0, 0, 0x21, $crc, $len, $len, strlen($name), 0, 0, 0, 0, 0, $offset) . $name;
        $data .= $local;
        $offset += strlen($local);
    }
    return $data . $central . pack('VvvvvVVv', 0x06054b50, 0, 0, count($files), count($files), strlen($central), $offset, 0);
}
