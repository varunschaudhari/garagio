import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ban, HandCoins, Pencil } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useCancelPurchase, usePurchase } from '@/api/queries';
import { SupplierPaymentSheet } from '@/components/pickers';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Chip, Divider, Field, Loading, OfflineBanner, Txt } from '@/components/ui';
import { date, datetime, money, qty } from '@/format';
import { nm } from '@/i18n';
import { space, useTheme } from '@/theme';
import type { Supplier } from '@/types';

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'dangerText' | 'successText' }) {
  return (
    <View style={styles.row}>
      <Txt muted={!strong} weight={strong ? 'bold' : 'regular'}>
        {label}
      </Txt>
      <Txt tabular weight={strong ? 'bold' : 'semibold'} color={tone}>
        {value}
      </Txt>
    </View>
  );
}

export default function PurchaseView() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePurchase(Number(id));
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useCancelPurchase(Number(id));
  const supplier = useQuery({
    queryKey: ['supplier', p.data?.supplier_id],
    queryFn: () => api.get<{ item: Supplier }>(`/suppliers/${p.data!.supplier_id}`).then((r) => r.item),
    enabled: !!p.data,
  });

  if (p.isPending) return <Loading />;
  if (!p.data) return null;
  const b = p.data;
  const cancelled = b.status === 'cancelled';
  const due = cancelled ? 0 : Math.max(0, Math.round((b.total - b.paid) * 100) / 100);
  const inter = Number(b.is_interstate) === 1;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Stack.Screen options={{ title: `${t('purchases.bill')} ${b.bill_no}` }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={p.isRefetching} onRefresh={() => void p.refetch()} colors={[c.primary]} />}
      >
        <Card style={{ gap: space[2] }}>
          <Txt size="lg" weight="bold" onPress={() => router.push(`/supplier/${b.supplier_id}`)} color="primaryText">
            {b.supplier_name}
          </Txt>
          <Txt muted>
            {b.bill_no} · {date(b.bill_date)}
          </Txt>
          {cancelled ? <Chip label={t('purchases.cancelled')} tone="danger" /> : <Chip label={t(`pay.${b.payment_mode}`)} tone={b.payment_mode === 'credit' ? 'warning' : 'success'} />}
        </Card>
        {cancelled ? <Banner tone="danger" text={t('purchases.cancelled_by', { date: datetime(b.cancelled_at ?? ''), name: b.cancelled_by_name ?? '—', reason: b.cancel_reason ?? '' })} /> : null}
        {b.replaced_by_bill ? <Button title={t('purchases.replaced_by', { bill: b.replaced_by_bill.bill_no })} variant="secondary" small onPress={() => router.push(`/purchase/${b.replaced_by_bill!.id}`)} /> : null}
        {b.replaces_bill ? <Button title={t('purchases.replaces', { bill: b.replaces_bill.bill_no })} variant="ghost" small onPress={() => router.push(`/purchase/${b.replaces_bill!.id}`)} /> : null}

        <Card padded={false}>
          {b.items.map((it, i) => (
            <View key={it.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.item}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="semibold" numberOfLines={2}>
                    {nm(it)}
                  </Txt>
                  <Txt size="sm" muted>
                    {it.part_no} · {qty(it.qty)} {it.unit} × {money(it.price)}
                    {it.disc_pct ? ` − ${qty(it.disc_pct)}%` : ''} · GST {qty(it.gst_rate)}%
                  </Txt>
                </View>
                <Txt weight="bold" tabular>
                  {money(it.line_total)}
                </Txt>
              </View>
            </View>
          ))}
        </Card>

        <Card style={{ gap: space[2] }}>
          <Row label={t('purchases.taxable')} value={money(b.taxable_total)} />
          {inter ? (
            <Row label={t('purchases.igst')} value={money(b.igst)} />
          ) : (
            <>
              <Row label={t('purchases.cgst')} value={money(b.cgst)} />
              <Row label={t('purchases.sgst')} value={money(b.sgst)} />
            </>
          )}
          {b.other_charges ? <Row label={t('purchases.other_charges')} value={money(b.other_charges)} /> : null}
          <Row label={t('purchases.round_off')} value={money(b.round_off)} />
          <Divider />
          <Row label={t('purchases.total')} value={money(b.total)} strong />
          <Row label={t('purchases.paid')} value={money(b.paid)} />
          <Row label={t('purchases.due')} value={money(due)} strong tone={due > 0 ? 'dangerText' : 'successText'} />
        </Card>

        {b.payments.length ? (
          <Card style={{ gap: space[2] }}>
            <Txt weight="semibold">{t('purchases.payments')}</Txt>
            {b.payments.map((x) => (
              <Row key={x.id} label={`${date(x.paid_on)} · ${t(`pay.${x.mode}`)}${x.reference ? ' · ' + x.reference : ''}`} value={money(x.amount)} />
            ))}
          </Card>
        ) : null}

        {due > 0 && supplier.data ? <Button title={t('suppliers.record_payment')} icon={HandCoins} onPress={() => setPaying(true)} needsOnline /> : null}
        {!cancelled ? (
          <>
            <Button title={t('purchases.correct')} icon={Pencil} variant="secondary" onPress={() => router.push({ pathname: '/purchase/new', params: { replace: String(b.id) } })} needsOnline />
            <Button title={t('purchases.cancel')} icon={Ban} variant="ghost" onPress={() => { setReason(''); setCancelling(true); }} needsOnline />
          </>
        ) : null}
      </ScrollView>
      {paying && supplier.data ? <SupplierPaymentSheet supplier={supplier.data} purchaseId={b.id} amount={due} onClose={() => setPaying(false)} /> : null}
      {cancelling ? (
        <Sheet visible onClose={() => setCancelling(false)} title={t('purchases.cancel')}>
          <Txt muted>{t('purchases.cancel_note')}</Txt>
          <Field label={t('purchases.cancel_reason')} value={reason} onChangeText={setReason} autoFocus />
          <Button
            title={t('purchases.cancel')}
            variant="danger"
            loading={cancel.isPending}
            disabled={!reason.trim()}
            needsOnline
            onPress={() =>
              void cancel
                .mutateAsync(reason.trim())
                .then(() => {
                  setCancelling(false);
                  toast(t('purchases.cancelled_ok'));
                })
                .catch(toastError)
            }
          />
        </Sheet>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] },
});
