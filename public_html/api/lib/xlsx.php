<?php
declare(strict_types=1);

/*
 * A small Excel (.xlsx) writer for downloads such as the parts import sample: text and numbers, a bold first row,
 * several sheets. No PHP extensions needed (the ZIP is written by hand, uncompressed).
 */

/**
 * @param array<string, list<list<string|int|float|null>>> $sheets sheet name => rows (first row bold)
 */
function xlsx_build(array $sheets): string
{
    $x = static fn (string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $files = [];
    $n = count($sheets);
    $over = '';
    $wbSheets = '';
    $wbRels = '';
    $i = 0;
    foreach ($sheets as $name => $rows) {
        $i++;
        $over .= '<Override PartName="/xl/worksheets/sheet' . $i . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        $wbSheets .= '<sheet name="' . $x(mb_substr((string) $name, 0, 31)) . '" sheetId="' . $i . '" r:id="rId' . $i . '"/>';
        $wbRels .= '<Relationship Id="rId' . $i . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $i . '.xml"/>';
        $cols = max(1, ...array_map('count', $rows ?: [[]]));
        // One width for all columns, from the longest text (short headings stay readable, help sentences fit).
        $longest = 0;
        foreach ($rows as $cells) {
            foreach ($cells as $v) {
                $longest = max($longest, mb_strlen((string) $v));
            }
        }
        $width = max(12, min(100, $longest + 2));
        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<cols><col min="1" max="' . $cols . '" width="' . $width . '" customWidth="1"/></cols><sheetData>';
        foreach (array_values($rows) as $r => $cells) {
            $xml .= '<row r="' . ($r + 1) . '">';
            foreach (array_values($cells) as $c => $v) {
                if ($v === null || $v === '') {
                    continue;
                }
                $ref = xlsx_col($c) . ($r + 1);
                $style = $r === 0 ? ' s="1"' : '';
                $xml .= is_int($v) || is_float($v)
                    ? '<c r="' . $ref . '"' . $style . '><v>' . $v . '</v></c>'
                    : '<c r="' . $ref . '" t="inlineStr"' . $style . '><is><t xml:space="preserve">' . $x((string) $v) . '</t></is></c>';
            }
            $xml .= '</row>';
        }
        $files['xl/worksheets/sheet' . $i . '.xml'] = $xml . '</sheetData></worksheet>';
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
        . '<sheets>' . $wbSheets . '</sheets></workbook>';
    $files['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $wbRels
        . '<Relationship Id="rId' . ($n + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        . '</Relationships>';
    $files['xl/styles.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        . '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
        . '</styleSheet>';
    return zip_store($files);
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
