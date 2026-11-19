import { useQuery } from '@tanstack/react-query';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Check, FileSpreadsheet, Plus, ScanLine, Store, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api, ApiError } from '@/api/client';
import { useSavePurchase } from '@/api/queries';
import { BillPhotoPicker, uploadBillPhoto } from '@/components/billPhoto';
import { DateField, isoDay } from '@/components/dateField';
import { PartPicker, SupplierPicker } from '@/components/pickers';
import { SupplierFormSheet } from '@/components/supplierForm';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Chip, Field, IconButton, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { pickSheet, SheetReadError } from '@/excel';
import { money, qty } from '@/format';
import { errorText, nm } from '@/i18n';
import { useScan } from '@/store/scan';
import { radius, size, space, useTheme } from '@/theme';
import type { Part, PayMode, PriceMode, Purchase, PurchasePreview, Supplier } from '@/types';

const GST = [0, 5, 12, 18, 28, 40];
const MODES: PayMode[] = ['credit', 'cash', 'upi', 'bank'];

/** A part from the supplier's Excel that is not in the list yet: added when the bill is saved. */
interface NewPart {
  part_no: string;
  name_en: string;
  name_mr: string | null;
  hsn: string | null;
  unit: string;
  gst_rate: number;
}

interface ImportLine {
  part: Part | null;
  new_part: NewPart | null;
  qty: number;
  price: number | null;
  disc_pct: number;
  gst_rate: number;
  mrp: number | null;
}

interface Line {
  key: number;
  part: Part;
  newPart?: NewPart;
  qty: string;
  mrp: string;
  price: string;
  disc: string;
  gst: number;
  /** MRP bills: the rate follows the MRP until someone types a different rate. */
  follow: boolean;
}

/** The rate a line starts with: the MRP on MRP bills, the last price without GST on net bills. */
function startPrice(l: Line, mode: PriceMode): Line {
  return mode === 'mrp' ? { ...l, price: l.mrp, follow: true } : { ...l, price: l.part.last_purchase_price ? String(l.part.last_purchase_price) : '', follow: false };
}

let lineSeq = 0;

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
  const params = useLocalSearchParams<{ supplier?: string; replace?: string }>();
  const replaceId = Number(params.replace || 0);
  const [old, setOld] = useState<Purchase | null>(null);
  const save = useSavePurchase();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [billNo, setBillNo] = useState('');
  const today = isoDay(new Date());
  const [billDate, setBillDate] = useState(today);
  const [mode, setMode] = useState<PayMode>('credit');
  const [priceMode, setPriceMode] = useState<PriceMode>('mrp');
  const [photo, setPhoto] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [pickSupplier, setPickSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState(false);
  const [pickPart, setPickPart] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [badLines, setBadLines] = useState<Set<number>>(new Set());

  // Correcting a bill: start from its supplier (fixed), number, date and lines.
  useEffect(() => {
    if (!replaceId) return;
    let live = true;
    (async () => {
      const p = (await api.get<{ item: Purchase }>(`/purchases/${replaceId}`)).item;
      const [s, parts] = await Promise.all([
        api.get<{ item: Supplier }>(`/suppliers/${p.supplier_id}`).then((r) => r.item),
        Promise.all(p.items.map((it) => api.get<{ item: Part }>(`/parts/${it.part_id}`).then((r) => r.item))),
      ]);
      if (!live) return;
      setOld(p);
      setSupplier(s);
      setBillNo(p.bill_no);
      setBillDate(p.bill_date);
      setMode(p.payment_mode);
      setPriceMode(p.price_mode);
      setOther(Number(p.other_charges) ? String(p.other_charges) : '');
      setLines(
        p.items.map((it, i) => {
          const mrp = Number(it.mrp) ? String(Number(it.mrp)) : '';
          const price = String(Number(it.price));
          return {
            key: ++lineSeq,
            part: parts[i],
            qty: String(Number(it.qty)),
            mrp,
            price,
            disc: Number(it.disc_pct) ? String(Number(it.disc_pct)) : '',
            gst: Number(it.gst_rate),
            follow: p.price_mode === 'mrp' && price === mrp,
          };
        })
      );
    })().catch(toastError);
    return () => {
      live = false;
    };
  }, [replaceId]);

  useEffect(() => {
    if (!params.supplier) return;
    api.get<{ item: Supplier }>(`/suppliers/${Number(params.supplier)}`).then((r) => setSupplier(r.item)).catch(() => {});
  }, [params.supplier]);

  const addPart = useCallback(
    (p: Part) => {
      const line: Line = {
        key: ++lineSeq,
        part: p,
        qty: '1',
        mrp: Number(p.selling_price) ? String(Number(p.selling_price)) : '',
        price: '',
        disc: p.last_purchase_disc_pct ? String(p.last_purchase_disc_pct) : '',
        gst: Number(p.gst_rate),
        follow: true,
      };
      setLines((ls) => [...ls, startPrice(line, priceMode)]);
    },
    [priceMode]
  );

  // The supplier's bill as Excel: its lines are added here; parts not in the list yet are added on save.
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState('');
  const importExcel = async () => {
    setImporting(true);
    try {
      const sheet = await pickSheet();
      if (!sheet) return;
      if (!sheet.rows.length) return toast(t('parts.import_empty'), 'error');
      const res = await api.post<{ lines: ImportLine[]; errors: { row: number; name: string }[]; unused_columns: string[] }>('/purchases/import-lines', { rows: sheet.rows });
      const added: Line[] = res.lines.map((l) => {
        const part: Part = l.part ?? ({
          id: 0, part_no: l.new_part?.part_no || t('purchases.new_tag'), name_en: l.new_part?.name_en ?? '', name_mr: l.new_part?.name_mr ?? null,
          unit: l.new_part?.unit ?? 'pcs', hsn: l.new_part?.hsn ?? null, gst_rate: l.gst_rate, selling_price: 0, current_stock: 0, min_stock: 0,
          category_id: null, category_en: null, category_mr: null, location_id: null, location_en: null, location_mr: null, rack: null,
          brand: null, compatible_models: null, is_low: 0, active: 1,
        } as Part);
        const mrp = l.mrp ?? (l.part ? Number(l.part.selling_price) : null);
        const price = l.price ?? (priceMode === 'mrp' ? mrp : (l.part?.last_purchase_price ?? null));
        const mrpS = mrp ? String(mrp) : '';
        const priceS = price !== null && price !== undefined ? String(price) : '';
        return {
          key: ++lineSeq, part, newPart: l.new_part ?? undefined, qty: String(l.qty), mrp: mrpS, price: priceS,
          disc: l.disc_pct ? String(l.disc_pct) : '', gst: Number(l.gst_rate), follow: priceMode === 'mrp' && priceS === mrpS,
        };
      });
      setLines((ls) => [...ls, ...added]);
      const fresh = res.lines.filter((l) => !l.part).length;
      toast(t('purchases.imported', { n: res.lines.length, file: sheet.name }));
      setImportNote(
        [
          fresh ? t('purchases.import_new_parts', { n: fresh }) : '',
          res.errors.length ? t('purchases.import_skipped', { list: res.errors.map((x) => x.name).join(', ') }) : '',
          res.unused_columns.length ? t('parts.import_unused', { list: res.unused_columns.join(', ') }) : '',
        ].filter(Boolean).join(' · ')
      );
    } catch (e) {
      if (e instanceof SheetReadError) toast(t('parts.import_read_error'), 'error');
      else toastError(e);
    } finally {
      setImporting(false);
    }
  };

  const changePriceMode = (m: PriceMode) => {
    setPriceMode(m);
    setLines((ls) => ls.map((l) => startPrice(l, m)));
  };

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
      price_mode: priceMode,
      items: valid.map((l) => ({ ...(l.newPart ? { new_part: l.newPart } : { part_id: l.part.id }), qty: l.qty, price: l.price || 0, disc_pct: l.disc || 0, gst_rate: l.gst, mrp: l.mrp })),
    }),
    [supplier, other, valid, priceMode]
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
    const iso = billDate;
    if (!supplier) e.supplier = t('fields.required');
    if (!billNo.trim()) e.bill_no = t('fields.required');
    if (!valid.length) e.items = t('purchases.no_lines');
    setErrs(e);
    if (Object.keys(e).length) return;
    try {
      const res = await save.mutateAsync({ ...payload, bill_no: billNo.trim(), bill_date: iso, payment_mode: mode, ...(old ? { replaces_id: old.id, notes: old.notes ?? '' } : {}) });
      toast(old ? t('purchases.corrected') : t('purchases.saved'));
      if (photo) await uploadBillPhoto(`/purchases/${res.item.id}/photo`, photo).catch(toastError);
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
      {replaceId ? <Stack.Screen options={{ title: old ? t('purchases.correct_title', { bill: old.bill_no }) : t('purchases.correct') }} /> : null}
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }} keyboardShouldPersistTaps="handled">
        {old ? <Banner text={t('purchases.correct_note')} /> : null}
        <Card style={{ gap: space[4] }}>
          <View style={{ gap: 6 }}>
            <Txt size="sm" weight="semibold">
              {t('purchases.supplier')}
              <Txt color="danger"> *</Txt>
            </Txt>
            <Pressable
              onPress={() => setPickSupplier(true)}
              disabled={!!replaceId}
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
                    {[supplier.contact_person, supplier.phone, supplier.gstin || supplier.state_code, `${t('suppliers.balance')} ${money(supplier.balance)}`].filter(Boolean).join(' · ')}
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
          <DateField label={t('purchases.bill_date')} value={billDate} onChange={(v) => v && setBillDate(v)} max={today} required error={errs.bill_date} />
          <View style={{ gap: 6 }}>
            <Txt size="sm" weight="semibold">
              {t('purchases.payment_mode')}
            </Txt>
            <Segmented<PayMode> value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
          </View>
          <View style={{ gap: 6 }}>
            <Txt size="sm" weight="semibold">
              {t('purchases.price_mode')}
            </Txt>
            <Segmented<PriceMode> value={priceMode} onChange={changePriceMode} options={(['mrp', 'net'] as const).map((m) => ({ value: m, label: t(`purchases.mode_${m}`) }))} />
            <Txt size="xs" muted>
              {t('purchases.mrp_hint')}
            </Txt>
          </View>
          <BillPhotoPicker uri={photo} onChange={setPhoto} />
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
                  {l.newPart ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
                      <Chip label={t('purchases.new_tag')} tone="warning" />
                      <Txt size="sm" muted style={{ flex: 1 }}>{t('purchases.new_part_note')}</Txt>
                    </View>
                  ) : (
                    <Txt size="sm" muted>
                      {l.part.part_no} · {t('purchases.in_stock')} {qty(l.part.current_stock)}
                    </Txt>
                  )}
                </View>
                <IconButton icon={Trash2} label={t('purchases.remove_line')} color={c.dangerText} onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
              </View>
              <View style={{ flexDirection: 'row', gap: space[2] }}>
                <SmallInput label={t('purchases.qty')} value={l.qty} onChange={(v) => update(l.key, { qty: v })} invalid={bad && !(num(l.qty) > 0)} />
                <SmallInput label={t('purchases.mrp')} value={l.mrp} onChange={(v) => update(l.key, l.follow ? { mrp: v, price: v } : { mrp: v })} />
              </View>
              <View style={{ flexDirection: 'row', gap: space[2] }}>
                <SmallInput
                  label={t(priceMode === 'mrp' ? 'purchases.rate_incl' : 'purchases.rate_excl')}
                  value={l.price}
                  onChange={(v) => update(l.key, { price: v, follow: priceMode === 'mrp' && v === l.mrp })}
                />
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
        <Button title={t('purchases.import_excel')} icon={FileSpreadsheet} variant="secondary" onPress={() => void importExcel()} loading={importing} needsOnline />
        {importNote ? <Banner tone="warning" text={importNote} /> : null}

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
        onNew={() => {
          setPickSupplier(false);
          setNewSupplier(true);
        }}
      />
      {newSupplier ? (
        <SupplierFormSheet
          onClose={() => setNewSupplier(false)}
          onSaved={(s) => {
            setSupplier(s);
            setNewSupplier(false);
            setErrs((e) => ({ ...e, supplier: '' }));
          }}
        />
      ) : null}
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
