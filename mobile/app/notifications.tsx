import { router, Stack } from 'expo-router';
import { Bell, CheckCheck } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useNotifications, useWorkMutation } from '@/api/queries';
import { EmptyState, IconButton, Loading, OfflineBanner, Txt } from '@/components/ui';
import { datetime } from '@/format';
import { openLink } from '@/push';
import { radius, space, useTheme } from '@/theme';

export default function Notifications() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const list = useNotifications();
  const read = useWorkMutation((body: { ids?: number[]; all?: boolean }) => api.post('/notifications/read', body));

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: t('notifications.title'),
          headerRight: () => <IconButton icon={CheckCheck} label={t('notifications.mark_all')} onPress={() => read.mutate({ all: true })} />,
        }}
      />
      <OfflineBanner />
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={{ padding: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} colors={[c.primary]} />}
          ListEmptyComponent={<EmptyState icon={Bell} title={t('notifications.empty')} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                if (!item.read_at) read.mutate({ ids: [item.id] });
                if (item.link) openLink(item.link);
                else router.back();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                { borderColor: c.border, backgroundColor: pressed ? c.surface2 : item.read_at ? c.surface : c.primarySoft },
              ]}
            >
              <Txt weight="semibold">{item.title}</Txt>
              {item.body ? <Txt size="sm">{item.body}</Txt> : null}
              <Txt size="xs" muted>
                {datetime(item.created_at)}
              </Txt>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { padding: space[4], borderWidth: 1, borderRadius: radius.card, gap: 2 },
});
