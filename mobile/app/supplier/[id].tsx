import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { HandCoins, Phone, Truck } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSupplierLedger } from '@/api/queries';
import { SupplierPaymentSheet } from '@/components/pickers';
import { Button, Card, Divider, Loading, OfflineBanner, Txt } from '@/components/ui';
import { date, money } from '@/format';
import { radius, space, useTheme } from '@/theme';

const TYPE_LABEL = { opening: 'suppliers.entry_opening', bill: 'suppliers.entry_bill', payment: 'suppliers.entry_payment' } as const;

export default function SupplierScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useSupplierLedger(Number(id));
  const [paying, setPaying] = useState(false);

  if (ledger.isPending) return <Loading />;
  if (!ledger.data) return null;
  const s = ledger.data.supplier;
  const entries = [...ledger.data.items].reverse(); // newest first on a phone

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: s.name }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={ledger.isRefetching} onRefresh={() => void ledger.refetch()} colors={[c.primary]} />}
      >
        <View style={[styles.balance, { backgroundColor: s.balance > 0 ? c.dangerSoft : c.successSoft }]}>
          <Txt size="sm" color={s.balance > 0 ? 'dangerText' : 'successText'}>
            {t('suppliers.balance')}
          </Txt>
          <Txt size="xxl" weight="bold" tabular color={s.balance > 0 ? 'dangerText' : 'successText'}>
            {money(s.balance)}
          </Txt>
          <Txt size="sm" muted>
            {s.gstin || s.state_code}
            {s.address ? ` · ${s.address}` : ''}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={t('suppliers.record_payment')} icon={HandCoins} onPress={() => setPaying(true)} needsOnline style={{ flex: 1 }} />
          {s.phone ? <Button title={t('common.phone')} icon={Phone} variant="secondary" onPress={() => void Linking.openURL(`tel:${s.phone}`)} /> : null}
        </View>
        <Button title={t('suppliers.new_purchase')} icon={Truck} variant="secondary" onPress={() => router.push({ pathname: '/purchase/new', params: { supplier: String(s.id) } })} needsOnline />

        <Card padded={false}>
          <Txt weight="semibold" style={{ padding: space[4] }}>
            {t('suppliers.ledger')}
          </Txt>
          {entries.map((e, i) => (
            <View key={`${e.type}-${i}`}>
              <Divider />
              <View style={styles.entry}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="semibold" color={e.type === 'bill' && e.ref_id ? 'primaryText' : 'text'} onPress={e.type === 'bill' && e.ref_id ? () => router.push(`/purchase/${e.ref_id}`) : undefined}>
                    {t(TYPE_LABEL[e.type])}
                    {e.ref ? ` · ${e.ref}` : ''}
                  </Txt>
                  <Txt size="sm" muted>
                    {date(e.date)}
                    {e.mode && e.type === 'payment' ? ` · ${t(`pay.${e.mode}`)}` : ''}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt weight="bold" tabular color={e.paid ? 'successText' : 'text'}>
                    {e.paid ? `− ${money(e.paid)}` : `+ ${money(e.bill)}`}
                  </Txt>
                  <Txt size="sm" muted tabular>
                    = {money(e.balance)}
                  </Txt>
                </View>
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>
      {paying ? <SupplierPaymentSheet supplier={s} onClose={() => setPaying(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  balance: { padding: space[4], borderRadius: radius.card, gap: 2 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
});
