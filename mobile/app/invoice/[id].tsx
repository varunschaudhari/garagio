import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ban, Bike, Check, FileText, HandCoins, MessageCircle, Printer, Trash2, Undo2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/api/client';
import { useBillingMutation, useInvoice } from '@/api/queries';
import { BillChip, emptyPayments, PaymentEntry, paymentsBody, printReceipt, shareInvoicePdf, type Payments } from '@/components/bills';
import { printReturn, ReturnSheet } from '@/components/returns';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Divider, Field, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { date, money, qty } from '@/format';
import { errorText } from '@/i18n';
import { useSession, can } from '@/store/session';
import { radius, size, space, useTheme } from '@/theme';
import type { Invoice, PayMode } from '@/types';

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'dangerText' | 'successText' }) {
  return (
    <View style={styles.kv}>
      <Txt muted={!strong} weight={strong ? 'bold' : 'regular'}>{label}</Txt>
      <Txt tabular weight={strong ? 'bold' : 'semibold'} color={tone}>{value}</Txt>
    </View>
  );
}

export default function InvoiceScreen() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invId = Number(id);
  const inv = useInvoice(invId);
  const user = useSession((s) => s.user);
  const lang = useSession((s) => s.lang);
  const owner = can(user, 'give_discount'); // discounts on the draft
  const canCancel = can(user, 'cancel_bills');
  const [pay, setPay] = useState<Payments>(emptyPayments());
  const [sheet, setSheet] = useState<'pay' | 'cancel' | null>(null);
  const [returning, setReturning] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Exclude<PayMode, 'credit'>>('cash');
  const [disc, setDisc] = useState<Record<string, string>>({});
  const [billDisc, setBillDisc] = useState<string | null>(null);

  const act = useBillingMutation((v: { method?: 'PUT' | 'DELETE'; path: string; body?: unknown }) =>
    v.method === 'PUT' ? api.put<{ item: Invoice }>(v.path, v.body) : v.method === 'DELETE' ? api.del(v.path) : api.post<{ item: Invoice }>(v.path, v.body ?? {})
  );
  const run = async (v: { method?: 'PUT' | 'DELETE'; path: string; body?: unknown }, ok?: string) => {
    try {
      const res = await act.mutateAsync(v);
      if (ok) toast(ok);
      setSheet(null);
      return res;
    } catch (e) {
      Alert.alert(t('common.confirm'), errorText(e));
      return null;
    }
  };

  if (inv.isPending) return <Loading />;
  if (!inv.data) return null;
  const i = inv.data;
  const draft = i.status === 'draft';
  const final = i.status === 'final';
  const inter = Number(i.is_interstate) === 1;
  const gstBill = Number(i.gst_registered ?? 1) === 1;
  const discKey = (it: Invoice['items'][number]) => (it.item_type === 'part' ? `part:${it.job_part_id}` : `labour:${it.job_labour_id}`);

  const saveDiscounts = () => {
    const body: Record<string, unknown> = { bill_disc_pct: Number((billDisc ?? String(i.bill_disc_pct)).replace(',', '.')) || 0 };
    if (i.inv_type === 'job') {
      body.discounts = Object.fromEntries(i.items.map((it) => [discKey(it), Number((disc[discKey(it)] ?? String(it.disc_pct)).replace(',', '.')) || 0]));
    } else {
      body.items = i.items.map((it, n) => ({ part_id: it.part_id, qty: it.qty, disc_pct: Number((disc['line:' + n] ?? String(it.disc_pct)).replace(',', '.')) || 0 }));
    }
    void run({ method: 'PUT', path: `/invoices/${invId}`, body }, t('common.saved')).then(() => { setDisc({}); setBillDisc(null); });
  };

  const whatsapp = async () => {
    try {
      const res = await api.post<{ url: string }>(`/invoices/${invId}/whatsapp`);
      await Linking.openURL(res.url);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: i.invoice_no ?? `${t('billing.draft')} #${i.id}` }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={inv.isRefetching} onRefresh={() => void inv.refetch()} colors={[c.primary]} />}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Txt size="lg" weight="bold" style={{ flex: 1 }}>{i.invoice_no ?? `${t('billing.draft')} #${i.id}`}</Txt>
            <BillChip inv={i} />
          </View>
          <Txt muted>
            {i.customer_name ?? i.cust_name ?? t('billing.walk_in')}
            {i.reg_no ? ` · ${i.reg_no} · ${i.job_no}` : ` · ${t('billing.counter')}`}
            {i.invoice_date ? ` · ${date(i.invoice_date)}` : ''}
          </Txt>
          {i.status === 'cancelled' ? <Banner tone="danger" text={`${t('billing.cancelled')}: ${i.cancel_reason ?? ''}`} /> : null}
        </Card>

        <Card padded={false}>
          {i.items.map((it, n) => (
            <View key={it.id}>
              {n > 0 ? <Divider /> : null}
              <View style={styles.line}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="semibold">{lang === 'mr' && it.description_mr ? it.description_mr : it.description_en}</Txt>
                  {it.part_no ? (
                    <Txt size="sm" weight="semibold">
                      {t('inv.part_no')}: {it.part_no}
                    </Txt>
                  ) : null}
                  <Txt size="sm" muted>{qty(it.qty)} × {money(it.unit_price)} · GST {qty(it.gst_rate)}%{Number(it.disc_pct) ? ` · −${qty(it.disc_pct)}%` : ''}</Txt>
                  {it.returned_qty ? <Txt size="sm" weight="semibold" color="warningText">{t('billing.returned_qty', { qty: qty(it.returned_qty) })}</Txt> : null}
                </View>
                {draft && owner ? (
                  <TextInput
                    value={disc[i.inv_type === 'job' ? discKey(it) : 'line:' + n] ?? (Number(it.disc_pct) ? String(it.disc_pct) : '')}
                    onChangeText={(v) => setDisc((d) => ({ ...d, [i.inv_type === 'job' ? discKey(it) : 'line:' + n]: v }))}
                    placeholder="%"
                    placeholderTextColor={c.muted}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t('billing.discount')}
                    style={[styles.disc, { color: c.text, borderColor: c.borderStrong, fontFamily: font('semibold') }]}
                  />
                ) : null}
                <Txt weight="bold" tabular>{money(it.line_total)}</Txt>
              </View>
            </View>
          ))}
        </Card>

        {draft && owner ? (
          <Card style={{ gap: space[2] }}>
            <Field label={t('billing.bill_discount')} value={billDisc ?? (Number(i.bill_disc_pct) ? String(i.bill_disc_pct) : '')} onChangeText={setBillDisc} keyboardType="decimal-pad" />
            <Button title={t('common.apply')} small variant="secondary" onPress={saveDiscounts} disabled={billDisc === null && !Object.keys(disc).length} needsOnline />
          </Card>
        ) : draft ? (
          <Txt size="sm" muted>{t('billing.owner_discount')}</Txt>
        ) : null}

        <Card style={{ gap: space[2] }}>
          {gstBill ? <Row label={t('inv.taxable')} value={money(i.taxable_total)} /> : null}
          {i.discount_total ? <Row label={t('inv.discount')} value={`−${money(i.discount_total)}`} /> : null}
          {!gstBill ? <Txt size="sm" muted>{t('inv.no_gst_note')}</Txt> : inter ? <Row label={t('inv.igst')} value={money(i.igst)} /> : (
            <>
              <Row label={t('inv.cgst')} value={money(i.cgst)} />
              <Row label={t('inv.sgst')} value={money(i.sgst)} />
            </>
          )}
          <Row label={t('inv.round_off')} value={money(i.round_off)} />
          <Divider />
          <View style={styles.kv}>
            <Txt size="lg" weight="bold">{t('inv.grand_total')}</Txt>
            <Txt size="xl" weight="bold" tabular>{money(i.grand_total)}</Txt>
          </View>
          {i.returned_total ? <Row label={t('billing.returned')} value={`−${money(i.returned_total)}`} /> : null}
          {final ? (
            <>
              <Row label={t('inv.paid')} value={money(i.paid_total)} />
              <Row label={t('inv.balance')} value={money(i.balance)} strong tone={i.balance > 0 ? 'dangerText' : 'successText'} />
            </>
          ) : null}
        </Card>

        {draft ? (
          <Card style={{ gap: space[3] }}>
            <PaymentEntry total={i.grand_total} value={pay} onChange={setPay} />
            <Txt size="xs" muted>
              {i.customer_id && i.is_trusted ? t('billing.trusted', { limit: Number(i.credit_limit) ? money(i.credit_limit) : '∞' }) : t('billing.not_trusted')} · {t('billing.credit_note')}
            </Txt>
            <Button title={t('billing.finalize')} icon={Check} loading={act.isPending} needsOnline onPress={async () => {
              const res = (await run({ path: `/invoices/${invId}/finalize`, body: { payments: paymentsBody(pay) } })) as { item: Invoice } | null;
              if (res?.item) toast(t('billing.finalized', { no: res.item.invoice_no }));
            }} />
            <Button title={t('billing.delete_draft')} icon={Trash2} variant="ghost" small onPress={() => Alert.alert(t('billing.delete_draft') + '?', '', [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.delete'), style: 'destructive', onPress: async () => { if (await run({ method: 'DELETE', path: `/invoices/${invId}` })) router.back(); } },
            ])} />
          </Card>
        ) : null}

        {final || draft ? <Button title={t('billing.print_receipt')} icon={Printer} variant={final ? 'primary' : 'secondary'} onPress={() => printReceipt(i, lang)} needsOnline /> : null}
        {final || draft ? <Button title={t('billing.share_pdf')} icon={FileText} variant="secondary" onPress={() => shareInvoicePdf(i, lang)} needsOnline /> : null}
        {final && (i.customer_phone || i.cust_phone) ? <Button title={t('billing.whatsapp')} icon={MessageCircle} variant="secondary" onPress={whatsapp} needsOnline /> : null}
        {final && i.balance > 0 ? <Button title={t('billing.record_payment')} icon={HandCoins} onPress={() => { setText(String(i.balance)); setSheet('pay'); }} needsOnline /> : null}
        {final && i.job_card_id && i.job_status === 'ready' ? (
          <Button title={t('billing.deliver')} icon={Bike} onPress={() => void run({ path: `/jobs/${i.job_card_id}/status`, body: { status: 'delivered' } }, t('billing.delivered_ok'))} needsOnline />
        ) : null}
        {final && canCancel ? <Button title={t('billing.return')} icon={Undo2} variant="secondary" onPress={() => setReturning(true)} needsOnline /> : null}
        {final && canCancel && !Number(i.returned_total) ? <Button title={t('billing.cancel')} icon={Ban} variant="ghost" onPress={() => { setText(''); setSheet('cancel'); }} needsOnline /> : null}

        {i.returns?.length ? (
          <Card style={{ gap: space[2] }}>
            <Txt weight="semibold">{t('billing.returns')}</Txt>
            {i.returns.map((r) => (
              <View key={r.id} style={[styles.kv, { gap: space[2] }]}>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold">{r.return_no} · −{money(r.total)}</Txt>
                  <Txt size="sm" muted>
                    {date(r.return_date)} · {r.reason}
                    {Number(r.refund_amount) ? ` · ${t('billing.refunded_amount', { amount: money(r.refund_amount) })}` : ''}
                  </Txt>
                </View>
                <Button title={t('billing.print_receipt')} icon={Printer} variant="ghost" small onPress={() => void printReturn(r.id, lang)} needsOnline />
              </View>
            ))}
          </Card>
        ) : null}

        {i.payments.length ? (
          <Card style={{ gap: space[2] }}>
            <Txt weight="semibold">{t('purchases.payments')}</Txt>
            {i.payments.map((p) => <Row key={p.id} label={`${date(p.received_on)} · ${t(`pay.${p.mode}`)}${p.reference ? ' · ' + p.reference : ''}`} value={money(p.amount)} />)}
          </Card>
        ) : null}
      </ScrollView>

      {returning ? <ReturnSheet inv={i} lang={lang} onClose={() => setReturning(false)} /> : null}
      {sheet ? (
        <Sheet visible onClose={() => setSheet(null)} title={sheet === 'pay' ? t('billing.record_payment') : t('billing.cancel')}>
          <Field label={sheet === 'pay' ? `${t('common.amount')} (₹)` : t('billing.cancel_reason')} value={text} onChangeText={setText} keyboardType={sheet === 'pay' ? 'decimal-pad' : 'default'} autoFocus />
          {sheet === 'pay' ? (
            <Segmented<Exclude<PayMode, 'credit'>> value={mode} onChange={setMode} options={(['cash', 'upi', 'card', 'bank'] as const).map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
          ) : null}
          <Button
            title={t('common.confirm')}
            loading={act.isPending}
            disabled={!text.trim()}
            needsOnline
            variant={sheet === 'cancel' ? 'danger' : 'primary'}
            onPress={() =>
              void (sheet === 'pay'
                ? run({ path: `/invoices/${invId}/payments`, body: { amount: Number(text.replace(',', '.')), mode } }, t('billing.payment_saved'))
                : run({ path: `/invoices/${invId}/cancel`, body: { reason: text.trim() } }, t('billing.cancelled_ok')))
            }
          />
        </Sheet>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] },
  disc: { width: 60, minHeight: 44, borderWidth: 1, borderRadius: radius.input, textAlign: 'center', fontSize: size.md },
});
