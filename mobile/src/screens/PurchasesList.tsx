import { router } from 'expo-router';
import { ChartColumn, Plus, ShoppingCart, Store, Truck } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { usePurchases } from '@/api/queries';
import { Button, Chip, EmptyState, Loading, OfflineBanner, Txt } from '@/components/ui';
import { date, money } from '@/format';
import { radius, space, useTheme } from '@/theme';

/** Inventory manager's Purchases tab: recent bills, quick links to suppliers and the reorder list. */
export default function PurchasesTab() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const list = usePurchases();

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={styles.actions}>
        <Button title={t('purchases.new')} icon={Plus} onPress={() => router.push('/purchase/new')} needsOnline />
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={t('nav.suppliers')} icon={Store} variant="secondary" small onPress={() => router.push('/suppliers')} style={{ flex: 1 }} />
          <Button title={t('nav.reorder')} icon={ShoppingCart} variant="secondary" small onPress={() => router.push('/reorder')} style={{ flex: 1 }} />
          <Button title={t('reports.title')} icon={ChartColumn} variant="secondary" small onPress={() => router.push('/reports')} style={{ flex: 1 }} />
        </View>
      </View>
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ padding: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} colors={[c.primary]} />}
          ListEmptyComponent={<EmptyState icon={Truck} title={t('purchases.empty_title')} text={t('purchases.empty_text')} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/purchase/${item.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="semibold" numberOfLines={1}>
                  {item.supplier_name}
                </Txt>
                <Txt size="sm" muted>
                  {item.bill_no} · {date(item.bill_date)} · {item.line_count} {t('purchases.line_count').toLowerCase()}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Txt weight="bold" tabular>
                  {money(item.total)}
                </Txt>
                <Chip label={t(`pay.${item.payment_mode}`)} tone={item.payment_mode === 'credit' ? 'warning' : 'success'} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { padding: space[4], gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderWidth: 1, borderRadius: radius.card },
});
