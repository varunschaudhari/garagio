import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Minus, Plus, ScanLine, Search, Send, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/api/client';
import { useJob, useParts, useSettings, useWorkMutation } from '@/api/queries';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Chip, IconButton, OfflineBanner, Txt } from '@/components/ui';
import { money, qty } from '@/format';
import { nm } from '@/i18n';
import { useScan } from '@/store/scan';
import { radius, size, space, touch, useTheme } from '@/theme';
import type { Part } from '@/types';

interface Line {
  key: string;
  part: Part | null;
  name: string;
  qty: number;
}

/** Mechanic's parts request (replaces the paper slip). */
export default function RequestParts() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const { job: jobParam } = useLocalSearchParams<{ job: string }>();
  const jobId = Number(jobParam);
  const job = useJob(jobId);
  const settings = useSettings();
  const limit = Number(settings.data?.approval_limit ?? 1000);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const send = useWorkMutation((body: unknown) => api.post('/requests', body));

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useParts({ q, per_page: 20 });

  const add = useCallback((p: Part) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.part?.id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: 'p' + p.id, part: p, name: nm(p), qty: 1 }];
    });
    setText('');
  }, []);

  useFocusEffect(
    useCallback(() => {
      const code = useScan.getState().take();
      if (!code) return;
      api.get<{ item: Part }>(`/parts/by-code/${encodeURIComponent(code)}`)
        .then((r) => add(r.item))
        .catch(() => toast(t('mobile.scanned_unknown', { code }), 'error'));
    }, [add, t])
  );

  const step = (key: string, by: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: Math.max(1, l.qty + by) } : l)));

  const submit = async () => {
    try {
      await send.mutateAsync({
        job_card_id: jobId,
        items: lines.map((l) => (l.part ? { part_id: l.part.id, qty: l.qty } : { custom_name: l.name, qty: l.qty })),
      });
      toast(t('requests.sent'));
      router.back();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: job.data ? `${t('requests.new')} · ${job.data.reg_no}` : t('requests.new') }} />
      <OfflineBanner />
      <View style={{ padding: space[4], gap: space[2] }}>
        <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
          <View style={[styles.search, { borderColor: c.borderStrong, backgroundColor: c.surface }]}>
            <Search size={20} color={c.muted} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('parts.search_placeholder')}
              placeholderTextColor={c.muted}
              style={{ flex: 1, fontSize: size.md, color: c.text, fontFamily: font('regular') }}
              accessibilityLabel={t('requests.add_line')}
            />
          </View>
          <IconButton icon={ScanLine} label={t('mobile.scan')} color={c.primaryText} onPress={() => router.push({ pathname: '/scan', params: { mode: 'pick' } })} />
        </View>
        <Txt size="xs" muted>
          {t('requests.approval_hint', { limit: money(limit) })}
        </Txt>
      </View>

      {q ? (
        <FlatList
          data={results.data?.items ?? []}
          keyExtractor={(p) => String(p.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[4] }}
          renderItem={({ item }) => (
            <Pressable onPress={() => add(item)} style={({ pressed }) => [styles.result, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <Txt weight="semibold" numberOfLines={1}>{nm(item)}</Txt>
                <Txt size="sm" muted>
                  {item.part_no} · {item.rack ? `${t('parts.rack')} ${item.rack} · ` : ''}{t('requests.in_stock')} {qty(item.current_stock)}
                </Txt>
              </View>
              <Plus size={22} color={c.primaryText} />
            </Pressable>
          )}
          ListFooterComponent={
            <Button title={`${t('requests.free_text')}: “${text}”`} variant="ghost" small onPress={() => { setLines((ls) => [...ls, { key: 'f' + Date.now(), part: null, name: text.trim(), qty: 1 }]); setText(''); }} />
          }
        />
      ) : (
        <FlatList
          data={lines}
          keyExtractor={(l) => l.key}
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[10] }}
          ListEmptyComponent={<Banner text={t('purchases.no_lines')} />}
          renderItem={({ item: l }) => {
            const needs = l.part && l.qty * Number(l.part.selling_price) >= limit;
            return (
              <Card style={{ gap: space[2] }}>
                <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold">{l.name}</Txt>
                    <Txt size="sm" muted>
                      {l.part ? `${l.part.part_no} · ${t('requests.in_stock')} ${qty(l.part.current_stock)}` : t('requests.free_text')}
                    </Txt>
                  </View>
                  <IconButton icon={Trash2} label={t('common.delete')} color={c.dangerText} onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                  <View style={[styles.stepper, { borderColor: c.borderStrong }]}>
                    <Pressable onPress={() => step(l.key, -1)} style={[styles.stepBtn, { backgroundColor: c.surface2 }]} accessibilityLabel="−1"><Minus size={24} color={c.text} /></Pressable>
                    <Txt size="xl" weight="bold" tabular style={{ minWidth: 48, textAlign: 'center' }}>{qty(l.qty)}</Txt>
                    <Pressable onPress={() => step(l.key, 1)} style={[styles.stepBtn, { backgroundColor: c.surface2 }]} accessibilityLabel="+1"><Plus size={24} color={c.text} /></Pressable>
                  </View>
                  {needs ? <Chip label={t('status.needs_approval')} tone="warning" /> : null}
                </View>
              </Card>
            );
          }}
          ListFooterComponent={lines.length ? <Button title={t('requests.send')} icon={Send} onPress={submit} loading={send.isPending} needsOnline style={{ marginTop: space[2] }} /> : undefined}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button },
  result: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderWidth: 1, borderRadius: radius.card },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.input, overflow: 'hidden' },
  stepBtn: { width: 56, height: 52, alignItems: 'center', justifyContent: 'center' },
});
