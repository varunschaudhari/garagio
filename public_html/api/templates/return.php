<?php
/**
 * Return (credit) note as a thermal receipt (58 / 80 mm), like receipt.php. Against a GST bill it is a
 * credit note with the tax reversed; against a plain bill it is a return note without tax lines.
 * @var array $ret return with items  @var string $lang  @var int $paper 58|80
 */
$L = static fn (string $key, array $vars = []) => tr("inv.$key", $lang, $vars);
$s = settings_all();
$shopName = $lang === 'mr' && $s['shop_name_mr'] ? $s['shop_name_mr'] : $s['shop_name'];
$shopAddr = $lang === 'mr' && $s['shop_address_mr'] ? $s['shop_address_mr'] : $s['shop_address'];
$reg = (int) $ret['gst_registered'] === 1;
$inter = (int) $ret['is_interstate'] === 1;
$name = $ret['customer_name'] ?: ($ret['cust_name'] ?: tr('inv.walk_in', $lang));
$phone = $ret['customer_phone'] ?: $ret['cust_phone'];
$num = static fn ($v) => number_format((float) $v, 2, '.', ',');
$itemName = static fn (array $it) => $lang === 'mr' && !empty($it['description_mr']) ? $it['description_mr'] : $it['description_en'];
$width = $paper === 80 ? 72 : 48;
$font = $paper === 80 ? 13 : 11;
?><!doctype html>
<html lang="<?= e($lang) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($ret['return_no']) ?> · <?= e($s['shop_name']) ?></title>
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
  <?php if ($reg && $s['shop_gstin']): ?><div class="c sm b">GSTIN: <?= e($s['shop_gstin']) ?></div><?php endif; ?>
  <div class="hr2"></div>
  <div class="c b"><?= e($L($reg ? 'credit_note' : 'return_note')) ?></div>
  <div class="row"><span><?= e($L('return_no')) ?></span><span class="b"><?= e($ret['return_no']) ?></span></div>
  <div class="row"><span><?= e($L('date')) ?></span><span><?= e(fmt_date($ret['return_date'])) ?></span></div>
  <div class="row"><span><?= e($L('against_bill')) ?></span><span><?= e($ret['invoice_no']) ?> · <?= e(fmt_date($ret['invoice_date'])) ?></span></div>
  <div class="hr"></div>
  <div><?= e($L('bill_to')) ?>: <span class="b"><?= e($name) ?></span></div>
  <?php if ($phone): ?><div class="sm"><?= e($L('phone')) ?>: <?= e($phone) ?></div><?php endif; ?>
  <?php if ($ret['cust_gstin']): ?><div class="sm">GSTIN: <?= e($ret['cust_gstin']) ?></div><?php endif; ?>
  <div class="hr"></div>

  <?php foreach ($ret['items'] as $it): ?>
    <div class="item">
      <div class="b"><?= e($itemName($it)) ?></div>
      <?php if (!empty($it['part_no'])): ?><div class="sm"><?= e($L('part_no')) ?>: <?= e($it['part_no']) ?></div><?php endif; ?>
      <div class="row"><span><?= e(fmt_qty((float) $it['qty'])) ?> × <?= $num($it['rate']) ?></span><span><?= $num($it['line_total']) ?></span></div>
      <?php if ($reg): ?><div class="sm"><?= $it['hsn'] ? e($L('hsn')) . ' ' . e($it['hsn']) . ' · ' : '' ?>GST <?= e(fmt_qty((float) $it['gst_rate'])) ?>%</div><?php endif; ?>
    </div>
  <?php endforeach; ?>

  <div class="hr"></div>
  <?php if ($reg): ?>
    <div class="row"><span><?= e($L('taxable')) ?></span><span><?= $num($ret['taxable_total']) ?></span></div>
    <?php if ($inter): ?>
      <div class="row"><span><?= e($L('igst')) ?></span><span><?= $num($ret['igst']) ?></span></div>
    <?php else: ?>
      <div class="row"><span><?= e($L('cgst')) ?></span><span><?= $num($ret['cgst']) ?></span></div>
      <div class="row"><span><?= e($L('sgst')) ?></span><span><?= $num($ret['sgst']) ?></span></div>
    <?php endif; ?>
  <?php endif; ?>
  <?php if ((float) $ret['round_off']): ?><div class="row"><span><?= e($L('round_off')) ?></span><span><?= $num($ret['round_off']) ?></span></div><?php endif; ?>
  <div class="hr2"></div>
  <div class="row big"><span><?= e($L('return_total')) ?></span><span>₹<?= $num($ret['total']) ?></span></div>
  <?php if ((float) $ret['refund_amount'] > 0): ?>
    <div class="row b"><span><?= e($L('refunded')) ?> (<?= e(tr('pay.' . $ret['refund_mode'], $lang)) ?>)</span><span><?= $num($ret['refund_amount']) ?></span></div>
  <?php endif; ?>
  <div class="sm"><?= e($lang === 'mr' ? amount_words_mr((float) $ret['total']) : amount_words_en((float) $ret['total'])) ?></div>
  <div class="hr"></div>
  <div class="sm"><?= e($L('return_reason')) ?>: <?= e($ret['reason']) ?></div>
  <?php if (!$reg): ?><div class="sm" style="margin-top:3px"><?= e($L('no_gst_note')) ?></div><?php endif; ?>
  <div class="c b" style="margin-top:6px"><?= e($L('for_shop', ['shop' => $s['shop_name']])) ?></div>
</div>
</body>
</html>
