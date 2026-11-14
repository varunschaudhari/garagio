<?php
/**
 * Tax invoice as a thermal receipt (58 mm or 80 mm roll). Printed from a phone through the Android print
 * dialog (Bluetooth printer print service); the web app opens it in the phone's browser.
 * One language (the customer's) to fit the width; pure black, no greys - thermal heads cannot print shades.
 * @var array $inv invoice with items  @var array $byRate tax summary  @var string $lang  @var int $paper 58|80
 */
$L = static fn (string $key, array $vars = []) => tr("inv.$key", $lang, $vars);
$s = settings_all();
$shopName = $lang === 'mr' && $s['shop_name_mr'] ? $s['shop_name_mr'] : $s['shop_name'];
$shopAddr = $lang === 'mr' && $s['shop_address_mr'] ? $s['shop_address_mr'] : $s['shop_address'];
$terms = $lang === 'mr' && $s['invoice_terms_mr'] ? $s['invoice_terms_mr'] : $s['invoice_terms_en'];
$inter = (int) $inv['is_interstate'] === 1;
$shopState = $s['shop_state_code'];
$custState = $inv['cust_state_code'] ?: $shopState;
$name = $inv['customer_name'] ?: ($inv['cust_name'] ?: tr('inv.walk_in', $lang));
$phone = $inv['customer_phone'] ?: $inv['cust_phone'];
$num = static fn ($v) => number_format((float) $v, 2, '.', ',');
$upi = $s['upi_id'] ?? '';
$showQr = $upi && (float) $inv['balance'] > 0 && $inv['status'] === 'final';
$upiUri = $showQr ? 'upi://pay?pa=' . rawurlencode($upi) . '&pn=' . rawurlencode($s['shop_name']) . '&am=' . number_format((float) $inv['balance'], 2, '.', '') . '&cu=INR&tn=' . rawurlencode((string) $inv['invoice_no']) : '';
$itemName = static fn (array $it) => $lang === 'mr' && !empty($it['description_mr']) ? $it['description_mr'] : $it['description_en'];
// Printable width: 58 mm paper prints about 48 mm, 80 mm paper about 72 mm.
$width = $paper === 80 ? 72 : 48;
$font = $paper === 80 ? 13 : 11;
?><!doctype html>
<html lang="<?= e($lang) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($inv['invoice_no'] ?: 'Draft') ?> · <?= e($s['shop_name']) ?></title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body { font: <?= $font ?>px/1.3 "Noto Sans Devanagari", "Inter", system-ui, Roboto, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .r { width: <?= $width ?>mm; margin: 0 auto; padding: 2mm 0 6mm; }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .big { font-size: 1.35em; font-weight: 800; }
  .sm { font-size: .88em; }
  .hr { border-top: 1px dashed #000; margin: 4px 0; }
  .hr2 { border-top: 2px solid #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .row > :last-child { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .item { margin: 3px 0; }
  .stamp { border: 2px solid #000; text-align: center; font-weight: 800; padding: 2px; margin: 4px 0; letter-spacing: .1em; }
  .qr { width: 32mm; height: 32mm; margin: 4px auto 0; }
  .qr svg { width: 100%; height: 100%; }
  .bar { position: sticky; top: 0; display: flex; justify-content: center; padding: 8px; background: #F3F4F6; }
  .bar button { font: 600 16px system-ui, sans-serif; padding: 10px 28px; border-radius: 8px; border: 0; background: #F97316; color: #111827; }
  @media print { .bar { display: none; } }
</style>
</head>
<body>
<div class="bar"><button onclick="window.print()"><?= e($L('print')) ?></button></div>
<div class="r">
  <div class="c big"><?= e($shopName) ?></div>
  <?php if ($shopAddr): ?><div class="c sm"><?= nl2br(e($shopAddr)) ?></div><?php endif; ?>
  <?php if ($s['shop_phone']): ?><div class="c sm"><?= e($L('phone')) ?>: <?= e($s['shop_phone']) ?></div><?php endif; ?>
  <?php if ($s['shop_gstin']): ?><div class="c sm b">GSTIN: <?= e($s['shop_gstin']) ?></div><?php endif; ?>
  <div class="hr2"></div>
  <div class="c b"><?= e($L('tax_invoice')) ?></div>
  <?php if ($inv['status'] === 'draft'): ?><div class="stamp"><?= e($L('draft')) ?></div><?php endif; ?>
  <?php if ($inv['status'] === 'cancelled'): ?><div class="stamp"><?= e($L('cancelled')) ?></div><?php endif; ?>
  <div class="row"><span><?= e($L('invoice_no')) ?></span><span class="b"><?= e($inv['invoice_no'] ?: '—') ?></span></div>
  <div class="row"><span><?= e($L('date')) ?></span><span><?= e(fmt_date($inv['invoice_date'] ?: $inv['created_at'])) ?></span></div>
  <?php if ($inv['job_no']): ?><div class="row"><span><?= e($L('job_no')) ?></span><span><?= e($inv['job_no']) ?></span></div><?php endif; ?>
  <div class="hr"></div>
  <div><?= e($L('bill_to')) ?>: <span class="b"><?= e($name) ?></span></div>
  <?php if ($phone): ?><div class="sm"><?= e($L('phone')) ?>: <?= e($phone) ?></div><?php endif; ?>
  <?php if ($inv['cust_gstin']): ?><div class="sm">GSTIN: <?= e($inv['cust_gstin']) ?></div><?php endif; ?>
  <?php if ($custState !== $shopState): ?><div class="sm"><?= e($L('state')) ?>: <?= e(GST_STATES[$custState] ?? '') ?> (<?= e($custState) ?>)</div><?php endif; ?>
  <?php if ($inv['reg_no']): ?><div class="sm"><?= e($L('bike')) ?>: <span class="b"><?= e($inv['reg_no']) ?></span><?= $inv['odometer'] ? ' · ' . e((string) $inv['odometer']) . ' km' : '' ?></div><?php endif; ?>
  <div class="hr"></div>

  <?php foreach ($inv['items'] as $it): ?>
    <div class="item">
      <div class="b"><?= e($itemName($it)) ?></div>
      <div class="row">
        <span><?= e(fmt_qty((float) $it['qty'])) ?> × <?= $num($it['unit_price']) ?><?= (float) $it['disc_pct'] ? ' −' . e(fmt_qty((float) $it['disc_pct'])) . '%' : '' ?></span>
        <span><?= $num($it['line_total']) ?></span>
      </div>
      <div class="sm"><?= $it['hsn'] ? e($L('hsn')) . ' ' . e($it['hsn']) . ' · ' : '' ?>GST <?= e(fmt_qty((float) $it['gst_rate'])) ?>%</div>
    </div>
  <?php endforeach; ?>

  <div class="hr"></div>
  <?php if ((float) $inv['discount_total']): ?><div class="row"><span><?= e($L('discount')) ?></span><span>−<?= $num($inv['discount_total']) ?></span></div><?php endif; ?>
  <div class="row"><span><?= e($L('taxable')) ?></span><span><?= $num($inv['taxable_total']) ?></span></div>
  <?php if ($inter): ?>
    <div class="row"><span><?= e($L('igst')) ?></span><span><?= $num($inv['igst']) ?></span></div>
  <?php else: ?>
    <div class="row"><span><?= e($L('cgst')) ?></span><span><?= $num($inv['cgst']) ?></span></div>
    <div class="row"><span><?= e($L('sgst')) ?></span><span><?= $num($inv['sgst']) ?></span></div>
  <?php endif; ?>
  <?php if ((float) $inv['round_off']): ?><div class="row"><span><?= e($L('round_off')) ?></span><span><?= $num($inv['round_off']) ?></span></div><?php endif; ?>
  <div class="hr2"></div>
  <div class="row big"><span><?= e($L('grand_total')) ?></span><span>₹<?= $num($inv['grand_total']) ?></span></div>
  <?php if ($inv['status'] === 'final'): ?>
    <div class="row"><span><?= e($L('paid')) ?></span><span><?= $num($inv['paid_total']) ?></span></div>
    <?php if ((float) $inv['balance'] > 0): ?><div class="row b"><span><?= e($L('balance')) ?></span><span><?= $num($inv['balance']) ?></span></div><?php endif; ?>
  <?php endif; ?>
  <div class="sm"><?= e($lang === 'mr' ? amount_words_mr((float) $inv['grand_total']) : amount_words_en((float) $inv['grand_total'])) ?></div>

  <?php if (count($byRate) > 1 || $inter): ?>
    <div class="hr"></div>
    <div class="sm b"><?= e($L('tax_summary')) ?></div>
    <?php foreach ($byRate as $r): ?>
      <div class="row sm"><span><?= e(fmt_qty((float) $r['gst_rate'])) ?>% · <?= $num($r['taxable']) ?></span><span><?= $inter ? e($L('igst')) . ' ' . $num($r['igst']) : e($L('cgst')) . ' ' . $num($r['cgst']) . ' + ' . e($L('sgst')) . ' ' . $num($r['sgst']) ?></span></div>
    <?php endforeach; ?>
  <?php endif; ?>

  <?php if ($showQr): ?>
    <div class="hr"></div>
    <div class="c b"><?= e($L('scan_to_pay')) ?> · ₹<?= $num($inv['balance']) ?></div>
    <div class="qr" data-upi="<?= e($upiUri) ?>"></div>
    <div class="c sm"><?= e($upi) ?></div>
  <?php endif; ?>

  <div class="hr"></div>
  <?php if ($terms): ?><div class="sm"><?= nl2br(e($terms)) ?></div><?php endif; ?>
  <div class="c b" style="margin-top:4px"><?= e($L('thank_you')) ?></div>
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
