import { router } from 'expo-router';
import { Bike, Boxes, Calendar, ChartColumn, CircleCheck, ClipboardList, HandCoins, IndianRupee, Inbox, Package, Receipt, ShieldCheck, Store, Truck, TriangleExclamationPoint, Users, Wallet, Warehouse } from 'lucide-react-native';
import type { Href } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useDashboard } from '@/api/queries';
import { GradientPanel } from '@/components/brand';
import { Card, Chip, Loading, OfflineBanner, Txt } from '@/components/ui';
import { date, money, qty, rupees } from '@/format';
import { nm } from '@/i18n';
import { useSession, can } from '@/store/session';
import { hasTab } from '@/tabs';
import { elevation, radius, space, useTheme, type Colors } from '@/theme';
import type { Perm } from '@/types';

type Tone = 'primary' | 'success' | 'danger' | 'info' | 'warning' | 'violet' | 'teal' | 'pink';
const TONES: Record<Tone, [keyof Colors, keyof Colors]> = {
  primary: ['primarySoft', 'primaryText'],
  success: ['successSoft', 'successText'],
  danger: ['dangerSoft', 'dangerText'],
  info: ['infoSoft', 'infoText'],
  warning: ['warningSoft', 'warningText'],
  violet: ['violetSoft', 'violetText'],
  teal: ['tealSoft', 'tealText'],
  pink: ['pinkSoft', 'pinkText'],
};

/** The shop's eight big buttons (its own dashboard notes), each shown to people who may use it. */
const TILES: { key: string; icon: LucideIcon; to: Href; perm?: Perm; tone: Tone }[] = [
  { key: 'purchase', icon: Truck, to: '/purchase/new', perm: 'purchases', tone: 'info' },
  { key: 'sale', icon: Receipt, to: '/invoice/counter', perm: 'make_bills', tone: 'success' },
  { key: 'stock', icon: Boxes, to: '/parts', tone: 'warning' },
  { key: 'job', icon: ClipboardList, to: '/job/new', perm: 'jobs', tone: 'violet' },
  { key: 'payables', icon: HandCoins, to: '/suppliers', perm: 'purchases', tone: 'danger' },
  { key: 'expenses', icon: Wallet, to: '/cash', perm: 'cash_book', tone: 'pink' },
  { key: 'reports', icon: ChartColumn, to: '/reports', perm: 'reports', tone: 'teal' },
  { key: 'suppliers', icon: Store, to: '/suppliers', perm: 'purchases', tone: 'primary' },
];

function Tiles({ subs }: { subs: Record<string, string | undefined> }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const user = useSession((s) => s.user);
  const shown = TILES.filter((x) => !x.perm || can(user, x.perm));
  if (shown.length < 2) return null;
  return (
    <View style={styles.tiles} accessibilityLabel={t('dashboard.tiles')}>
      {shown.map((x) => {
        const [bg, fg] = TONES[x.tone];
        const Icon = x.icon;
        return (
          <Pressable
            key={x.key}
            onPress={() => router.push(x.to)}
            accessibilityRole="button"
            accessibilityLabel={t(`dashboard.tile_${x.key}`)}
            style={({ pressed }) => [styles.tile, elevation.card, { backgroundColor: c.surface, borderColor: pressed ? c.primary : c.border, shadowColor: c.shadow, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
          >
            <View style={[styles.tileIcon, { backgroundColor: c[bg] }]}>
              <Icon size={24} color={c[fg]} />
            </View>
            <Txt size="sm" weight="semibold" center numberOfLines={2}>
              {t(`dashboard.tile_${x.key}`)}
            </Txt>
            {subs[x.key] ? (
              <Txt size="xs" muted center tabular numberOfLines={1}>
                {subs[x.key]}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bikes in the shop: all, work done (ready) and still in work. */
function shopCounts(by: Record<string, number> | undefined) {
  const all = Object.values(by ?? {}).reduce((a, b) => a + b, 0);
  const ready = by?.ready ?? 0;
  return { all, ready, working: all - ready };
}

function Kpi({ label, value, sub, icon: Icon, tone, onPress }: { label: string; value: string | number; sub?: string; icon: LucideIcon; tone: Tone; onPress?: () => void }) {
  const { c } = useTheme();
  const [bg, fg] = TONES[tone];
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.kpi, elevation.card, { backgroundColor: c.surface, borderColor: pressed ? c.primary : c.border, shadowColor: c.shadow }]}>
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

function isoToday() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A figure on the Home banner. */
function HeroStat({ value, label, onPress }: { value: string; label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={({ pressed }) => [styles.heroStat, { backgroundColor: pressed ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.15)' }]}>
      <Txt size="xl" weight="bold" tabular style={{ color: '#FFFFFF' }} numberOfLines={1}>
        {value}
      </Txt>
      <Txt size="xs" weight="semibold" style={{ color: '#FFFFFF' }} numberOfLines={2}>
        {label}
      </Txt>
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
        <GradientPanel style={{ padding: space[5], gap: space[1] }}>
          <Txt size="xl" weight="bold" style={{ color: '#FFFFFF' }}>
            {greet}, {user?.name.split(' ')[0]}
          </Txt>
          <Txt size="sm" weight="semibold" style={{ color: 'rgba(255,255,255,0.92)' }}>
            {user ? t(`roles.${user.role}`) : ''} · {date(isoToday())}
          </Txt>
          <View style={styles.heroStats}>
            {d.data?.money ? <HeroStat value={rupees(d.data.money.sales_today)} label={t('dashboard.sales_today')} onPress={() => router.push('/money')} /> : null}
            <HeroStat value={String(shopCounts(d.data?.jobs_by_status).working)} label={t('jobs.stage_processing')} onPress={() => router.push({ pathname: '/jobs', params: { stage: 'processing' } })} />
            <HeroStat value={String(shopCounts(d.data?.jobs_by_status).ready)} label={t('jobs.stage_completed')} onPress={() => router.push({ pathname: '/jobs', params: { stage: 'completed' } })} />
            {!d.data?.money && s ? <HeroStat value={String(s.low_stock_count)} label={t('dashboard.low_stock')} onPress={() => router.push('/parts')} /> : null}
          </View>
        </GradientPanel>
        <Tiles subs={{ payables: d.data?.money ? rupees(d.data.money.supplier_payables) : undefined, stock: s?.low_stock_count ? `${t('dashboard.low_stock')}: ${s.low_stock_count}` : undefined }} />
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
            {d.data.purchases ? <Kpi label={t('dashboard.purchases_today')} value={rupees(d.data.purchases.today.total)} sub={t('dashboard.bills_count', { n: d.data.purchases.today.count })} icon={Truck} tone="info" onPress={() => router.push('/purchase')} /> : null}
            {d.data.purchases ? <Kpi label={t('dashboard.purchases_month')} value={rupees(d.data.purchases.month.total)} sub={t('dashboard.bills_count', { n: d.data.purchases.month.count })} icon={Calendar} tone="info" onPress={() => router.push('/purchase')} /> : null}
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
            <Kpi label={t('dashboard.jobs_in_shop')} value={shopCounts(d.data?.jobs_by_status).all} sub={`${t('jobs.stage_processing')}: ${shopCounts(d.data?.jobs_by_status).working} · ${t('jobs.stage_completed')}: ${shopCounts(d.data?.jobs_by_status).ready}`} icon={Bike} tone="primary" onPress={() => router.push('/jobs')} />
            {can(user, 'issue_parts') ? <Kpi label={t('dashboard.approvals_waiting')} value={d.data?.approvals_waiting ?? 0} icon={ShieldCheck} tone={d.data?.approvals_waiting ? 'danger' : 'success'} onPress={() => router.push(hasTab(user, 'approvals') ? '/approvals' : { pathname: '/parts-requests', params: { mode: 'approvals' } })} /> : null}
            <Kpi label={t('dashboard.open_requests')} value={d.data?.open_requests ?? 0} icon={Inbox} tone="info" onPress={() => router.push(hasTab(user, 'queue') ? '/queue' : hasTab(user, 'requests') ? '/requests' : '/parts-requests')} />
            <Kpi label={t('dashboard.low_stock')} value={s.low_stock_count} icon={TriangleExclamationPoint} tone={s.low_stock_count ? 'danger' : 'success'} onPress={() => router.push('/parts')} />
            <Kpi label={t('dashboard.parts_count')} value={s.parts} icon={Package} tone="primary" onPress={() => router.push('/parts')} />
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
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tile: { flexBasis: '23%', flexGrow: 1, minHeight: 108, borderWidth: 1, borderRadius: radius.card, paddingVertical: space[3], paddingHorizontal: space[1], alignItems: 'center', gap: space[2] },
  tileIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  heroStats: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  heroStat: { flex: 1, borderRadius: 14, paddingVertical: space[2], paddingHorizontal: space[3], gap: 2 },
  kpi: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.card, padding: space[4], gap: space[2] },
  kpiIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  cardHead: { padding: space[4], borderBottomWidth: 1 },
  lowRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth },
});
