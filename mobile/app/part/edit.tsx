import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useLocations, useSettings } from '@/api/queries';
import { toast, toastError } from '@/components/toast';
import { Button, Card, Field, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { fieldErrors } from '@/fieldErrors';
import { nm } from '@/i18n';
import { useSession } from '@/store/session';
import { radius, space, useTheme } from '@/theme';
import type { Named, Part } from '@/types';

const GST = [0, 5, 12, 18, 28, 40];

type Form = {
  part_no: string;
  name_en: string;
  name_mr: string;
  selling_price: string;
  gst_rate: number;
  category_id: number | null;
  location_id: number | null;
  rack: string;
  unit: string;
  hsn: string;
  brand: string;
  compatible_models: string;
  last_purchase_price: string;
  last_purchase_disc_pct: string;
  min_stock: string;
  opening_stock: string;
  opening_cost: string;
  active: number;
};

/** '' for empty or zero numbers, so the box shows its placeholder. */
const str = (v: unknown) => (v === null || v === undefined || Number(v) === 0 ? '' : String(Number(v)));

function Chips<T extends number | null>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt size="sm" weight="semibold">{label}</Txt>
      <View style={styles.chips}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.chip, { borderColor: on ? c.primary : c.borderStrong, backgroundColor: on ? c.primarySoft : c.surface }]}
            >
              <Txt size="sm" weight="semibold">{o.label}</Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function startForm(p: Part | undefined, defaultGst: number): Form {
  return {
    part_no: p?.part_no ?? '',
    name_en: p?.name_en ?? '',
    name_mr: p?.name_mr ?? '',
    selling_price: p ? String(Number(p.selling_price)) : '',
    gst_rate: p ? Number(p.gst_rate) : defaultGst,
    category_id: p?.category_id ?? null,
    location_id: p?.location_id ?? null,
    rack: p?.rack ?? '',
    unit: p?.unit ?? 'pcs',
    hsn: p?.hsn ?? '',
    brand: p?.brand ?? '',
    compatible_models: p?.compatible_models ?? '',
    last_purchase_price: str(p?.last_purchase_price),
    last_purchase_disc_pct: str(p?.last_purchase_disc_pct),
    min_stock: str(p?.min_stock),
    opening_stock: '',
    opening_cost: '',
    active: p ? Number(p.active) : 1,
  };
}

/** New part (no id) or edit one (?id=). Owner / inventory manager (edit_parts). */
export default function PartForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const partId = Number(id || 0);
  const settings = useSettings();
  const existing = useQuery({ queryKey: ['part', partId], queryFn: () => api.get<{ item: Part }>(`/parts/${partId}`).then((r) => r.item), enabled: partId > 0 });
  if ((partId && !existing.data) || settings.isPending) return <Loading />;
  return <PartFormBody key={partId} partId={partId} start={startForm(existing.data, Number(settings.data?.default_part_gst_rate ?? 18))} />;
}

function PartFormBody({ partId, start }: { partId: number; start: Form }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canSeeCost = useSession((s) => s.canSeeCost);
  const locations = useLocations();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ items: (Named & { id: number })[] }>('/categories').then((r) => r.items), staleTime: 10 * 60_000 });
  const [f, setF] = useState<Form>(start);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrs((e) => ({ ...e, [k]: '' }));
  };
  const n = (s: string) => s.replace(',', '.');

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.part_no.trim()) e.part_no = t('fields.required');
    if (!f.name_en.trim() && !f.name_mr.trim()) e.name_en = t('fields.required');
    if (!f.selling_price.trim()) e.selling_price = t('fields.required');
    setErrs(e);
    if (Object.keys(e).length) return;
    const body: Record<string, unknown> = {
      part_no: f.part_no.trim(),
      name_en: f.name_en.trim() || f.name_mr.trim(),
      name_mr: f.name_mr.trim(),
      selling_price: n(f.selling_price),
      gst_rate: f.gst_rate,
      category_id: f.category_id ?? '',
      location_id: f.location_id ?? '',
      rack: f.rack.trim(),
      unit: f.unit.trim() || 'pcs',
      hsn: f.hsn.trim(),
      brand: f.brand.trim(),
      compatible_models: f.compatible_models.trim(),
      min_stock: n(f.min_stock),
    };
    if (canSeeCost) {
      body.last_purchase_price = n(f.last_purchase_price);
      body.last_purchase_disc_pct = n(f.last_purchase_disc_pct);
    }
    if (partId) body.active = f.active;
    else {
      body.opening_stock = n(f.opening_stock);
      if (canSeeCost && f.opening_cost.trim()) body.opening_cost = n(f.opening_cost);
    }
    setBusy(true);
    try {
      const res = partId ? await api.put<{ item: Part }>(`/parts/${partId}`, body) : await api.post<{ item: Part }>('/parts', body);
      void qc.invalidateQueries({ queryKey: ['parts'] });
      void qc.invalidateQueries({ queryKey: ['part'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(partId ? t('common.saved') : t('common.created'));
      if (partId) router.back();
      else router.replace(`/part/${res.item.id}`);
    } catch (err) {
      const fe = fieldErrors(err, t);
      if (Object.keys(fe).length) setErrs(fe);
      else toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const none = { value: null, label: '—' };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: partId ? t('parts.edit') : t('parts.new') }} />
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space[4] }}>
          <Field label={t('parts.part_no')} value={f.part_no} onChangeText={set('part_no')} autoCapitalize="characters" autoCorrect={false} error={errs.part_no} required placeholder="SP-CPR7EA9" />
          <Field label={t('common.name_mr')} value={f.name_mr} onChangeText={set('name_mr')} error={errs.name_mr} />
          <Field label={t('common.name_en')} value={f.name_en} onChangeText={set('name_en')} error={errs.name_en} required />
          <Field label={t('parts.selling_price')} value={f.selling_price} onChangeText={set('selling_price')} keyboardType="decimal-pad" error={errs.selling_price} required />
          <Chips label={t('parts.gst_rate')} value={f.gst_rate} options={GST.map((g) => ({ value: g, label: `${g}%` }))} onChange={set('gst_rate')} />
          {canSeeCost ? (
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <View style={{ flex: 1 }}>
                <Field label={t('parts.last_purchase_price')} value={f.last_purchase_price} onChangeText={set('last_purchase_price')} keyboardType="decimal-pad" error={errs.last_purchase_price} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t('parts.last_purchase_disc')} value={f.last_purchase_disc_pct} onChangeText={set('last_purchase_disc_pct')} keyboardType="decimal-pad" error={errs.last_purchase_disc_pct} />
              </View>
            </View>
          ) : null}
        </Card>

        <Card style={{ gap: space[4] }}>
          {partId ? null : (
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <View style={{ flex: 1 }}>
                <Field label={t('parts.opening_stock')} value={f.opening_stock} onChangeText={set('opening_stock')} keyboardType="decimal-pad" error={errs.opening_stock} />
              </View>
              {canSeeCost ? (
                <View style={{ flex: 1 }}>
                  <Field label={t('parts.opening_cost')} value={f.opening_cost} onChangeText={set('opening_cost')} keyboardType="decimal-pad" error={errs.opening_cost} />
                </View>
              ) : null}
            </View>
          )}
          <Field label={t('parts.min_stock')} value={f.min_stock} onChangeText={set('min_stock')} keyboardType="decimal-pad" error={errs.min_stock} />
          {(locations.data ?? []).length ? (
            <Chips label={t('parts.location')} value={f.location_id} options={[none, ...(locations.data ?? []).map((l) => ({ value: l.id as number | null, label: nm(l) }))]} onChange={set('location_id')} />
          ) : null}
          <Field label={t('parts.rack')} value={f.rack} onChangeText={set('rack')} autoCapitalize="characters" placeholder="A1" error={errs.rack} />
          {(categories.data ?? []).length ? (
            <Chips label={t('parts.category')} value={f.category_id} options={[none, ...(categories.data ?? []).map((x) => ({ value: x.id as number | null, label: nm(x) }))]} onChange={set('category_id')} />
          ) : null}
        </Card>

        <Card style={{ gap: space[4] }}>
          <Field label={t('parts.brand')} value={f.brand} onChangeText={set('brand')} error={errs.brand} />
          <Field label={t('parts.compatible_models')} value={f.compatible_models} onChangeText={set('compatible_models')} hint={t('parts.compatible_hint')} error={errs.compatible_models} />
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <View style={{ flex: 1 }}>
              <Field label={t('parts.unit')} value={f.unit} onChangeText={set('unit')} error={errs.unit} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('parts.hsn')} value={f.hsn} onChangeText={set('hsn')} keyboardType="number-pad" error={errs.hsn} />
            </View>
          </View>
          {partId ? (
            <Segmented<number> value={f.active} onChange={set('active')} options={[{ value: 1, label: t('common.active') }, { value: 0, label: t('common.inactive') }]} />
          ) : null}
        </Card>
        <Button title={t('common.save')} icon={Check} onPress={() => void save()} loading={busy} needsOnline />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space[3], minHeight: 40, justifyContent: 'center' },
});
