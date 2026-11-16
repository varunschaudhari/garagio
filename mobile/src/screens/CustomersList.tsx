import { router } from 'expo-router';
import { MessageCircle, Search, Users } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useCustomers } from '@/api/queries';
import { Button, EmptyState, Loading, OfflineBanner, Txt } from '@/components/ui';
import { money } from '@/format';
import { radius, size, space, touch, useTheme } from '@/theme';

export default function CustomersTab() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const list = useCustomers(q);

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={{ padding: space[4], gap: space[3] }}>
        <Button title={t('reminders.title')} icon={MessageCircle} variant="secondary" small onPress={() => router.push('/reminders')} />
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
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(x) => String(x.id)}
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} colors={[c.primary]} />}
          ListEmptyComponent={<EmptyState icon={Users} title={t('customers.empty_title')} text={t('customers.empty_text')} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/customer/${item.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]}
            >
              <View style={{ flex: 1 }}>
                <Txt weight="semibold" numberOfLines={1}>
                  {item.name}
                </Txt>
                <Txt size="sm" muted numberOfLines={1}>
                  {item.phone}
                  {item.reg_nos ? ` · ${item.reg_nos}` : ''}
                </Txt>
              </View>
              {item.balance > 0 ? (
                <Txt weight="bold" tabular color="dangerText">
                  {money(item.balance)}
                </Txt>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderWidth: 1, borderRadius: radius.card, minHeight: 68 },
});
