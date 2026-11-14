import { CircleCheck } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRequests } from '@/api/queries';
import { money } from '@/format';
import { space, useTheme } from '@/theme';
import { Banner, EmptyState, Loading, OfflineBanner, Segmented, Txt } from './ui';
import { RequestCard } from './work';

type Mode = 'queue' | 'approvals' | 'mine';

/** Shared list for the Queue, Approvals and My-requests tabs. Refreshes every 20 s. */
export function RequestList({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [status, setStatus] = React.useState<'open' | 'closed'>('open');
  const params = mode === 'approvals' ? { status: 'open', tab: 'approvals' } : mode === 'mine' ? { status, mine: true } : { status };
  const list = useRequests(params);
  const emptyKey = mode === 'approvals' ? 'requests.empty_approvals' : status === 'closed' ? 'requests.empty_done' : 'requests.empty_queue';

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      {mode !== 'approvals' ? (
        <View style={{ padding: space[4], paddingBottom: 0 }}>
          <Segmented<'open' | 'closed'>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'open', label: t('requests.queue') },
              { value: 'closed', label: t('requests.done') },
            ]}
          />
        </View>
      ) : null}
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={{ padding: space[4], gap: space[3], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} colors={[c.primary]} />}
          ListHeaderComponent={
            mode === 'approvals' && list.data ? (
              <Banner text={t('requests.approval_hint', { limit: money(list.data.approval_limit) })} />
            ) : (
              <Txt size="xs" muted>
                {t('requests.auto_refresh')}
              </Txt>
            )
          }
          renderItem={({ item }) => <RequestCard req={item} />}
          ListEmptyComponent={<EmptyState icon={CircleCheck} title={t(emptyKey)} />}
        />
      )}
    </View>
  );
}
