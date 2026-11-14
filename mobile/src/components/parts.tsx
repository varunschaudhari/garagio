import { router } from 'expo-router';
import { PackageSearch, ScanLine, Search, TriangleExclamationPoint, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useParts } from '@/api/queries';
import { qty } from '@/format';
import { nm, nmAlt } from '@/i18n';
import { radius, size, space, touch, useTheme } from '@/theme';
import type { Part } from '@/types';
import { Chip, EmptyState, IconButton, Loading, OfflineBanner, Txt } from './ui';

export function PartRow({ part, onPress }: { part: Part; onPress: () => void }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const low = !!part.is_low;
  const where = [nm(part, 'location'), part.rack ? `${t('parts.rack')} ${part.rack}` : ''].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${nm(part)}, ${t('parts.stock')} ${qty(part.current_stock)}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.border }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="semibold" numberOfLines={1}>
          {nm(part)}
        </Txt>
        <Txt size="sm" muted numberOfLines={1}>
          {part.part_no}
          {nmAlt(part) ? ` · ${nmAlt(part)}` : ''}
        </Txt>
        {where ? (
          <Txt size="sm" color="primaryText" weight="semibold" numberOfLines={1}>
            {where}
          </Txt>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Txt size="xl" weight="bold" tabular color={low ? 'dangerText' : 'text'}>
          {qty(part.current_stock)}
        </Txt>
        {low ? <Chip label={t('parts.low')} tone="danger" /> : <Txt size="xs" muted>{part.unit}</Txt>}
      </View>
    </Pressable>
  );
}

/** Searchable stock list with scan, low-stock filter and pull to refresh. */
export function PartsList({ location, rack, header }: { location?: number; rack?: string; header?: React.ReactNode }) {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const parts = useParts({ q, low, location, rack, sort: rack ? 'rack' : 'name', per_page: 200 });

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={[styles.searchBar, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={[styles.search, { borderColor: c.borderStrong, backgroundColor: c.bg }]}>
          <Search size={20} color={c.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('parts.search_placeholder')}
            placeholderTextColor={c.muted}
            style={[styles.searchInput, { color: c.text, fontFamily: font('regular') }]}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={t('common.search')}
          />
          {text ? <IconButton icon={X} label={t('common.clear')} onPress={() => setText('')} /> : null}
        </View>
        <IconButton icon={ScanLine} label={t('mobile.scan')} color={c.primaryText} onPress={() => router.push({ pathname: '/scan', params: { mode: 'open' } })} />
      </View>
      <View style={styles.filters}>
        <Pressable
          onPress={() => setLow(!low)}
          accessibilityRole="switch"
          accessibilityState={{ checked: low }}
          style={[styles.filterChip, { borderColor: low ? c.primary : c.borderStrong, backgroundColor: low ? c.primarySoft : c.surface }]}
        >
          <TriangleExclamationPoint size={16} color={low ? c.primaryText : c.muted} />
          <Txt size="sm" weight="semibold" color={low ? 'text' : 'muted'}>
            {t('parts.low_only')}
          </Txt>
        </Pressable>
        {rack ? <Chip label={t('mobile.rack_parts', { rack })} tone="primary" /> : null}
        <View style={{ flex: 1 }} />
        {parts.data ? (
          <Txt size="sm" muted>
            {parts.data.total}
          </Txt>
        ) : null}
      </View>
      {header}
      {parts.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={parts.data?.items ?? []}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PartRow part={item} onPress={() => router.push(`/part/${item.id}`)} />}
          contentContainerStyle={{ padding: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={parts.isRefetching} onRefresh={() => void parts.refetch()} colors={[c.primary]} />}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState icon={PackageSearch} title={q ? t('parts.not_found', { q }) : t('parts.empty_title')} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderRadius: radius.card, borderWidth: 1, minHeight: 76 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3], borderBottomWidth: 1 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingLeft: space[3], minHeight: touch.button },
  searchInput: { flex: 1, fontSize: size.md, paddingVertical: space[2] },
  filters: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4], paddingTop: space[3] },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space[3], minHeight: 40 },
});
