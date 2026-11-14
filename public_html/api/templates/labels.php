<?php
/** @var array $labels list of ['code','title','line2','line3','price'] */
$qrLib = (string) @file_get_contents(WEB_ROOT . '/assets/vendor/qrcode/qrcode.js');
$shop = setting('shop_name');
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QR labels · <?= e($shop) ?></title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Inter", "Noto Sans Devanagari", system-ui, sans-serif; color: #111827; background: #fff; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; padding: 12px 16px; background: #F7F8FA; border-bottom: 1px solid #E5E7EB; font-size: 14px; }
  .bar button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 0; background: #F97316; color: #fff; cursor: pointer; }
  .sheet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; padding: 8px; }
  .label { border: 1px dashed #D1D5DB; padding: 6px; display: flex; gap: 6px; align-items: center; height: 30mm; overflow: hidden; break-inside: avoid; }
  .qr { width: 24mm; height: 24mm; flex: none; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .txt { min-width: 0; font-size: 9pt; line-height: 1.25; }
  .t1 { font-weight: 700; font-size: 10pt; word-break: break-all; }
  .t2, .t3 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t4 { color: #6B7280; font-size: 8pt; }
  .empty { padding: 48px; text-align: center; color: #6B7280; }
  @media print { .bar { display: none; } .sheet { padding: 0; } }
</style>
</head>
<body>
<div class="bar">
  <strong><?= e($shop) ?></strong>
  <span><?= count($labels) ?> labels</span>
  <span style="flex:1"></span>
  <button onclick="window.print()">Print</button>
</div>
<?php if (!$labels): ?>
  <div class="empty">No labels for this selection.</div>
<?php else: ?>
<div class="sheet">
  <?php foreach ($labels as $l): ?>
  <div class="label">
    <div class="qr" data-code="<?= e($l['code']) ?>"></div>
    <div class="txt">
      <div class="t1"><?= e($l['title']) ?></div>
      <div class="t2"><?= e($l['line2']) ?></div>
      <div class="t3"><?= e($l['line3']) ?></div>
      <div class="t4"><?= e($l['price']) ?></div>
    </div>
  </div>
  <?php endforeach; ?>
</div>
<?php endif; ?>
<script><?= $qrLib ?></script>
<script>
  document.querySelectorAll('.qr').forEach(function (el) {
    if (typeof qrcode !== 'function') { el.textContent = el.dataset.code; return; }
    var q = qrcode(0, 'M');
    q.addData(el.dataset.code, 'Byte');
    q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  });
</script>
</body>
</html>
