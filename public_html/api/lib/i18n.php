<?php
declare(strict_types=1);

/*
 * Server-side text for customer documents (invoice, estimate, WhatsApp messages).
 * UI strings live in public_html/assets/i18n/{en,mr}.json and are loaded by the clients.
 */

/** Load a translation file once. */
function i18n_strings(string $lang): array
{
    static $cache = [];
    if (!isset($cache[$lang])) {
        $file = WEB_ROOT . '/assets/i18n/' . ($lang === 'mr' ? 'mr' : 'en') . '.json';
        $cache[$lang] = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
    }
    return $cache[$lang];
}

/** Translate a dotted key, falling back to English, then to the key. {{var}} placeholders. */
function tr(string $key, string $lang = 'en', array $vars = []): string
{
    $find = static function (array $tree) use ($key) {
        $node = $tree;
        foreach (explode('.', $key) as $p) {
            if (!is_array($node) || !array_key_exists($p, $node)) {
                return null;
            }
            $node = $node[$p];
        }
        return is_string($node) ? $node : null;
    };
    $s = $find(i18n_strings($lang)) ?? $find(i18n_strings('en')) ?? $key;
    foreach ($vars as $k => $v) {
        $s = str_replace('{{' . $k . '}}', (string) $v, $s);
    }
    return $s;
}

/** "मराठी / English" label, ordered by the reader's language. */
function bi(string $key, string $first = 'mr', array $vars = []): string
{
    $mr = tr($key, 'mr', $vars);
    $en = tr($key, 'en', $vars);
    if ($mr === $en) {
        return $en;
    }
    return $first === 'en' ? "$en / $mr" : "$mr / $en";
}

/** Indian grouping: 123456.5 → "1,23,456.50" */
function inr(float $amount, bool $symbol = true): string
{
    $neg = $amount < 0;
    $s = number_format(abs($amount), 2, '.', '');
    [$int, $dec] = explode('.', $s);
    if (strlen($int) > 3) {
        $last3 = substr($int, -3);
        $rest = substr($int, 0, -3);
        $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest);
        $int = $rest . ',' . $last3;
    }
    return ($neg ? '-' : '') . ($symbol ? '₹' : '') . $int . '.' . $dec;
}

function fmt_date(?string $d): string
{
    return $d ? date('d-m-Y', strtotime($d)) : '';
}

/* ------------------------------------------------------------------ amount in words */

const EN_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Marathi number words 0–99 (they are irregular, so a table). */
const MR_0_99 = [
    'शून्य', 'एक', 'दोन', 'तीन', 'चार', 'पाच', 'सहा', 'सात', 'आठ', 'नऊ',
    'दहा', 'अकरा', 'बारा', 'तेरा', 'चौदा', 'पंधरा', 'सोळा', 'सतरा', 'अठरा', 'एकोणीस',
    'वीस', 'एकवीस', 'बावीस', 'तेवीस', 'चोवीस', 'पंचवीस', 'सव्वीस', 'सत्तावीस', 'अठ्ठावीस', 'एकोणतीस',
    'तीस', 'एकतीस', 'बत्तीस', 'तेहेतीस', 'चौतीस', 'पस्तीस', 'छत्तीस', 'सदतीस', 'अडतीस', 'एकोणचाळीस',
    'चाळीस', 'एक्केचाळीस', 'बेचाळीस', 'त्रेचाळीस', 'चव्वेचाळीस', 'पंचेचाळीस', 'सेहेचाळीस', 'सत्तेचाळीस', 'अठ्ठेचाळीस', 'एकोणपन्नास',
    'पन्नास', 'एक्कावन्न', 'बावन्न', 'त्रेपन्न', 'चोपन्न', 'पंचावन्न', 'छप्पन्न', 'सत्तावन्न', 'अठ्ठावन्न', 'एकोणसाठ',
    'साठ', 'एकसष्ट', 'बासष्ट', 'त्रेसष्ट', 'चौसष्ट', 'पासष्ट', 'सहासष्ट', 'सदुसष्ट', 'अडुसष्ट', 'एकोणसत्तर',
    'सत्तर', 'एक्काहत्तर', 'बाहत्तर', 'त्र्याहत्तर', 'चौर्‍याहत्तर', 'पंच्याहत्तर', 'शहात्तर', 'सत्त्याहत्तर', 'अठ्ठ्याहत्तर', 'एकोणऐंशी',
    'ऐंशी', 'एक्याऐंशी', 'ब्याऐंशी', 'त्र्याऐंशी', 'चौर्‍याऐंशी', 'पंच्याऐंशी', 'शहाऐंशी', 'सत्त्याऐंशी', 'अठ्ठ्याऐंशी', 'एकोणनव्वद',
    'नव्वद', 'एक्याण्णव', 'ब्याण्णव', 'त्र्याण्णव', 'चौर्‍याण्णव', 'पंच्याण्णव', 'शहाण्णव', 'सत्त्याण्णव', 'अठ्ठ्याण्णव', 'नव्व्याण्णव',
];

function en_below_100(int $n): string
{
    if ($n < 20) {
        return EN_ONES[$n];
    }
    return trim(EN_TENS[intdiv($n, 10)] . ' ' . EN_ONES[$n % 10]);
}

function en_words_int(int $n): string
{
    if ($n === 0) {
        return 'Zero';
    }
    $parts = [];
    foreach ([[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']] as [$div, $name]) {
        if ($n >= $div) {
            $q = intdiv($n, $div);
            $parts[] = ($div === 10000000 ? en_words_int($q) : en_below_100($q)) . ' ' . $name;
            $n %= $div;
        }
    }
    if ($n > 0) {
        $parts[] = en_below_100($n);
    }
    return implode(' ', $parts);
}

function mr_words_int(int $n): string
{
    if ($n === 0) {
        return MR_0_99[0];
    }
    $parts = [];
    foreach ([[10000000, 'कोटी'], [100000, 'लाख'], [1000, 'हजार']] as [$div, $name]) {
        if ($n >= $div) {
            $q = intdiv($n, $div);
            $parts[] = ($div === 10000000 ? mr_words_int($q) : MR_0_99[$q]) . ' ' . $name;
            $n %= $div;
        }
    }
    if ($n >= 100) {
        $h = intdiv($n, 100);
        $n %= 100;
        $parts[] = $h === 1 ? ($n === 0 ? 'शंभर' : 'एकशे') : MR_0_99[$h] . 'शे';
    }
    if ($n > 0) {
        $parts[] = MR_0_99[$n];
    }
    return implode(' ', $parts);
}

/** "Rupees One Thousand Two Hundred Only" (+ "and Fifty Paise") */
function amount_words_en(float $amount): string
{
    $rupees = (int) floor(round($amount, 2));
    $paise = (int) round((round($amount, 2) - $rupees) * 100);
    $s = 'Rupees ' . en_words_int($rupees);
    if ($paise > 0) {
        $s .= ' and ' . en_below_100($paise) . ' Paise';
    }
    return $s . ' Only';
}

/** "एक हजार दोनशे रुपये फक्त" */
function amount_words_mr(float $amount): string
{
    $rupees = (int) floor(round($amount, 2));
    $paise = (int) round((round($amount, 2) - $rupees) * 100);
    $s = mr_words_int($rupees) . ' रुपये';
    if ($paise > 0) {
        $s .= ' आणि ' . MR_0_99[$paise] . ' पैसे';
    }
    return $s . ' फक्त';
}

/** HTML escape for templates. */
function e($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
