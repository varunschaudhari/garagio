import { router } from 'expo-router';
import { Bike, Search } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useJobs } from '@/api/queries';
import { EmptyState, Loading, OfflineBanner } from '@/components/ui';
import { JobRow } from '@/components/work';
import { radius, size, space, touch, useTheme } from '@/theme';

/** Jobs in the shop. Mechanics see only their own (the API filters). */
export default function JobsTab() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const jobs = useJobs({ active: true, q });

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={{ padding: space[4] }}>
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
          data={jobs.data?.items ?? []}
          keyExtractor={(j) => String(j.id)}
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()} colors={[c.primary]} />}
          renderItem={({ item }) => <JobRow job={item} onPress={() => router.push(`/job/${item.id}`)} />}
          ListEmptyComponent={<EmptyState icon={Bike} title={t('jobs.empty_board')} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button },
});
