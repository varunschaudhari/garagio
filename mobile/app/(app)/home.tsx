import { router } from 'expo-router';
import { Bike, Boxes, Calendar, CircleCheck, HandCoins, IndianRupee, Inbox, Package, Receipt, ShieldCheck, Truck, TriangleExclamationPoint, Users, Warehouse } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useDashboard } from '@/api/queries';
import { Card, Chip, Loading, OfflineBanner, Txt } from '@/components/ui';
import { date, money, qty, rupees } from '@/format';
import { nm } from '@/i18n';
import { useSession, can } from '@/store/session';
import { radius, space, useTheme, type Colors } from '@/theme';

function Kpi({ label, value, sub, icon: Icon, tone, onPress }: { label: string; value: string | number; sub?: string; icon: LucideIcon; tone: 'primary' | 'success' | 'danger' | 'info'; onPress?: () => void }) {
  const { c } = useTheme();
  const tones: Record<string, [keyof Colors, keyof Colors]> = {
    primary: ['primarySoft', 'primaryText'],
    success: ['successSoft', 'successText'],
    danger: ['dangerSoft', 'dangerText'],
    info: ['infoSoft', 'infoText'],
  };
  const [bg, fg] = tones[tone];
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.kpi, { backgroundColor: c.surface, borderColor: pressed ? c.primary : c.border }]}>
      <View style={[styles.kpiIcon, { backgroundColor: c[bg] }]}>
        <Icon size={20} color={c[fg]} />
      </View>
      <Txt size="sm" muted numberOfLines={2}>
        {label}
      </Txt>
      <Txt size="xl" weight="bold" tabular>
        {value}
      </Txt>
      {sub ? (
        <Txt size="xs" muted>
          {sub}
        </Txt>
      ) : null}
    </Pressable>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const user = useSession((s) => s.user);
  const d = useDashboard();
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? 'dashboard.greeting_morning' : hour < 17 ? 'dashboard.greeting_afternoon' : 'dashboard.greeting_evening');

  if (d.isPending) return <Loading />;
  const s = d.data?.stock;

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={d.isRefetching} onRefresh={() => void d.refetch()} colors={[c.primary]} />}
      >
        <View>
          <Txt size="xl" weight="bold">
            {greet}, {user?.name.split(' ')[0]}
          </Txt>
          <Txt muted>{user ? t(`roles.${user.role}`) : ''}</Txt>
        </View>
        {d.data?.money ? (
          <View style={styles.grid}>
            <Kpi label={t('dashboard.sales_today')} value={rupees(d.data.money.sales_today)} icon={IndianRupee} tone="success" onPress={() => router.push('/money')} />
            <Kpi label={t('dashboard.credit_today')} value={rupees(d.data.money.credit_today)} icon={HandCoins} tone="info" />
            <Kpi label={t('dashboard.customer_dues')} value={rupees(d.data.money.customer_dues)} icon={Users} tone={d.data.money.customer_dues ? 'danger' : 'success'} onPress={() => router.push('/reports')} />
            <Kpi label={t('dashboard.supplier_payables')} value={rupees(d.data.money.supplier_payables)} icon={Truck} tone="info" onPress={() => router.push('/suppliers')} />
          </View>
        ) : null}
        {d.data?.sales || d.data?.purchases ? (
          <View style={styles.grid}>
            {d.data.sales ? <Kpi label={t('dashboard.sales_bills_today')} value={rupees(d.data.sales.today.total)} sub={t('dashboard.bills_count', { n: d.data.sales.today.count })} icon={Receipt} tone="success" onPress={() => router.push('/money')} /> : null}
            {d.data.sales ? <Kpi label={t('dashboard.sales_month')} value={rupees(d.data.sales.month.total)} sub={t('dashboard.bills_count', { n: d.data.sales.month.count })} icon={Calendar} tone="success" onPress={() => router.push('/money')} /> : null}
            {d.data.purchases ? <Kpi label={t('dashboard.purchases_today')} value={rupees(d.data.purchases.today.total)} sub={t('dashboard.bills_count', { n: d.data.purchases.today.count })} icon={Truck} tone="info" onPress={() => router.push('/purchases')} /> : null}
            {d.data.purchases ? <Kpi label={t('dashboard.purchases_month')} value={rupees(d.data.purchases.month.total)} sub={t('dashboard.bills_count', { n: d.data.purchases.month.count })} icon={Calendar} tone="info" onPress={() => router.push('/purchases')} /> : null}
          </View>
        ) : null}
        {d.data?.sales ? (
          <Card padded={false}>
            <View style={[styles.cardHead, { borderColor: c.border }]}>
              <Txt weight="semibold">{t('dashboard.latest_sales')}</Txt>
            </View>
            {d.data.sales.latest.length ? (
              d.data.sales.latest.map((b) => (
                <Pressable key={b.id} onPress={() => router.push(`/invoice/${b.id}`)} style={({ pressed }) => [styles.lowRow, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : 'transparent' }]}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold" numberOfLines={1}>
                      {b.invoice_no} · {b.customer_name ?? t('inv.walk_in')}
                    </Txt>
                    <Txt size="sm" muted numberOfLines={1}>
                      {date(b.invoice_date)}
                      {b.reg_no ? ` · ${b.reg_no}` : ''}
                    </Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Txt weight="bold" tabular>
                      {money(b.grand_total)}
                    </Txt>
                    {Number(b.balance) > 0 ? <Chip label={`${t('billing.due')} ${money(b.balance)}`} tone="warning" /> : <Chip label={t('billing.paid')} tone="success" />}
                  </View>
                </Pressable>
              ))
            ) : (
              <Txt muted style={{ padding: space[4] }}>
                {t('dashboard.no_bills')}
              </Txt>
            )}
          </Card>
        ) : null}
        {d.data?.purchases ? (
          <Card padded={false}>
            <View style={[styles.cardHead, { borderColor: c.border }]}>
              <Txt weight="semibold">{t('dashboard.latest_purchases')}</Txt>
            </View>
            {d.data.purchases.latest.length ? (
              d.data.purchases.latest.map((p) => (
                <Pressable key={p.id} onPress={() => router.push(`/purchase/${p.id}`)} style={({ pressed }) => [styles.lowRow, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : 'transparent' }]}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold" numberOfLines={1}>
                      {p.bill_no} · {p.supplier_name}
                    </Txt>
                    <Txt size="sm" muted>
                      {date(p.bill_date)}
                    </Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Txt weight="bold" tabular>
                      {money(p.total)}
                    </Txt>
                    {Number(p.due) > 0.004 ? <Chip label={`${t('billing.due')} ${money(p.due)}`} tone="warning" /> : <Chip label={t('billing.paid')} tone="success" />}
                  </View>
                </Pressable>
              ))
            ) : (
              <Txt muted style={{ padding: space[4] }}>
                {t('dashboard.no_bills')}
              </Txt>
            )}
          </Card>
        ) : null}
        {s ? (
          <View style={styles.grid}>
            <Kpi label={t('dashboard.jobs_in_shop')} value={Object.values(d.data?.jobs_by_status ?? {}).reduce((a, b) => a + b, 0)} icon={Bike} tone="primary" onPress={() => router.push('/jobs')} />
            {can(user, 'issue_parts') ? <Kpi label={t('dashboard.approvals_waiting')} value={d.data?.approvals_waiting ?? 0} icon={ShieldCheck} tone={d.data?.approvals_waiting ? 'danger' : 'success'} onPress={() => router.push('/approvals')} /> : null}
            <Kpi label={t('dashboard.open_requests')} value={d.data?.open_requests ?? 0} icon={Inbox} tone="info" onPress={() => router.push(can(user, 'issue_parts') ? '/queue' : '/requests')} />
            <Kpi label={t('dashboard.low_stock')} value={s.low_stock_count} icon={TriangleExclamationPoint} tone={s.low_stock_count ? 'danger' : 'success'} onPress={() => router.push('/stock')} />
            <Kpi label={t('dashboard.parts_count')} value={s.parts} icon={Package} tone="primary" onPress={() => router.push('/stock')} />
            <Kpi label={t('dashboard.out_of_stock')} value={s.out_of_stock} icon={Boxes} tone={s.out_of_stock ? 'danger' : 'success'} />
            {s.stock_value !== undefined ? <Kpi label={t('dashboard.stock_value')} value={rupees(s.stock_value)} icon={Warehouse} tone="info" /> : null}
          </View>
        ) : null}
        <Card padded={false}>
          <View style={[styles.cardHead, { borderColor: c.border }]}>
            <Txt weight="semibold">{t('dashboard.low_stock_list')}</Txt>
          </View>
          {d.data?.low_stock.length ? (
            d.data.low_stock.map((p) => (
              <Pressable key={p.id} onPress={() => router.push(`/part/${p.id}`)} style={({ pressed }) => [styles.lowRow, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : 'transparent' }]}>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" numberOfLines={1}>
                    {nm(p)}
                  </Txt>
                  <Txt size="sm" muted numberOfLines={1}>
                    {p.part_no} · {nm(p, 'location')} {p.rack ? `· ${t('parts.rack')} ${p.rack}` : ''}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt weight="bold" color="dangerText" tabular>
                    {qty(p.current_stock)}
                  </Txt>
                  <Txt size="xs" muted>
                    min {qty(p.min_stock)}
                  </Txt>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={{ padding: space[5], flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
              <CircleCheck size={20} color={c.successText} />
              <Txt muted style={{ flex: 1 }}>
                {t('dashboard.low_stock_empty')}
              </Txt>
            </View>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  kpi: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.card, padding: space[4], gap: space[2] },
  kpiIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardHead: { padding: space[4], borderBottomWidth: 1 },
  lowRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth },
});
