<?php
/**
 * Bilingual tax invoice (A4). Printed from the web; turned into a PDF by the Android app (expo-print).
 * @var array $inv invoice with items  @var array $byRate tax summary  @var string $lang first language
 */
$L = static fn (string $key, array $vars = []) => bi("inv.$key", $lang, $vars);
$s = settings_all();
$shopEn = shop_full_name('en');
$shopMr = shop_full_name('mr');
$shopMr = $shopMr === $shopEn ? '' : $shopMr;
$inter = (int) $inv['is_interstate'] === 1;
// Bills made before GST registration stay plain bills (no GSTIN, no tax columns) even when reprinted later.
$reg = (int) ($inv['gst_registered'] ?? 1) === 1;
$shopState = $s['shop_state_code'];
$custState = $inv['cust_state_code'] ?: $shopState;
$name = $inv['customer_name'] ?: ($inv['cust_name'] ?: tr('inv.walk_in', $lang));
$phone = $inv['customer_phone'] ?: $inv['cust_phone'];
$gstin = $inv['cust_gstin'];
$num = static fn ($v) => number_format((float) $v, 2, '.', ',');
$upi = $s['upi_id'] ?? '';
$showQr = $upi && (float) $inv['balance'] > 0 && $inv['status'] === 'final';
$upiUri = $showQr ? 'upi://pay?pa=' . rawurlencode($upi) . '&pn=' . rawurlencode($shopEn) . '&am=' . number_format((float) $inv['balance'], 2, '.', '') . '&cu=INR&tn=' . rawurlencode((string) $inv['invoice_no']) : '';
$desc = static function (array $it) use ($lang): string {
    $en = $it['description_en'];
    $mr = $it['description_mr'] ?? '';
    if (!$mr || $mr === $en) {
        return e($en);
    }
    return $lang === 'en' ? e($en) . '<div class="alt">' . e($mr) . '</div>' : e($mr) . '<div class="alt">' . e($en) . '</div>';
};
?><!doctype html>
<html lang="<?= e($lang) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($inv['invoice_no'] ?: 'Draft') ?> · <?= e($shopEn) ?></title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111827; background: #fff; font: 12px/1.45 "Noto Sans Devanagari", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .page { max-width: 190mm; margin: 0 auto; padding: 8mm 0; position: relative; }
  .bar { display: flex; justify-content: flex-end; gap: 8px; padding: 8px; }
  .bar button { font: inherit; font-weight: 600; padding: 9px 18px; border-radius: 10px; border: 0; background: #C1272D; color: #FFFFFF; cursor: pointer; box-shadow: 0 4px 12px rgba(193, 39, 45, .3); }
  header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #C1272D; padding-bottom: 12px; }
  .shop { display: flex; gap: 12px; align-items: flex-start; }
  .shop .logo { flex: none; }
  .shop .logo svg { display: block; }
  .shop h1 { margin: 0; font-size: 22px; letter-spacing: -.01em; }
  .shop .mr { font-size: 16px; font-weight: 600; }
  .muted, .alt { color: #4B5563; }
  .alt { font-size: 11px; }
  .title { text-align: right; flex: none; white-space: nowrap; }
  .title h2 { margin: 0 0 6px; font-size: 18px; letter-spacing: .02em; color: #B0232A; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
  .box { border: 1px solid #E5E7EB; border-radius: 10px; padding: 8px 12px; background: #FCFCFD; }
  .box h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: #4B5563; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #FDECEC; color: #7F1D1D; text-align: left; font-size: 10.5px; padding: 6px; border: 1px solid #F3C4C6; }
  td { padding: 6px; border: 1px solid #E5E7EB; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .totals { display: grid; grid-template-columns: 1fr 260px; gap: 16px; margin-top: 12px; }
  .totals table td { border: 0; padding: 3px 0; }
  .grand td { font-size: 16px; font-weight: 800; border-top: 2px solid #C1272D !important; padding-top: 6px !important; color: #8E1C22; }
  .words { margin-top: 10px; }
  footer { display: grid; grid-template-columns: 1fr 200px; gap: 16px; margin-top: 18px; align-items: end; }
  .sign { text-align: center; border-top: 1px solid #111827; padding-top: 6px; margin-top: 46px; }
  .stamp { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-18deg); font-size: 56px; font-weight: 900; color: rgba(220, 38, 38, .14); white-space: nowrap; pointer-events: none; }
  .qr { width: 110px; height: 110px; }
  .qr svg { width: 100%; height: 100%; }
  @media print { .bar { display: none; } .page { padding: 0; } }
</style>
</head>
<body>
<div class="bar"><button onclick="window.print()"><?= e($L('print')) ?></button></div>
<div class="page">
  <?php if ($inv['status'] === 'draft'): ?><div class="stamp"><?= e($L('draft')) ?></div><?php endif; ?>
  <?php if ($inv['status'] === 'cancelled'): ?><div class="stamp"><?= e($L('cancelled')) ?></div><?php endif; ?>
  <header>
    <div class="shop">
      <div class="logo"><?= logo_svg('color', 60) ?></div>
      <div>
      <h1><?= e($shopEn) ?></h1>
      <?php if ($shopMr): ?><div class="mr"><?= e($shopMr) ?></div><?php endif; ?>
      <div><?= nl2br(e($s['shop_address'])) ?></div>
      <?php if ($s['shop_address_mr']): ?><div class="alt"><?= nl2br(e($s['shop_address_mr'])) ?></div><?php endif; ?>
      <div><?= e(implode(' · ', array_filter([$s['shop_phone'], $s['shop_email']]))) ?></div>
      <?php if ($reg): ?><div><strong>GSTIN:</strong> <?= e($s['shop_gstin'] ?: '—') ?> · <?= e($s['shop_state_name']) ?> (<?= e($shopState) ?>)</div><?php endif; ?>
      </div>
    </div>
    <div class="title">
      <h2><?= e($L($reg ? 'tax_invoice' : 'bill_title')) ?></h2>
      <div><?= e($L('invoice_no')) ?>: <strong><?= e($inv['invoice_no'] ?: '—') ?></strong></div>
      <div><?= e($L('date')) ?>: <?= e(fmt_date($inv['invoice_date'] ?: $inv['created_at'])) ?></div>
      <?php if ($inv['job_no']): ?><div><?= e($L('job_no')) ?>: <?= e($inv['job_no']) ?></div><?php endif; ?>
    </div>
  </header>

  <div class="meta">
    <div class="box">
      <h3><?= e($L('bill_to')) ?></h3>
      <div><strong><?= e($name) ?></strong></div>
      <?php if ($phone): ?><div><?= e($L('phone')) ?>: <?= e($phone) ?></div><?php endif; ?>
      <?php if ($gstin): ?><div>GSTIN: <?= e($gstin) ?></div><?php endif; ?>
      <div><?= e($L('state')) ?>: <?= e(GST_STATES[$custState] ?? '') ?> (<?= e($custState) ?>)</div>
    </div>
    <?php if ($inv['reg_no']): ?>
    <div class="box">
        <h3><?= e($L('bike')) ?></h3>
        <div><strong><?= e($inv['reg_no']) ?></strong> <?= e(trim(($inv['make'] ?? '') . ' ' . ($inv['model'] ?? ''))) ?></div>
        <?php if ($inv['odometer']): ?><div><?= e($L('odometer')) ?>: <?= e((string) $inv['odometer']) ?> km</div><?php endif; ?>
        <?php if ($inv['next_service'] && $inv['status'] !== 'cancelled'): ?><div><strong><?= e($L('next_service')) ?>:</strong> <?= e(next_service_text($inv['next_service'], $lang)) ?><?php if ($lang !== 'en'): ?> <span class="alt">(<?= e(next_service_text($inv['next_service'], 'en')) ?>)</span><?php endif; ?></div><?php endif; ?>
    </div>
    <?php endif; ?>
  </div>

  <table>
    <thead><tr>
      <th><?= e($L('sr')) ?></th><th><?= e($L('description')) ?></th><?php if ($reg): ?><th><?= e($L('hsn')) ?></th><?php endif; ?>
      <th class="n"><?= e($L('qty')) ?></th><th class="n"><?= e($L('mrp')) ?></th><th class="n"><?= e($L('disc')) ?></th><th class="n"><?= e($L('rate')) ?></th>
      <?php if ($reg): ?><th class="n"><?= e($L('taxable')) ?></th><th class="n"><?= e($L('gst')) ?></th><th class="n"><?= e($L('gst_amt')) ?></th><?php endif; ?><th class="n"><?= e($L('amount')) ?></th>
    </tr></thead>
    <tbody>
    <?php foreach ($inv['items'] as $i => $it): ?>
      <tr>
        <td><?= $i + 1 ?></td>
        <td><?= $desc($it) ?><?php if (!empty($it['part_no'])): ?><div class="alt"><?= e($L('part_no')) ?>: <?= e($it['part_no']) ?></div><?php endif; ?></td>
        <?php if ($reg): ?><td><?= e($it['hsn'] ?? '') ?></td><?php endif; ?>
        <td class="n"><?= e(fmt_qty((float) $it['qty'])) ?></td>
        <td class="n"><?= $it['item_type'] === 'part' ? $num($it['unit_price']) : '' ?></td>
        <td class="n"><?= (float) $it['disc_pct'] ? e(fmt_qty((float) $it['disc_pct'])) : '' ?><?= (float) $it['disc_amount'] && !(float) $it['disc_pct'] ? $num($it['disc_amount']) : '' ?></td>
        <td class="n"><?= $num($it['rate']) ?></td>
        <?php if ($reg): ?>
        <td class="n"><?= $num($it['taxable']) ?></td>
        <td class="n"><?= e(fmt_qty((float) $it['gst_rate'])) ?>%</td>
        <td class="n"><?= $num($it['tax_amount']) ?></td>
        <?php endif; ?>
        <td class="n"><?= $num($it['line_total']) ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>

  <div class="totals">
    <div>
      <?php if ($reg): ?>
      <table>
        <thead><tr><th><?= e($L('gst')) ?></th><th class="n"><?= e($L('taxable')) ?></th>
          <?php if ($inter): ?><th class="n"><?= e($L('igst')) ?></th><?php else: ?><th class="n"><?= e($L('cgst')) ?></th><th class="n"><?= e($L('sgst')) ?></th><?php endif; ?>
          <th class="n"><?= e($L('total_tax')) ?></th></tr></thead>
        <tbody>
        <?php foreach ($byRate as $r): ?>
          <tr><td><?= e(fmt_qty((float) $r['gst_rate'])) ?>%</td><td class="n"><?= $num($r['taxable']) ?></td>
            <?php if ($inter): ?><td class="n"><?= $num($r['igst']) ?></td><?php else: ?><td class="n"><?= $num($r['cgst']) ?></td><td class="n"><?= $num($r['sgst']) ?></td><?php endif; ?>
            <td class="n"><?= $num($r['tax']) ?></td></tr>
        <?php endforeach; ?>
        </tbody>
      </table>
      <?php else: ?>
      <p><?= e($L('no_gst_note')) ?></p>
      <?php endif; ?>
      <div class="words">
        <strong><?= e($L('in_words')) ?>:</strong>
        <div><?= e(amount_words_en((float) $inv['grand_total'])) ?></div>
        <div><?= e(amount_words_mr((float) $inv['grand_total'])) ?></div>
      </div>
    </div>
    <table>
      <?php if ($reg): ?><tr><td><?= e($L('taxable')) ?></td><td class="n"><?= $num($inv['taxable_total']) ?></td></tr><?php endif; ?>
      <?php if ((float) $inv['discount_total']): ?><tr><td><?= e($L('discount')) ?></td><td class="n">−<?= $num($inv['discount_total']) ?></td></tr><?php endif; ?>
      <?php if ($reg && $inter): ?>
        <tr><td><?= e($L('igst')) ?></td><td class="n"><?= $num($inv['igst']) ?></td></tr>
      <?php elseif ($reg): ?>
        <tr><td><?= e($L('cgst')) ?></td><td class="n"><?= $num($inv['cgst']) ?></td></tr>
        <tr><td><?= e($L('sgst')) ?></td><td class="n"><?= $num($inv['sgst']) ?></td></tr>
      <?php endif; ?>
      <tr><td><?= e($L('round_off')) ?></td><td class="n"><?= $num($inv['round_off']) ?></td></tr>
      <tr class="grand"><td><?= e($L('grand_total')) ?></td><td class="n">₹<?= $num($inv['grand_total']) ?></td></tr>
      <?php if ($inv['status'] === 'final'): ?>
        <tr><td><?= e($L('paid')) ?></td><td class="n"><?= $num($inv['paid_total']) ?></td></tr>
        <tr><td><strong><?= e($L('balance')) ?></strong></td><td class="n"><strong><?= $num($inv['balance']) ?></strong></td></tr>
      <?php endif; ?>
    </table>
  </div>

  <footer>
    <div>
      <strong><?= e($L('terms')) ?>:</strong>
      <div><?= nl2br(e($s['invoice_terms_en'])) ?></div>
      <div class="alt"><?= nl2br(e($s['invoice_terms_mr'])) ?></div>
      <p><?= e($L('thank_you')) ?></p>
      <?php if ($showQr): ?>
        <div style="display:flex;gap:10px;align-items:center"><div class="qr" data-upi="<?= e($upiUri) ?>"></div><div><strong><?= e($L('scan_to_pay')) ?></strong><div><?= e($upi) ?> · ₹<?= $num($inv['balance']) ?></div></div></div>
      <?php endif; ?>
    </div>
    <div>
      <div class="sign"><?= e(tr('inv.for_shop', $lang, ['shop' => $lang === 'mr' && $shopMr ? $shopMr : $shopEn])) ?><br><?= e($L('signature')) ?></div>
    </div>
  </footer>
</div>
<?php if ($showQr): ?>
<script><?= (string) @file_get_contents(WEB_ROOT . '/assets/vendor/qrcode/qrcode.js') ?></script>
<script>
  document.querySelectorAll('[data-upi]').forEach(function (el) {
    var q = qrcode(0, 'M'); q.addData(el.dataset.upi, 'Byte'); q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  });
</script>
<?php endif; ?>
</body>
</html>
