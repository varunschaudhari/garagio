import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Check, Plus, Trash2, Undo2 } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/api/client';
import { useBillingMutation, useInvoice } from '@/api/queries';
import { PartPicker } from '@/components/pickers';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Field, IconButton, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { money, qty } from '@/format';
import { errorText, nm } from '@/i18n';
import { can, useSession } from '@/store/session';
import { radius, size, space, useTheme } from '@/theme';
import type { Invoice, InvoiceItem, Part } from '@/types';

type Mode = 'cash' | 'upi' | 'card' | 'bank';
type RefundMode = 'cash' | 'upi' | 'bank';
interface Change { qty: string; price: string; disc: string; remove: boolean }
interface Added { part: Part; qty: string; price: string }
interface Preview { old_total: number; total: number; paid: number; to_collect: number; to_refund: number; walk_in: boolean; credit_ok: boolean }

const n = (s: string) => s.trim().replace(',', '.');

function Small({ label, value, onChange, editable = true }: { label: string; value: string; onChange: (v: string) => void; editable?: boolean }) {
  const { c, font } = useTheme();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Txt size="xs" muted>{label}</Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={editable}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        style={[styles.small, { color: editable ? c.text : c.muted, borderColor: c.borderStrong, fontFamily: font('semibold'), backgroundColor: c.bg }]}
      />
    </View>
  );
}

/** The owner edits a final bill; it keeps its number. The server previews the new total and the money. */
export default function BillEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inv = useInvoice(Number(id));
  if (inv.isPending) return <Loading />;
  if (!inv.data) return null;
  return <BillEditBody inv={inv.data} />;
}

function BillEditBody({ inv }: { inv: Invoice }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const owner = can(useSession((s) => s.user), 'give_discount');
  const counter = inv.inv_type === 'counter';
  const walkIn = !inv.customer_id;
  const [changes, setChanges] = useState<Record<number, Change>>(() =>
    Object.fromEntries(inv.items.map((it) => [it.id, { qty: qty(it.qty), price: String(Number(it.unit_price)), disc: Number(it.disc_pct) ? String(Number(it.disc_pct)) : '', remove: false }]))
  );
  const [added, setAdded] = useState<Added[]>([]);
  const [billDisc, setBillDisc] = useState(Number(inv.bill_disc_pct) ? String(Number(inv.bill_disc_pct)) : '');
  const [walkName, setWalkName] = useState(inv.cust_name ?? '');
  const [walkPhone, setWalkPhone] = useState(inv.cust_phone ?? '');
  const [payMode, setPayMode] = useState<Mode>('cash');
  const [payAmt, setPayAmt] = useState('');
  const [refundMode, setRefundMode] = useState<RefundMode>('cash');
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [pick, setPick] = useState(false);
  const save = useBillingMutation((body: unknown) => api.put<{ item: Invoice }>(`/invoices/${inv.id}/edit`, body));

  const lines = useMemo(() => {
    const out: Record<string, unknown>[] = inv.items.map((it) => {
      const ch = changes[it.id];
      return { item_id: it.id, qty: it.item_type === 'part' ? n(ch.qty) : undefined, unit_price: n(ch.price), disc_pct: owner ? n(ch.disc) || 0 : undefined, remove: ch.remove || undefined };
    });
    for (const a of added) out.push({ part_id: a.part.id, qty: n(a.qty), unit_price: n(a.price), disc_pct: 0 });
    return out;
  }, [inv.items, changes, added, owner]);
  const base = useMemo(
    () => ({ lines, bill_disc_pct: owner ? n(billDisc) || 0 : undefined, ...(counter && walkIn ? { cust_name: walkName.trim(), cust_phone: walkPhone.trim() } : {}), refund_mode: refundMode }),
    [lines, billDisc, owner, counter, walkIn, walkName, walkPhone, refundMode]
  );
  const [key, setKey] = useState(JSON.stringify(base));
  useEffect(() => {
    const timer = setTimeout(() => setKey(JSON.stringify(base)), 350);
    return () => clearTimeout(timer);
  }, [base]);
  const preview = useQuery({
    queryKey: ['bill-edit-preview', inv.id, key],
    queryFn: () => api.post<Preview>(`/invoices/${inv.id}/edit/preview`, JSON.parse(key)),
    retry: false,
    placeholderData: (p) => p,
  });
  const p = preview.data;
  const needPay = !!p && p.to_collect > 0.004;

  const set = (itemId: number, patch: Partial<Change>) => setChanges((cs) => ({ ...cs, [itemId]: { ...cs[itemId], ...patch } }));

  const submit = async () => {
    if (!reason.trim()) return setReasonErr(t('fields.required'));
    // An amount that must be collected now is filled in for them.
    const amt = Number(n(payAmt)) || (p && (walkIn || !p.credit_ok) ? p.to_collect : 0);
    const body = { ...base, reason: reason.trim(), ...(needPay && amt > 0 ? { payment: { mode: payMode, amount: amt } } : {}) };
    try {
      await save.mutateAsync(body);
      toast(t('billing.edited'));
      router.back();
    } catch (e) {
      toastError(e);
    }
  };

  let moneyText = t('billing.edit_same');
  if (p) {
    if (p.to_refund > 0) moneyText = t('billing.edit_refund', { amount: money(p.to_refund) });
    else if (p.to_collect > 0) moneyText = p.credit_ok && !walkIn ? t('billing.edit_credit', { amount: money(p.to_collect) }) : t('billing.edit_collect', { amount: money(p.to_collect) });
    else if (p.total < p.paid - 0.004 && !walkIn) moneyText = t('billing.edit_advance', { amount: money(p.paid - p.total) });
  }

  const row = (it: InvoiceItem) => {
    const ch = changes[it.id];
    return (
      <Card key={it.id} style={[{ gap: space[2] }, ch.remove && { opacity: 0.5 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <View style={{ flex: 1 }}>
            <Txt weight="semibold" numberOfLines={2}>{it.description_en}</Txt>
            {it.part_no ? <Txt size="sm" muted>{it.part_no}</Txt> : null}
          </View>
          <IconButton icon={ch.remove ? Undo2 : Trash2} label={t('billing.edit_remove')} color={ch.remove ? c.primaryText : c.dangerText} onPress={() => set(it.id, { remove: !ch.remove })} />
        </View>
        {ch.remove ? null : (
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <Small label={t('inv.qty')} value={it.item_type === 'part' ? ch.qty : '1'} onChange={(v) => set(it.id, { qty: v })} editable={it.item_type === 'part'} />
            <Small label={t('inv.mrp')} value={ch.price} onChange={(v) => set(it.id, { price: v })} />
            {owner ? <Small label={t('inv.disc')} value={ch.disc} onChange={(v) => set(it.id, { disc: v })} /> : null}
          </View>
        )}
      </Card>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: t('billing.edit_title', { no: inv.invoice_no ?? '' }) }} />
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3], paddingBottom: space[10] }} keyboardShouldPersistTaps="handled">
        <Banner text={`${t('billing.edit_note')}${counter ? '' : ' ' + t('billing.edit_job_qty')}`} />
        {inv.items.map(row)}
        {added.map((a, i) => (
          <Card key={`a${i}`} style={{ gap: space[2] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <View style={{ flex: 1 }}>
                <Txt weight="semibold" numberOfLines={2}>{nm(a.part)}</Txt>
                <Txt size="sm" muted>{a.part.part_no} · {t('purchases.new_tag')}</Txt>
              </View>
              <IconButton icon={Trash2} label={t('billing.edit_remove')} color={c.dangerText} onPress={() => setAdded((as) => as.filter((_, j) => j !== i))} />
            </View>
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Small label={t('inv.qty')} value={a.qty} onChange={(v) => setAdded((as) => as.map((x, j) => (j === i ? { ...x, qty: v } : x)))} />
              <Small label={t('inv.mrp')} value={a.price} onChange={(v) => setAdded((as) => as.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
            </View>
          </Card>
        ))}
        {counter ? <Button title={t('billing.edit_add_part')} icon={Plus} variant="secondary" onPress={() => setPick(true)} /> : null}

        <Card style={{ gap: space[3] }}>
          {owner ? <Field label={t('billing.bill_discount')} value={billDisc} onChangeText={setBillDisc} keyboardType="decimal-pad" /> : null}
          {counter && walkIn ? (
            <>
              <Field label={t('billing.walk_in_name')} value={walkName} onChangeText={setWalkName} />
              <Field label={t('billing.walk_in_phone')} value={walkPhone} onChangeText={setWalkPhone} keyboardType="phone-pad" />
            </>
          ) : null}
        </Card>

        <Card style={{ gap: space[2] }}>
          {preview.isError ? (
            <Txt color="dangerText" weight="semibold">{errorText(preview.error)}</Txt>
          ) : p ? (
            <>
              <View style={styles.kv}><Txt muted>{t('billing.edit_old_total')}</Txt><Txt tabular>{money(p.old_total)}</Txt></View>
              <View style={styles.kv}><Txt weight="bold">{t('billing.edit_new_total')}</Txt><Txt weight="bold" size="lg" tabular>{money(p.total)}</Txt></View>
              <Txt weight="semibold">{moneyText}</Txt>
            </>
          ) : (
            <Loading />
          )}
          {needPay ? (
            <View style={{ gap: space[2] }}>
              <Segmented<Mode> value={payMode} onChange={setPayMode} options={(['cash', 'upi', 'card', 'bank'] as const).map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
              <Field label={`${t('common.amount')} (₹)`} value={payAmt} onChangeText={setPayAmt} keyboardType="decimal-pad" placeholder={p && (!p.credit_ok || walkIn) ? String(p.to_collect) : ''} />
            </View>
          ) : null}
          {p && p.to_refund > 0 ? (
            <Segmented<RefundMode> value={refundMode} onChange={setRefundMode} options={(['cash', 'upi', 'bank'] as const).map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
          ) : null}
        </Card>

        <Field label={t('billing.edit_reason')} value={reason} onChangeText={(v) => { setReason(v); setReasonErr(''); }} error={reasonErr} required />
        <Button title={t('billing.edit_save')} icon={Check} onPress={() => void submit()} loading={save.isPending} disabled={preview.isError} needsOnline />
      </ScrollView>
      <PartPicker
        visible={pick}
        onClose={() => setPick(false)}
        onPick={(part) => {
          setAdded((as) => [...as, { part, qty: '1', price: String(Number(part.selling_price)) }]);
          setPick(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  small: { borderWidth: 1, borderRadius: radius.input, minHeight: 48, textAlign: 'center', fontSize: size.lg },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
