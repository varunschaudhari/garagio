import { useQuery } from '@tanstack/react-query';
import type { Perm } from '@/types';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { Banner, Card, Divider, EmptyState, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { date, money, qty } from '@/format';
import { useSession, can } from '@/store/session';
import { space, useTheme } from '@/theme';
import { ChartColumn } from 'lucide-react-native';

type ReportKey = 'profit' | 'gst' | 'dues' | 'payables' | 'stock';
interface Report {
  columns: string[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number>;
  summary?: Record<string, number>;
}

const TEXT = new Set(['date', 'invoice_no', 'type', 'customer', 'gstin', 'bill_no', 'supplier', 'mode', 'part_no', 'name', 'category', 'location', 'rack', 'unit', 'month', 'phone', 'last_bill', 'last_payment', 'mechanic']);
const TITLE: Record<ReportKey, string> = { profit: 'month', gst: 'rate', dues: 'customer', payables: 'supplier', stock: 'name' };

function monthRange(offset: number): [string, string] {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const p = (x: number) => String(x).padStart(2, '0');
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-01`, `${last.getFullYear()}-${p(last.getMonth() + 1)}-${p(last.getDate())}`];
}

function fmt(key: string, v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'last_bill' || key === 'last_payment' || key === 'date') return date(String(v));
  if (key === 'rate') return `${qty(Number(v))}%`;
  if (key === 'stock' || key === 'jobs') return qty(Number(v));
  if (TEXT.has(key)) return String(v);
  return money(Number(v));
}

/** Owner (all) / inventory (stock, payables): key reports on the phone; CSV export is on the web. */
export default function Reports() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const user = useSession((s) => s.user);
  // Each report needs the permission for its data (see the API).
  const NEEDS: Record<ReportKey, Perm> = { profit: 'see_money', gst: 'see_money', dues: 'see_money', payables: 'purchases', stock: 'see_costs' };
  const keys = (['profit', 'gst', 'dues', 'payables', 'stock'] as ReportKey[]).filter((k) => can(user, NEEDS[k]));
  const [key, setKey] = useState<ReportKey>(keys[0]);
  const [month, setMonth] = useState<0 | -1>(0);
  const [from, to] = monthRange(month);
  const q = useQuery({ queryKey: ['report', key, from, to], queryFn: () => api.get<Report>(`/reports/${key}`, { from, to }) });
  const r = q.data;
  const valueCols = r ? r.columns.filter((col) => col !== TITLE[key] && !['customer_id', 'supplier_id', 'phone'].includes(col)) : [];

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[3], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} colors={[c.primary]} />}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
          <Segmented<ReportKey> value={key} onChange={setKey} options={keys.map((k) => ({ value: k, label: t(`reports.${k}`) }))} />
        </ScrollView>
        {['profit', 'gst'].includes(key) ? (
          <Segmented<0 | -1> value={month} onChange={setMonth} options={[{ value: 0, label: t('reports.this_month') }, { value: -1, label: t('reports.last_month') }]} />
        ) : null}
        {key === 'profit' ? <Banner text={t('reports.profit_formula')} /> : null}
        {key === 'gst' ? <Banner tone="warning" text={t('reports.gst_note')} /> : null}
        {q.isPending ? <Loading /> : null}
        {key === 'profit' && r?.summary ? (
          <Card style={{ gap: space[2] }}>
            {(['sales', 'parts_cost', 'mechanic_payments', 'expenses'] as const).map((k) => (
              <View key={k} style={styles.kv}><Txt muted>{t(`reports.col.${k}`)}</Txt><Txt tabular weight="semibold">{money(r.summary![k])}</Txt></View>
            ))}
            <Divider />
            <View style={styles.kv}>
              <Txt size="lg" weight="bold">{t('reports.col.profit')}</Txt>
              <Txt size="xl" weight="bold" tabular color={r.summary.profit < 0 ? 'dangerText' : 'successText'}>{money(r.summary.profit)}</Txt>
            </View>
          </Card>
        ) : null}
        {r && key !== 'profit' ? (
          r.rows.length ? (
            <>
              {r.rows.map((row, i) => (
                <Card key={i} style={{ gap: 4 }}>
                  <Txt weight="semibold">{fmt(TITLE[key], row[TITLE[key]])}</Txt>
                  {valueCols.map((col) => (row[col] !== null && row[col] !== 0 && row[col] !== '' ? (
                    <View key={col} style={styles.kv}><Txt size="sm" muted>{t(`reports.col.${col}`)}</Txt><Txt size="sm" tabular>{fmt(col, row[col])}</Txt></View>
                  ) : null))}
                </Card>
              ))}
              {Object.keys(r.totals).length ? (
                <Card style={{ gap: 4 }}>
                  <Txt weight="bold">{t('common.total')}</Txt>
                  {Object.entries(r.totals).map(([col, v]) => (
                    <View key={col} style={styles.kv}><Txt size="sm" muted>{t(`reports.col.${col}`)}</Txt><Txt size="sm" weight="bold" tabular>{fmt(col, v)}</Txt></View>
                  ))}
                </Card>
              ) : null}
            </>
          ) : (
            <EmptyState icon={ChartColumn} title={t('common.no_results')} />
          )
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
});
