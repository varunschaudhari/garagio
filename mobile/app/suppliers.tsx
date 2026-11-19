import { router } from 'expo-router';
import { Plus, Search, Store } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useSuppliers } from '@/api/queries';
import { SupplierFormSheet } from '@/components/supplierForm';
import { Button, EmptyState, Loading, OfflineBanner, Txt } from '@/components/ui';
import { money } from '@/format';
import { radius, size, space, touch, useTheme } from '@/theme';

export default function Suppliers() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const list = useSuppliers(q);
  const [adding, setAdding] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={{ padding: space[4], gap: space[2] }}>
        <View style={[styles.search, { borderColor: c.borderStrong, backgroundColor: c.surface }]}>
          <Search size={20} color={c.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('common.search_placeholder')}
            placeholderTextColor={c.muted}
            style={{ flex: 1, fontSize: size.md, color: c.text, fontFamily: font('regular') }}
            accessibilityLabel={t('common.search')}
          />
        </View>
        <Button title={t('suppliers.new')} icon={Plus} variant="secondary" small onPress={() => setAdding(true)} needsOnline />
        {list.data ? (
          <Txt size="sm" muted>
            {t('suppliers.payable_total')}: <Txt size="sm" weight="bold" color="dangerText">{money(list.data.payable_total)}</Txt>
          </Txt>
        ) : null}
      </View>
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} colors={[c.primary]} />}
          ListEmptyComponent={<EmptyState icon={Store} title={t('suppliers.empty_title')} text={t('suppliers.empty_text')} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/supplier/${item.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]}
            >
              <View style={{ flex: 1 }}>
                <Txt weight="semibold" numberOfLines={1}>
                  {item.name}
                </Txt>
                <Txt size="sm" muted numberOfLines={1}>
                  {[item.contact_person, item.phone, item.gstin].filter(Boolean).join(' · ')}
                </Txt>
              </View>
              <Txt weight="bold" tabular color={item.balance > 0 ? 'dangerText' : 'muted'}>
                {money(item.balance)}
              </Txt>
            </Pressable>
          )}
        />
      )}
      {adding ? (
        <SupplierFormSheet
          onClose={() => setAdding(false)}
          onSaved={(s) => {
            setAdding(false);
            router.push(`/supplier/${s.id}`);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderWidth: 1, borderRadius: radius.card, minHeight: 68 },
});
