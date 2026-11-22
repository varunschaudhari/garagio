<?php
/**
 * Public estimate approval page (no login). Bilingual, customer's language first.
 * @var array $e estimate with items   @var array $j job   @var string $state ok|approved|expired|superseded
 * @var string $lang  @var string|null $flash
 */
$L = static fn (string $key) => bi("est.$key", $lang);
$shop = shop_full_name('en');
$shopMr = shop_full_name('mr');
$phone = setting('shop_phone');
$base = app_url() . '/e/' . rawurlencode($e['approval_token']);
$inclusive = setting('prices_include_gst') === '1';
$parts = array_filter($e['items'], static fn ($i) => $i['item_type'] === 'part');
$labour = array_filter($e['items'], static fn ($i) => $i['item_type'] === 'labour');
$desc = static function (array $i) use ($lang): string {
    $mr = $i['description_mr'] ?? '';
    $en = $i['description'];
    if (!$mr || $mr === $en) {
        return e($en);
    }
    return $lang === 'en' ? e($en) . '<br><span class="alt">' . e($mr) . '</span>' : e($mr) . '<br><span class="alt">' . e($en) . '</span>';
};
?><!doctype html>
<html lang="<?= e($lang) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?= e($e['est_no']) ?> · <?= e($shop) ?></title>
<style>
  :root { --bg:#F7F8FA; --surface:#fff; --border:#E5E7EB; --text:#111827; --muted:#6B7280; --primary:#C1272D; --ink:#FFFFFF; --ok:#166534; --okbg:#DCFCE7; --warn:#92400E; --warnbg:#FEF3C7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0F1115; --surface:#171A21; --border:#2A2F3A; --text:#F3F4F6; --muted:#9CA3AF; --primary:#D63339; --ok:#86EFAC; --okbg:rgba(74,222,128,.14); --warn:#FCD34D; --warnbg:rgba(251,191,36,.14); } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", "Noto Sans Devanagari", Roboto, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px; margin-bottom: 14px; }
  .shop { display: flex; gap: 12px; align-items: center; }
  .mark { width: 48px; height: 48px; border-radius: 12px; background: #fff; border: 1px solid var(--border); padding: 3px; display: grid; place-items: center; flex: none; }
  h1 { font-size: 20px; margin: 0; }
  .muted, .alt { color: var(--muted); font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 12px; color: var(--muted); font-weight: 600; padding: 6px 0; border-bottom: 1px solid var(--border); }
  td { padding: 10px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; padding-left: 8px; }
  .sub td { border: 0; padding: 4px 0; color: var(--muted); }
  .total td { border: 0; font-size: 20px; font-weight: 800; padding-top: 12px; }
  .btn { display: block; width: 100%; text-align: center; padding: 16px; border-radius: 12px; font: inherit; font-size: 18px; font-weight: 700; border: 0; cursor: pointer; text-decoration: none; margin-top: 10px; }
  .btn-primary { background: var(--primary); color: var(--ink); }
  .btn-secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
  .banner { padding: 14px; border-radius: 12px; font-weight: 600; margin-bottom: 14px; }
  .ok { background: var(--okbg); color: var(--ok); }
  .warn { background: var(--warnbg); color: var(--warn); }
</style>
</head>
<body>
<main>
  <div class="card shop">
    <div class="mark"><?= logo_svg('color', 40) ?></div>
    <div>
      <h1><?= e($lang === 'mr' && $shopMr ? $shopMr : $shop) ?></h1>
      <?php if ($phone): ?><div class="muted"><?= e($phone) ?></div><?php endif; ?>
    </div>
  </div>

  <?php if ($flash === 'approved_done'): ?>
    <div class="banner ok"><?= e($L('approved_done')) ?></div>
  <?php elseif ($flash === 'call_done'): ?>
    <div class="banner ok"><?= e($L('call_done')) ?></div>
  <?php elseif ($state === 'approved'): ?>
    <div class="banner ok"><?= e($L('already_approved')) ?></div>
  <?php elseif ($state === 'expired'): ?>
    <div class="banner warn"><?= e($L('expired')) ?></div>
  <?php elseif ($state === 'superseded'): ?>
    <div class="banner warn"><?= e($L('superseded')) ?></div>
  <?php endif; ?>

  <div class="card">
    <div class="muted"><?= e($L('title')) ?> · <?= e($e['est_no']) ?> · <?= e(fmt_date((string) ($e['sent_at'] ?: $e['created_at']))) ?></div>
    <h1 style="margin-top:4px"><?= e($j['reg_no']) ?></h1>
    <div class="muted"><?= e(trim($j['make'] . ' ' . $j['model'])) ?> · <?= e($j['customer_name']) ?></div>
  </div>

  <div class="card">
    <table>
      <thead><tr><th><?= e($L('item')) ?></th><th class="num"><?= e($L('qty')) ?></th><th class="num"><?= e($L('amount')) ?></th></tr></thead>
      <tbody>
      <?php foreach ([...$parts, ...$labour] as $i): ?>
        <tr>
          <td><?= $desc($i) ?></td>
          <td class="num"><?= e(fmt_qty((float) $i['qty'])) ?></td>
          <td class="num"><?= e(inr((float) $i['amount'])) ?></td>
        </tr>
      <?php endforeach; ?>
      <tr class="sub"><td colspan="2"><?= e($L('parts')) ?></td><td class="num"><?= e(inr((float) $e['parts_total'])) ?></td></tr>
      <tr class="sub"><td colspan="2"><?= e($L('labour')) ?></td><td class="num"><?= e(inr((float) $e['labour_total'])) ?></td></tr>
      <tr class="total"><td colspan="2"><?= e($L('total')) ?></td><td class="num"><?= e(inr((float) $e['grand_total'])) ?></td></tr>
      </tbody>
    </table>
    <div class="muted" style="margin-top:8px"><?= e($inclusive ? $L('gst_included') : $L('gst_extra')) ?></div>
    <?php if ($e['expires_at'] && $state === 'ok'): ?>
      <div class="muted"><?= e($L('valid_till')) ?>: <?= e(fmt_date((string) $e['expires_at'])) ?></div>
    <?php endif; ?>
  </div>

  <?php if ($state === 'ok' && $flash !== 'approved_done'): ?>
    <form method="post" action="<?= e($base) ?>/approve">
      <button class="btn btn-primary" type="submit"><?= e($L('approve')) ?></button>
    </form>
  <?php endif; ?>
  <?php if ($state !== 'approved' && $flash !== 'call_done' && $flash !== 'approved_done'): ?>
    <form method="post" action="<?= e($base) ?>/call">
      <button class="btn btn-secondary" type="submit"><?= e($L('call_me')) ?></button>
    </form>
  <?php endif; ?>
  <?php if ($phone): ?>
    <a class="btn btn-secondary" href="tel:<?= e(preg_replace('/[^0-9+]/', '', $phone)) ?>">📞 <?= e($phone) ?></a>
  <?php endif; ?>
</main>
</body>
</html>
