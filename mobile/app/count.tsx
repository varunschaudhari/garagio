import { router, Stack, useFocusEffect } from 'expo-router';
import { Boxes, Check, ScanLine } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, SectionList, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocations, useParts, usePostStockCount } from '@/api/queries';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, EmptyState, IconButton, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { qty } from '@/format';
import { nm, nmAlt } from '@/i18n';
import { useCount } from '@/store/count';
import { parseRackCode, useScan } from '@/store/scan';
import { radius, size, space, touch, useTheme } from '@/theme';
import type { Part } from '@/types';


/** Walk a location rack by rack and enter what you count. Only differences are posted. */
export default function StockCount() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const insets = useSafeAreaInsets();
  const locations = useLocations();
  const { locationId, counted, setLocation, set, clear } = useCount();
  const post = usePostStockCount();
  const listRef = useRef<SectionList<Part>>(null);
  const inputs = useRef(new Map<number, TextInputInstance>());

  useEffect(() => {
    if (!locationId && locations.data?.length) setLocation(locations.data[0].id);
  }, [locationId, locations.data, setLocation]);

  const parts = useParts({ location: locationId ?? undefined, sort: 'rack', per_page: 1000 });

  const sections = useMemo(() => {
    const map = new Map<string, Part[]>();
    for (const p of parts.data?.items ?? []) {
      const key = p.rack || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()].map(([rack, data]) => ({ rack, data }));
  }, [parts.data]);

  const list = parts.data?.items ?? [];
  const countedIds = Object.keys(counted).map(Number);
  const diffs = list.filter((p) => counted[p.id] !== undefined && counted[p.id] !== Number(p.current_stock)).length;

  const jumpTo = useCallback(
    (raw: string) => {
      const rackCode = parseRackCode(raw);
      const code = (rackCode ? rackCode.rack : raw).trim().toUpperCase();
      const sIndex = sections.findIndex((s) => s.rack === code);
      if (sIndex >= 0) {
        listRef.current?.scrollToLocation({ sectionIndex: sIndex, itemIndex: 0, viewOffset: 0 });
        return;
      }
      for (let si = 0; si < sections.length; si++) {
        const ii = sections[si].data.findIndex((p) => p.part_no === code);
        if (ii >= 0) {
          listRef.current?.scrollToLocation({ sectionIndex: si, itemIndex: ii, viewOffset: 60 });
          setTimeout(() => inputs.current.get(sections[si].data[ii].id)?.focus(), 400);
          return;
        }
      }
      toast(t('common.no_results'), 'info');
    },
    [sections, t]
  );

  // A code scanned with mode=pick arrives here when the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      const code = useScan.getState().take();
      if (code) setTimeout(() => jumpTo(code), 300);
    }, [jumpTo])
  );

  const changeLocation = (id: number) => {
    if (id === locationId) return;
    if (!countedIds.length) return setLocation(id);
    Alert.alert(t('stock.unsaved'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: () => setLocation(id) },
    ]);
  };

  const submit = () => {
    if (!countedIds.length || !locationId) return;
    const doPost = async () => {
      try {
        const lines = countedIds.map((part_id) => ({ part_id, counted: counted[part_id] }));
        const res = await post.mutateAsync({ location_id: locationId, lines });
        clear();
        toast(t('stock.posted', { n: res.lines_changed }));
      } catch (e) {
        toastError(e);
      }
    };
    if (!diffs) {
      toast(t('stock.no_changes'), 'info');
      return;
    }
    Alert.alert(t('stock.post_count'), t('stock.confirm_post', { n: diffs }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('stock.post_count'), onPress: () => void doPost() },
    ]);
  };

  if (locations.isPending) return <Loading />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          headerRight: () => <IconButton icon={ScanLine} label={t('stock.jump_rack')} color={c.primaryText} onPress={() => router.push({ pathname: '/scan', params: { mode: 'pick' } })} />,
        }}
      />
      <OfflineBanner />
      <View style={{ padding: space[4], gap: space[3], backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.border }}>
        <Segmented<number> value={locationId ?? 0} onChange={changeLocation} options={(locations.data ?? []).map((l) => ({ value: l.id, label: nm(l) }))} />
        <Txt size="sm" muted>
          {t('stock.count_sub')}
        </Txt>
      </View>
      {parts.isPending ? (
        <Loading />
      ) : (
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(p) => String(p.id)}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          onScrollToIndexFailed={() => {}}
          contentContainerStyle={{ paddingBottom: 140 }}
          ListEmptyComponent={<EmptyState icon={Boxes} title={t('parts.empty_title')} />}
          renderSectionHeader={({ section }) => (
            <View style={[styles.rackHead, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Txt weight="bold" color="primaryText">
                {t('parts.rack')} {section.rack}
              </Txt>
            </View>
          )}
          renderItem={({ item, index, section }) => {
            const value = counted[item.id];
            const changed = value !== undefined && value !== Number(item.current_stock);
            return (
              <View style={[styles.row, { borderColor: c.border, backgroundColor: changed ? c.warningSoft : c.surface }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="semibold" numberOfLines={1}>
                    {nm(item)}
                  </Txt>
                  <Txt size="sm" muted numberOfLines={1}>
                    {item.part_no}
                    {nmAlt(item) ? ` · ${nmAlt(item)}` : ''}
                  </Txt>
                  <Txt size="sm" muted>
                    {t('stock.system_qty')}: <Txt size="sm" weight="semibold">{qty(item.current_stock)}</Txt>
                  </Txt>
                </View>
                <TextInput
                  ref={(r) => {
                    if (r) inputs.current.set(item.id, r);
                    else inputs.current.delete(item.id);
                  }}
                  value={value === undefined ? '' : String(value)}
                  onChangeText={(txt) => {
                    const v = txt.replace(',', '.').trim();
                    const n = Number(v);
                    set(item.id, v === '' || !Number.isFinite(n) || n < 0 ? null : n);
                  }}
                  placeholder={qty(item.current_stock)}
                  placeholderTextColor={c.muted}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    const next = section.data[index + 1];
                    if (next) inputs.current.get(next.id)?.focus();
                  }}
                  accessibilityLabel={`${t('stock.counted')} ${item.part_no}`}
                  style={[styles.input, { color: c.text, borderColor: changed ? c.warning : c.borderStrong, backgroundColor: c.bg, fontFamily: font('bold') }]}
                />
              </View>
            );
          }}
        />
      )}
      <View style={[styles.footer, { backgroundColor: c.surface, borderColor: c.border, paddingBottom: insets.bottom + space[3] }]}>
        {countedIds.length ? (
          <Txt size="sm" muted>
            {countedIds.length} {t('stock.counted').toLowerCase()} · {t('stock.changed_lines', { n: diffs })}
          </Txt>
        ) : (
          <Banner text={t('mobile.count_saved')} />
        )}
        <Button title={t('stock.post_count')} icon={Check} onPress={submit} disabled={!countedIds.length} loading={post.isPending} needsOnline />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  rackHead: { paddingHorizontal: space[4], paddingVertical: space[2], borderBottomWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth },
  input: { width: 104, height: touch.button + 4, borderWidth: 2, borderRadius: radius.input, textAlign: 'center', fontSize: size.xl },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space[4], gap: space[2], borderTopWidth: 1 },
});
