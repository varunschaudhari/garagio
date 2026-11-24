import { router, useLocalSearchParams } from 'expo-router';
import { Bike, Search } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useJobs } from '@/api/queries';
import { EmptyState, Loading, OfflineBanner, Segmented } from '@/components/ui';
import { JobRow } from '@/components/work';
import { radius, size, space, touch, useTheme } from '@/theme';

type Stage = 'processing' | 'completed';
/** Bikes in the shop in two parts: work still going on, and work done (waiting for the bill or the customer). */
const STAGES: Record<Stage, string[]> = {
  processing: ['pending', 'estimate_sent', 'approved', 'in_progress', 'waiting_parts'],
  completed: ['ready'],
};

/** Jobs in the shop, as Processing / Completed. Mechanics see only their own (the API filters). */
export default function JobsTab() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const params = useLocalSearchParams<{ stage?: string }>();
  const stage: Stage = params.stage === 'completed' ? 'completed' : 'processing';
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const jobs = useJobs({ active: true, q });
  const all = jobs.data?.items ?? [];
  const count = (s: Stage) => all.filter((j) => STAGES[s].includes(j.status)).length;
  const items = all.filter((j) => STAGES[stage].includes(j.status));

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={{ padding: space[4], gap: space[3] }}>
        <Segmented<Stage>
          value={stage}
          onChange={(s) => router.setParams({ stage: s })}
          options={[
            { value: 'processing', label: `${t('jobs.stage_processing')} (${count('processing')})` },
            { value: 'completed', label: `${t('jobs.stage_completed')} (${count('completed')})` },
          ]}
        />
        <View style={[styles.search, { borderColor: c.borderStrong, backgroundColor: c.surface }]}>
          <Search size={20} color={c.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('customers.search_placeholder')}
            placeholderTextColor={c.muted}
            style={{ flex: 1, fontSize: size.md, color: c.text, fontFamily: font('regular') }}
            accessibilityLabel={t('common.search')}
          />
        </View>
      </View>
      {jobs.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(j) => String(j.id)}
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()} colors={[c.primary]} />}
          renderItem={({ item }) => <JobRow job={item} onPress={() => router.push(`/job/${item.id}`)} />}
          ListEmptyComponent={<EmptyState icon={Bike} title={t(stage === 'completed' ? 'jobs.empty_completed' : 'jobs.empty_processing')} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button },
});
