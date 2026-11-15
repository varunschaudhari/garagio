import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';
import { api } from '@/api/client';
import { Button, Card, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { datetime } from '@/format';
import { space, useTheme } from '@/theme';

interface AuditItem {
  id: number;
  created_at: string;
  action: string;
  entity: string;
  entity_id: number | null;
  user_name: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const show = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v);
};

/** Owner: who did what and when (discounts, cancelled bills, stock adjustments, permission changes…). */
export default function AuditScreen() {
  const { t, i18n } = useTranslation();
  const { c } = useTheme();
  const [kind, setKind] = useState<'important' | 'all'>('important');
  const q = useInfiniteQuery({
    queryKey: ['audit', kind],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<{ items: AuditItem[]; total: number }>('/audit', { kind, page: pageParam, per_page: 40 }),
    getNextPageParam: (last, pages) => (pages.reduce((n, p) => n + p.items.length, 0) < last.total ? pages.length + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const label = (action: string) => {
    for (const key of [`audit.actions.${action}`, `jobs.events.${action}`]) if (i18n.exists(key)) return t(key);
    return action.replace(/_/g, ' ');
  };
  const details = (it: AuditItem) => {
    const a = it.after ?? {};
    const b = it.before ?? {};
    const out: string[] = [];
    for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])].slice(0, 6)) {
      if (k === 'perms' && a.perms && b.perms) {
        const ap = a.perms as Record<string, boolean>;
        const bp = b.perms as Record<string, boolean>;
        for (const p of Object.keys(ap)) if (!!ap[p] !== !!bp[p]) out.push(`${t(`users.perms.${p}`)}: ${ap[p] ? '✓' : '✗'}`);
        continue;
      }
      out.push(k in a && k in b ? `${k}: ${show(b[k])} → ${show(a[k])}` : `${k}: ${show(k in a ? a[k] : b[k])}`);
    }
    return out.join(' · ');
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t('audit.title') }} />
      <OfflineBanner />
      <View style={{ padding: space[4], paddingBottom: 0 }}>
        <Segmented<'important' | 'all'> value={kind} onChange={setKind} options={[{ value: 'important', label: t('audit.important') }, { value: 'all', label: t('audit.everything') }]} />
      </View>
      {q.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ padding: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} colors={[c.primary]} />}
          ListEmptyComponent={<Txt muted>{t('audit.none')}</Txt>}
          renderItem={({ item }) => (
            <Card style={{ gap: 2 }}>
              <Txt weight="semibold">
                {label(item.action)}
                {item.entity_id !== null ? ` · ${item.entity} #${item.entity_id}` : ''}
              </Txt>
              <Txt size="sm" muted>
                {datetime(item.created_at)} · {item.user_name ?? t('audit.system')}
              </Txt>
              {details(item) ? <Txt size="sm">{details(item)}</Txt> : null}
            </Card>
          )}
          ListFooterComponent={q.hasNextPage ? <Button title={t('audit.more')} variant="secondary" onPress={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : undefined}
        />
      )}
    </View>
  );
}
