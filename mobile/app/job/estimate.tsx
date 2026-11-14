import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Check, Plus, Trash2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/api/client';
import { useJob, useLabourRates, useWorkMutation } from '@/api/queries';
import { PartPicker } from '@/components/pickers';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Button, Card, Field, IconButton, Loading, OfflineBanner, Txt } from '@/components/ui';
import { money, qty } from '@/format';
import { nm } from '@/i18n';
import { radius, size, space, useTheme } from '@/theme';
import type { JobDetail } from '@/types';

interface Line {
  key: string;
  type: 'part' | 'labour';
  partId?: number | null;
  rateId?: number | null;
  label: string;
  qty: string;
  price: string;
}

/** Estimate builder: parts at selling price + labour (editable). Prefilled from the job. */
/** Lines the job already has: issued parts (minus returns) and labour added at inspection. */
function initialLines(j: JobDetail): Line[] {
  return [
    ...j.parts.filter((p) => Number(p.qty) - Number(p.returned_qty) > 0).map((p) => ({ key: 'jp' + p.id, type: 'part' as const, partId: p.part_id, label: nm(p), qty: qty(Number(p.qty) - Number(p.returned_qty)), price: String(p.unit_price) })),
    ...j.labour.map((l) => ({ key: 'jl' + l.id, type: 'labour' as const, rateId: null, label: l.description, qty: '1', price: String(l.amount) })),
  ];
}

export default function EstimateBuilder() {
  const { job: jobParam } = useLocalSearchParams<{ job: string }>();
  const job = useJob(Number(jobParam));
  if (!job.data) return <Loading />;
  return <EstimateEditor job={job.data} />;
}

function EstimateEditor({ job: jobData }: { job: JobDetail }) {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const jobId = jobData.id;
  const rates = useLabourRates();
  const [lines, setLines] = useState<Line[]>(() => initialLines(jobData));
  const [pickPart, setPickPart] = useState(false);
  const [pickLabour, setPickLabour] = useState(false);
  const save = useWorkMutation((body: unknown) => api.post(`/jobs/${jobId}/estimates`, body));
  const job = { data: jobData };
  const total = lines.reduce((s, l) => s + (Number(l.qty.replace(',', '.')) || 0) * (Number(l.price.replace(',', '.')) || 0), 0);
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!lines.length) return toast(t('estimates.items_needed'), 'error');
    try {
      await save.mutateAsync({
        items: lines.map((l) =>
          l.type === 'part'
            ? { item_type: 'part', part_id: l.partId, qty: l.qty }
            : { item_type: 'labour', labour_rate_id: l.rateId ?? '', description: l.label, amount: l.price }
        ),
      });
      toast(t('common.saved'));
      router.back();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: job.data.approved_estimate_id ? t('estimates.revise') : t('estimates.new') }} />
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3], paddingBottom: space[10] }} keyboardShouldPersistTaps="handled">
        {lines.map((l) => (
          <Card key={l.key} style={{ gap: space[2] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
              <View style={{ flex: 1 }}>
                <Txt size="xs" muted>
                  {l.type === 'part' ? t('jobs.parts_total') : t('jobs.labour')}
                </Txt>
                <Txt weight="semibold">{l.label}</Txt>
              </View>
              <IconButton icon={Trash2} label={t('common.delete')} color={c.dangerText} onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              {l.type === 'part' ? (
                <>
                  <TextInput value={l.qty} onChangeText={(v) => update(l.key, { qty: v })} keyboardType="decimal-pad" accessibilityLabel={t('common.qty')} style={[styles.input, { width: 72, color: c.text, borderColor: c.borderStrong, fontFamily: font('semibold') }]} />
                  <Txt muted>× {money(Number(l.price))}</Txt>
                </>
              ) : (
                <TextInput value={l.price} onChangeText={(v) => update(l.key, { price: v })} keyboardType="decimal-pad" accessibilityLabel={t('common.amount')} style={[styles.input, { width: 120, color: c.text, borderColor: c.borderStrong, fontFamily: font('semibold') }]} />
              )}
              <View style={{ flex: 1 }} />
              <Txt weight="bold" tabular>
                {money((Number(l.qty.replace(',', '.')) || 0) * (Number(l.price.replace(',', '.')) || 0))}
              </Txt>
            </View>
          </Card>
        ))}
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={t('estimates.add_part')} icon={Plus} variant="secondary" small onPress={() => setPickPart(true)} style={{ flex: 1 }} />
          <Button title={t('estimates.add_labour')} icon={Plus} variant="secondary" small onPress={() => setPickLabour(true)} style={{ flex: 1 }} />
        </View>
        <Card style={styles.total}>
          <View>
            <Txt size="lg" weight="bold">{t('estimates.total')}</Txt>
            <Txt size="xs" muted>{t('estimates.gst_incl')}</Txt>
          </View>
          <Txt size="xl" weight="bold" tabular>{money(total)}</Txt>
        </Card>
        <Button title={t('common.save')} icon={Check} onPress={submit} loading={save.isPending} needsOnline />
      </ScrollView>

      <PartPicker
        visible={pickPart}
        onClose={() => setPickPart(false)}
        onPick={(p) => {
          setLines((ls) => [...ls, { key: 'np' + p.id + Date.now(), type: 'part', partId: p.id, label: nm(p), qty: '1', price: String(p.selling_price) }]);
          setPickPart(false);
        }}
      />
      <Sheet visible={pickLabour} onClose={() => setPickLabour(false)} title={t('estimates.add_labour')}>
        {(rates.data ?? []).map((r) => (
          <Pressable
            key={r.id}
            onPress={() => {
              setLines((ls) => [...ls, { key: 'nl' + r.id + Date.now(), type: 'labour', rateId: r.id, label: nm(r), qty: '1', price: String(r.amount) }]);
              setPickLabour(false);
            }}
            style={({ pressed }) => [styles.rate, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]}
            accessibilityRole="button"
          >
            <Txt style={{ flex: 1 }}>{nm(r)}</Txt>
            <Txt tabular weight="semibold">{money(r.amount)}</Txt>
          </Pressable>
        ))}
        <Field label={t('estimates.description')} placeholder={t('jobs.labour')} onSubmitEditing={(e) => {
          const label = e.nativeEvent.text.trim();
          if (!label) return;
          setLines((ls) => [...ls, { key: 'cl' + Date.now(), type: 'labour', rateId: null, label, qty: '1', price: '0' }]);
          setPickLabour(false);
        }} />
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.input, minHeight: 48, textAlign: 'center', fontSize: size.lg },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rate: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderWidth: 1, borderRadius: radius.input, padding: space[3], minHeight: 52 },
});
