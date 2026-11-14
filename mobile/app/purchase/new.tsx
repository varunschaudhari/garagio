import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Check, Plus, ScanLine, Store, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api, ApiError } from '@/api/client';
import { useSavePurchase } from '@/api/queries';
import { PartPicker, SupplierPicker } from '@/components/pickers';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Field, IconButton, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { money, qty } from '@/format';
import { errorText, nm } from '@/i18n';
import { useScan } from '@/store/scan';
import { radius, size, space, useTheme } from '@/theme';
import type { Part, PayMode, PurchasePreview, Supplier } from '@/types';

const GST = [0, 5, 12, 18, 28, 40];
const MODES: PayMode[] = ['credit', 'cash', 'upi', 'bank'];

interface Line {
  key: number;
  part: Part;
  qty: string;
  price: string;
  disc: string;
  gst: number;
}

let lineSeq = 0;

function todayDMY() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** "13-11-2026" → "2026-11-13" (null if not a real date) */
function dmyToIso(s: string): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

const num = (s: string) => Number(s.replace(',', '.'));

function SmallInput({ label, value, onChange, invalid }: { label: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const { c, font } = useTheme();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Txt size="xs" muted>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        style={[styles.small, { color: c.text, borderColor: invalid ? c.danger : c.borderStrong, fontFamily: font('semibold'), backgroundColor: c.bg }]}
      />
    </View>
  );
}

export default function NewPurchase() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const params = useLocalSearchParams<{ supplier?: string }>();
  const save = useSavePurchase();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayDMY());
  const [mode, setMode] = useState<PayMode>('credit');
  const [other, setOther] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [pickSupplier, setPickSupplier] = useState(false);
  const [pickPart, setPickPart] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [badLines, setBadLines] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!params.supplier) return;
    api.get<{ item: Supplier }>(`/suppliers/${Number(params.supplier)}`).then((r) => setSupplier(r.item)).catch(() => {});
  }, [params.supplier]);

  const addPart = useCallback((p: Part) => {
    setLines((ls) => [
      ...ls,
      {
        key: ++lineSeq,
        part: p,
        qty: '1',
        price: p.last_purchase_price ? String(p.last_purchase_price) : '',
        disc: p.last_purchase_disc_pct ? String(p.last_purchase_disc_pct) : '',
        gst: Number(p.gst_rate),
      },
    ]);
  }, []);

  // A part scanned with the camera (mode=pick) arrives when this screen is focused again.
  useFocusEffect(
    useCallback(() => {
      const code = useScan.getState().take();
      if (!code) return;
      api
        .get<{ item: Part }>(`/parts/by-code/${encodeURIComponent(code)}`)
        .then((r) => addPart(r.item))
        .catch(() => toast(t('mobile.scanned_unknown', { code }), 'error'));
    }, [addPart, t])
  );

  const update = (key: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setBadLines((b) => {
      const n = new Set(b);
      n.delete(key);
      return n;
    });
  };

  const valid = lines.filter((l) => num(l.qty) > 0);
  const payload = useMemo(
    () => ({
      supplier_id: supplier?.id,
      other_charges: other || 0,
      items: valid.map((l) => ({ part_id: l.part.id, qty: l.qty, price: l.price || 0, disc_pct: l.disc || 0, gst_rate: l.gst })),
    }),
    [supplier, other, valid]
  );

  const preview = useQuery({
    queryKey: ['purchase-preview', JSON.stringify(payload)],
    queryFn: () => api.post<PurchasePreview>('/purchases/preview', payload),
    enabled: !!supplier && valid.length > 0,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: Infinity,
  });

  const lineTotal = (key: number) => {
    const i = valid.findIndex((l) => l.key === key);
    return i >= 0 ? preview.data?.lines[i]?.line_total : undefined;
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    const iso = dmyToIso(billDate);
    if (!supplier) e.supplier = t('fields.required');
    if (!billNo.trim()) e.bill_no = t('fields.required');
    if (!iso) e.bill_date = t('fields.invalid_date');
    if (!valid.length) e.items = t('purchases.no_lines');
    setErrs(e);
    if (Object.keys(e).length) return;
    try {
      const res = await save.mutateAsync({ ...payload, bill_no: billNo.trim(), bill_date: iso, payment_mode: mode });
      toast(t('purchases.saved'));
      router.replace(`/purchase/${res.item.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'duplicate_bill') {
        setErrs({ bill_no: errorText(err) });
        return;
      }
      if (err instanceof ApiError) {
        const bad = new Set<number>();
        for (const k of Object.keys(err.fields)) {
          const m = /^items\.(\d+)/.exec(k);
          const l = m ? valid[Number(m[1])] : undefined;
          if (l) bad.add(l.key);
        }
        setBadLines(bad);
      }
      toastError(err);
    }
  };

  const tot = preview.data?.totals;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space[4] }}>
          <View style={{ gap: 6 }}>
            <Txt size="sm" weight="semibold">
              {t('purchases.supplier')}
              <Txt color="danger"> *</Txt>
            </Txt>
            <Pressable
              onPress={() => setPickSupplier(true)}
              accessibilityRole="button"
              style={[styles.picker, { borderColor: errs.supplier ? c.danger : c.borderStrong, backgroundColor: c.surface }]}
            >
              <Store size={20} color={c.muted} />
              <View style={{ flex: 1 }}>
                <Txt weight={supplier ? 'semibold' : 'regular'} color={supplier ? 'text' : 'muted'} numberOfLines={1}>
                  {supplier ? supplier.name : t('purchases.choose_supplier')}
                </Txt>
                {supplier ? (
                  <Txt size="sm" muted>
                    {supplier.gstin || supplier.state_code} · {t('suppliers.balance')} {money(supplier.balance)}
                  </Txt>
                ) : null}
              </View>
            </Pressable>
            {errs.supplier ? (
              <Txt size="sm" color="dangerText">
                {errs.supplier}
              </Txt>
            ) : null}
          </View>
          <Field label={t('purchases.bill_no')} value={billNo} onChangeText={setBillNo} autoCapitalize="characters" error={errs.bill_no} required />
          <Field label={t('purchases.bill_date')} value={billDate} onChangeText={setBillDate} keyboardType="numbers-and-punctuation" hint="DD-MM-YYYY" error={errs.bill_date} />
          <View style={{ gap: 6 }}>
            <Txt size="sm" weight="semibold">
              {t('purchases.payment_mode')}
            </Txt>
            <Segmented<PayMode> value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
          </View>
        </Card>

        {preview.data?.interstate ? <Banner text={t('purchases.interstate_note')} /> : null}

        {lines.map((l, i) => {
          const bad = badLines.has(l.key);
          const total = lineTotal(l.key);
          return (
            <Card key={l.key} style={[{ gap: space[3] }, bad && { borderColor: c.danger }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" numberOfLines={2}>
                    {i + 1}. {nm(l.part)}
                  </Txt>
                  <Txt size="sm" muted>
                    {l.part.part_no} · {t('purchases.in_stock')} {qty(l.part.current_stock)}
                  </Txt>
                </View>
                <IconButton icon={Trash2} label={t('purchases.remove_line')} color={c.dangerText} onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
              </View>
              <View style={{ flexDirection: 'row', gap: space[2] }}>
                <SmallInput label={t('purchases.qty')} value={l.qty} onChange={(v) => update(l.key, { qty: v })} invalid={bad && !(num(l.qty) > 0)} />
                <SmallInput label={t('purchases.price')} value={l.price} onChange={(v) => update(l.key, { price: v })} />
                <SmallInput label={t('purchases.disc')} value={l.disc} onChange={(v) => update(l.key, { disc: v })} />
              </View>
              <View style={styles.gstRow}>
                <Txt size="xs" muted>
                  {t('purchases.gst')}
                </Txt>
                {GST.map((g) => (
                  <Pressable
                    key={g}
                    onPress={() => update(l.key, { gst: g })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: l.gst === g }}
                    style={[styles.gstChip, { borderColor: l.gst === g ? c.primary : c.borderStrong, backgroundColor: l.gst === g ? c.primarySoft : c.surface }]}
                  >
                    <Txt size="sm" weight="semibold">
                      {g}%
                    </Txt>
                  </Pressable>
                ))}
              </View>
              {total !== undefined ? (
                <Txt weight="bold" tabular style={{ textAlign: 'right' }}>
                  {money(total)}
                </Txt>
              ) : null}
            </Card>
          );
        })}

        {errs.items ? <Banner tone="danger" text={errs.items} /> : null}
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={t('purchases.add_line')} icon={Plus} variant="secondary" onPress={() => setPickPart(true)} style={{ flex: 1 }} />
          <Button title={t('mobile.scan')} icon={ScanLine} variant="secondary" onPress={() => router.push({ pathname: '/scan', params: { mode: 'pick' } })} />
        </View>

        <Card style={{ gap: space[2] }}>
          <Row label={t('purchases.taxable')} value={money(tot?.taxable_total)} />
          {preview.data?.interstate ? (
            <Row label={t('purchases.igst')} value={money(tot?.igst)} />
          ) : (
            <>
              <Row label={t('purchases.cgst')} value={money(tot?.cgst)} />
              <Row label={t('purchases.sgst')} value={money(tot?.sgst)} />
            </>
          )}
          <Field label={t('purchases.other_charges')} value={other} onChangeText={setOther} keyboardType="numbers-and-punctuation" />
          <Row label={t('purchases.round_off')} value={money(tot?.round_off)} />
          <View style={styles.totalRow}>
            <Txt size="lg" weight="bold">
              {t('purchases.total')}
            </Txt>
            <Txt size="xl" weight="bold" tabular>
              {money(tot?.grand_total)}
            </Txt>
          </View>
        </Card>
        <Button title={t('purchases.save')} icon={Check} onPress={submit} loading={save.isPending} needsOnline />
      </ScrollView>

      <SupplierPicker
        visible={pickSupplier}
        onClose={() => setPickSupplier(false)}
        onPick={(s) => {
          setSupplier(s);
          setPickSupplier(false);
          setErrs((e) => ({ ...e, supplier: '' }));
        }}
      />
      <PartPicker
        visible={pickPart}
        onClose={() => setPickPart(false)}
        onPick={(p) => {
          addPart(p);
          setPickPart(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalRow}>
      <Txt muted>{label}</Txt>
      <Txt tabular weight="semibold">
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], paddingVertical: space[3], minHeight: 56 },
  small: { borderWidth: 1, borderRadius: radius.input, minHeight: 48, textAlign: 'center', fontSize: size.lg },
  gstRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  gstChip: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space[3], minHeight: 36, justifyContent: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
