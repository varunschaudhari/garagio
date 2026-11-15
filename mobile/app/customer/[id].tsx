import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Bike, HandCoins, MessageCircle, Phone, Plus } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useBillingMutation, useCustomer, useCustomerLedger } from '@/api/queries';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Button, Card, Chip, Divider, Field, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { StatusChip } from '@/components/work';
import { date, money } from '@/format';
import { radius, space, useTheme } from '@/theme';
import type { PayMode } from '@/types';

export default function CustomerScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cust = useCustomer(Number(id));
  const ledger = useCustomerLedger(Number(id));
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<Exclude<PayMode, 'credit'>>('cash');
  const pay = useBillingMutation((body: unknown) => api.post<{ allocations: unknown[]; unallocated: number }>(`/customers/${id}/payments`, body));
  if (cust.isPending) return <Loading />;
  if (!cust.data) return null;
  const x = cust.data;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: x.name }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={cust.isRefetching} onRefresh={() => void cust.refetch()} colors={[c.primary]} />}
      >
        <Card style={{ gap: space[2] }}>
          <Txt size="xl" weight="bold">
            {x.name}
          </Txt>
          <Txt muted>
            {x.phone} · {x.language === 'mr' ? 'मराठी' : 'English'}
          </Txt>
          {x.is_trusted ? <Chip label={t('customers.trusted')} tone="success" /> : null}
          <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[2] }}>
            <Button title={t('jobs.call')} icon={Phone} variant="secondary" small onPress={() => void Linking.openURL(`tel:${x.phone}`)} style={{ flex: 1 }} />
            <Button title="WhatsApp" icon={MessageCircle} variant="secondary" small onPress={() => void Linking.openURL(`https://wa.me/91${x.phone}`)} style={{ flex: 1 }} />
          </View>
        </Card>
        <View style={[styles.balance, { backgroundColor: x.balance > 0 ? c.dangerSoft : c.successSoft }]}>
          <Txt size="sm" color={x.balance > 0 ? 'dangerText' : 'successText'}>
            {t('customers.balance')}
          </Txt>
          <Txt size="xl" weight="bold" tabular color={x.balance > 0 ? 'dangerText' : 'successText'}>
            {money(x.balance)}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={t('billing.record_payment')} icon={HandCoins} variant="secondary" onPress={() => { setAmount(x.balance > 0 ? String(x.balance) : ''); setPaying(true); }} needsOnline style={{ flex: 1 }} />
          <Button title={t('jobs.new')} icon={Plus} onPress={() => router.push({ pathname: '/newjob', params: { customer: String(x.id) } })} needsOnline style={{ flex: 1 }} />
        </View>

        {ledger.data?.items.length ? (
          <Card padded={false}>
            <Txt weight="semibold" style={{ padding: space[4] }}>{t('billing.ledger')}</Txt>
            {[...ledger.data.items].reverse().map((e, n) => (
              <View key={n}>
                <Divider />
                <Pressable disabled={!e.ref_id || e.type === 'payment'} onPress={() => router.push(`/invoice/${e.ref_id}`)} style={styles.line}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold">{t(`billing.entry_${e.type}`)}{e.ref ? ` · ${e.ref}` : ''}</Txt>
                    <Txt size="sm" muted>{date(e.date)}{e.mode ? ` · ${t(`pay.${e.mode}`)}` : ''}</Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt weight="bold" tabular color={e.credit ? 'successText' : 'text'}>{e.credit ? `− ${money(e.credit)}` : `+ ${money(e.debit)}`}</Txt>
                    <Txt size="sm" muted tabular>= {money(e.balance)}</Txt>
                  </View>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        <Card padded={false}>
          <Txt weight="semibold" style={{ padding: space[4] }}>
            {t('customers.bikes')}
          </Txt>
          {x.vehicles.map((v) => (
            <View key={v.id}>
              <Divider />
              <View style={styles.line}>
                <Bike size={20} color={c.muted} />
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold">{v.reg_no}</Txt>
                  <Txt size="sm" muted>
                    {[v.make, v.model, v.year].filter(Boolean).join(' · ')}
                    {v.last_odometer ? ` · ${v.last_odometer} km` : ''}
                  </Txt>
                </View>
              </View>
            </View>
          ))}
        </Card>

        <Card padded={false}>
          <Txt weight="semibold" style={{ padding: space[4] }}>
            {t('customers.history')}
          </Txt>
          {(x.jobs ?? []).map((j) => (
            <View key={j.id}>
              <Divider />
              <Pressable onPress={() => router.push(`/job/${j.id}`)} style={({ pressed }) => [styles.line, pressed && { backgroundColor: c.surface2 }]} accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold">
                    {j.job_no} · {j.reg_no}
                  </Txt>
                  <Txt size="sm" muted>
                    {date(j.created_at)}
                    {j.invoice_total ? ` · ${money(j.invoice_total)}` : ''}
                  </Txt>
                </View>
                <StatusChip status={j.status} />
              </Pressable>
            </View>
          ))}
        </Card>
      </ScrollView>
      {paying ? (
        <Sheet visible onClose={() => setPaying(false)} title={`${t('billing.record_payment')} · ${x.name}`}>
          <Field label={`${t('common.amount')} (₹)`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus />
          <Segmented<Exclude<PayMode, 'credit'>> value={mode} onChange={setMode} options={(['cash', 'upi', 'card', 'bank'] as const).map((md) => ({ value: md, label: t(`pay.${md}`) }))} />
          <Button
            title={t('common.confirm')}
            loading={pay.isPending}
            disabled={!(Number(amount.replace(',', '.')) > 0)}
            needsOnline
            onPress={async () => {
              try {
                const res = await pay.mutateAsync({ amount: Number(amount.replace(',', '.')), mode });
                toast(t('billing.payment_saved') + (res.allocations.length ? ' · ' + t('billing.allocated', { n: res.allocations.length }) : ''));
                setPaying(false);
              } catch (e) {
                toastError(e);
              }
            }}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  balance: { padding: space[4], borderRadius: radius.card, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
});
