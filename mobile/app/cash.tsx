import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2, Undo2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Button, Card, Divider, Field, IconButton, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { date, datetime, money } from '@/format';
import { useSession } from '@/store/session';
import { space, useTheme } from '@/theme';

type Mode = 'cash' | 'upi' | 'bank';
const CATS = ['tea_snacks', 'fuel', 'electricity', 'rent', 'tools', 'salary', 'repairs', 'transport', 'other'] as const;

interface Expense {
  id: number;
  category: string;
  amount: number;
  mode: Mode;
  note: string | null;
  user_name: string | null;
}
interface CashClose {
  opening: number;
  expected: number;
  counted: number;
  difference: number;
  taken_out: number;
  note: string | null;
  user_name: string | null;
  created_at: string;
}
interface CashDay {
  date: string;
  opening: number;
  opening_from: string | null;
  in: { customer_payments: number };
  out: { refunds: number; supplier_payments: number; expenses: number; mechanic_payments: number };
  expected: number;
  other_modes: Record<string, number>;
  expenses: Expense[];
  expenses_total: number;
  close: CashClose | null;
}

const num = (s: string) => Number(s.replace(',', '.')) || 0;
function isoToday() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: 'dangerText' | 'successText' | 'warningText' }) {
  return (
    <View style={styles.kv}>
      <Txt muted={!strong} weight={strong ? 'bold' : 'regular'} style={{ flex: 1 }}>{label}</Txt>
      <Txt tabular weight={strong ? 'bold' : 'semibold'} color={color}>{value}</Txt>
    </View>
  );
}

/** Cash book on the phone: today's drawer, expenses, and the count at closing. */
export default function CashScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const qc = useQueryClient();
  const owner = useSession((s) => s.user?.role === 'owner');
  const day = isoToday();
  const q = useQuery({ queryKey: ['cash-day', day], queryFn: () => api.get<CashDay>('/cash/day', { date: day }) });
  const [sheet, setSheet] = useState(false);
  const [cat, setCat] = useState<(typeof CATS)[number]>('tea_snacks');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<Mode>('cash');
  const [note, setNote] = useState('');
  const [counted, setCounted] = useState('');
  const [takenOut, setTakenOut] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = (d?: CashDay) => {
    if (d) qc.setQueryData(['cash-day', day], d);
    else void qc.invalidateQueries({ queryKey: ['cash-day'] });
    void qc.invalidateQueries({ queryKey: ['reports'] });
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (q.isPending) return <Loading />;
  if (!q.data) return null;
  const d = q.data;
  const cl = d.close;
  const expected = cl ? cl.expected : d.expected + (d.opening_from ? 0 : num(opening));
  const diffOf = (v: number) => {
    const r = Math.round(v * 100) / 100;
    if (Math.abs(r) < 0.005) return { text: t('cash.exact'), color: 'successText' as const };
    return r < 0 ? { text: t('cash.short', { amount: money(-r) }), color: 'dangerText' as const } : { text: t('cash.extra', { amount: money(r) }), color: 'warningText' as const };
  };
  const live = counted.trim() ? diffOf(num(counted) - expected) : null;
  const other = Object.entries(d.other_modes).map(([m, v]) => `${t(`pay.${m}`)} ${money(v)}`).join(' · ');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} colors={[c.primary]} />}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: space[2] }}>
          <Txt weight="bold">{t('cash.drawer')} · {date(d.date)}</Txt>
          <Row label={t('cash.opening')} value={money(cl ? cl.opening : d.opening)} />
          {!cl ? <Txt size="xs" muted>{d.opening_from ? t('cash.opening_from', { date: date(d.opening_from) }) : t('cash.opening_first')}</Txt> : null}
          <Row label={t('cash.in_customer_payments')} value={money(d.in.customer_payments)} />
          {(['refunds', 'supplier_payments', 'expenses', 'mechanic_payments'] as const).map((k) => (
            <Row key={k} label={t(`cash.out_${k}`)} value={money(d.out[k])} />
          ))}
          <Divider />
          <Row label={t('cash.expected')} value={money(expected)} strong />
          {other ? <Txt size="sm" muted>{t('cash.other_modes', { list: other })}</Txt> : null}
        </Card>

        {cl ? (
          <Card style={{ gap: space[2] }}>
            <Txt weight="bold">{t('cash.close')}</Txt>
            <Row label={t('cash.counted')} value={money(cl.counted)} strong />
            <Row label={t('cash.difference')} value={diffOf(cl.difference).text} color={diffOf(cl.difference).color} />
            <Row label={t('cash.taken_out')} value={money(cl.taken_out)} />
            <Row label={t('cash.kept')} value={money(cl.counted - cl.taken_out)} />
            {cl.note ? <Txt size="sm">{cl.note}</Txt> : null}
            <Txt size="sm" muted>{t('cash.closed_by', { name: cl.user_name ?? '—', time: datetime(cl.created_at) })}</Txt>
            {owner ? (
              <Button
                title={t('cash.reopen')}
                icon={Undo2}
                variant="ghost"
                small
                needsOnline
                onPress={() =>
                  Alert.alert(t('cash.reopen'), t('cash.reopen_q'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('cash.reopen'), style: 'destructive', onPress: () => void run(async () => { refresh(await api.del<CashDay>(`/cash/close/${day}`)); toast(t('cash.reopened')); }) },
                  ])
                }
              />
            ) : null}
          </Card>
        ) : (
          <Card style={{ gap: space[3] }}>
            <Txt weight="bold">{t('cash.close')}</Txt>
            <Txt size="sm" muted>{t('cash.close_hint')}</Txt>
            {!d.opening_from ? <Field label={`${t('cash.opening')} (₹)`} value={opening} onChangeText={setOpening} keyboardType="decimal-pad" /> : null}
            <Field label={`${t('cash.counted')} (₹)`} value={counted} onChangeText={setCounted} keyboardType="decimal-pad" required />
            {live ? <Txt weight="bold" color={live.color}>{t('cash.difference')}: {live.text}</Txt> : null}
            <Field label={`${t('cash.taken_out')} (₹)`} value={takenOut} onChangeText={setTakenOut} keyboardType="decimal-pad" />
            <Button
              title={t('cash.save_close')}
              icon={Check}
              loading={busy}
              disabled={!counted.trim()}
              needsOnline
              onPress={() =>
                void run(async () => {
                  refresh(await api.post<CashDay>('/cash/close', { date: day, counted: num(counted), taken_out: num(takenOut), ...(d.opening_from ? {} : { opening: num(opening) }) }));
                  toast(t('cash.closed_ok'));
                })
              }
            />
          </Card>
        )}

        <Card style={{ gap: space[2] }}>
          <View style={styles.kv}>
            <Txt weight="bold" style={{ flex: 1 }}>{t('cash.expenses')}</Txt>
            <Txt weight="bold" tabular>{money(d.expenses_total)}</Txt>
          </View>
          {d.expenses.length ? (
            d.expenses.map((e) => (
              <View key={e.id} style={[styles.kv, { gap: space[2] }]}>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold">{t(`cash.cat.${e.category}`)}{e.note ? ` · ${e.note}` : ''}</Txt>
                  <Txt size="sm" muted>{t(`pay.${e.mode}`)} · {e.user_name ?? ''}</Txt>
                </View>
                <Txt tabular weight="semibold">{money(e.amount)}</Txt>
                {!cl ? (
                  <IconButton
                    icon={Trash2}
                    label={t('common.delete')}
                    color={c.dangerText}
                    onPress={() =>
                      Alert.alert(t('cash.delete_q'), '', [
                        { text: t('common.cancel'), style: 'cancel' },
                        { text: t('common.delete'), style: 'destructive', onPress: () => void run(async () => { await api.del(`/expenses/${e.id}`); refresh(); }) },
                      ])
                    }
                  />
                ) : null}
              </View>
            ))
          ) : (
            <Txt size="sm" muted>{t('cash.no_expenses')}</Txt>
          )}
          {!cl ? <Button title={t('cash.add_expense')} icon={Plus} variant="secondary" onPress={() => { setAmount(''); setNote(''); setSheet(true); }} needsOnline /> : null}
        </Card>
      </ScrollView>

      {sheet ? (
        <Sheet visible onClose={() => setSheet(false)} title={t('cash.add_expense')}>
          <Txt size="sm" weight="semibold">{t('cash.category')}</Txt>
          <View style={styles.chips}>
            {CATS.map((k) => (
              <Button key={k} title={t(`cash.cat.${k}`)} small variant={cat === k ? 'primary' : 'secondary'} onPress={() => setCat(k)} />
            ))}
          </View>
          <Field label={`${t('common.amount')} (₹)`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus required />
          <Segmented<Mode> value={mode} onChange={setMode} options={(['cash', 'upi', 'bank'] as const).map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
          <Field label={t('common.notes')} value={note} onChangeText={setNote} />
          <Button
            title={t('common.save')}
            icon={Check}
            loading={busy}
            disabled={!(num(amount) > 0)}
            needsOnline
            onPress={() =>
              void run(async () => {
                await api.post('/expenses', { spent_on: day, category: cat, amount: num(amount), mode, note: note.trim() });
                setSheet(false);
                toast(t('cash.expense_saved'));
                refresh();
              })
            }
          />
        </Sheet>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
