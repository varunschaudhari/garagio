import { useQuery } from '@tanstack/react-query';
import * as Print from 'expo-print';
import { Check, Square, SquareCheck, Undo2 } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/api/client';
import { useBillingMutation } from '@/api/queries';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Divider, Field, Segmented, Txt } from '@/components/ui';
import { money, qty } from '@/format';
import { radius, size, space, useTheme } from '@/theme';
import type { Invoice } from '@/types';

type RefundMode = 'cash' | 'upi' | 'bank';

interface Preview {
  totals: { taxable_total: number; total: number };
  max_refund: number;
  must_refund: number;
}

const num = (s: string) => Number(s.replace(',', '.')) || 0;

export async function printReturn(id: number, lang?: string) {
  try {
    const htmlText = await api.get<string>(`/returns/${id}/receipt`, { lang });
    await Print.printAsync({ html: htmlText });
  } catch (e) {
    toastError(e);
  }
}

/** Take parts or labour back from a final bill: how many of each, back to stock or not, and any refund. */
export function ReturnSheet({ inv, lang, onClose }: { inv: Invoice; lang: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [faulty, setFaulty] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<string | null>(null);
  const [mode, setMode] = useState<RefundMode>('cash');
  const save = useBillingMutation((body: Record<string, unknown>) => api.post<{ item: { id: number; return_no: string } }>(`/invoices/${inv.id}/returns`, body));

  const items = useMemo(
    () => inv.items.filter((it) => num(qtys[it.id] ?? '') > 0).map((it) => ({ invoice_item_id: it.id, qty: num(qtys[it.id] ?? ''), restock: !faulty[it.id] })),
    [inv.items, qtys, faulty]
  );
  const preview = useQuery({
    queryKey: ['return-preview', inv.id, JSON.stringify(items)],
    queryFn: () => api.post<Preview>(`/invoices/${inv.id}/returns/preview`, { items }),
    enabled: items.length > 0,
    placeholderData: (prev) => prev,
    retry: false,
  });
  const p = items.length ? preview.data : undefined;
  const refundValue = refund ?? (p ? String(p.max_refund) : '');

  const submit = async () => {
    try {
      const res = await save.mutateAsync({ items, reason: reason.trim(), refund: p && p.max_refund > 0 ? num(refundValue) : 0, refund_mode: mode });
      toast(t('billing.returned_ok', { no: res.item.return_no }));
      onClose();
      void printReturn(res.item.id, lang);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={t('billing.return_title', { no: inv.invoice_no ?? '' })} full>
      <ScrollView contentContainerStyle={{ gap: space[3], paddingHorizontal: space[5], paddingBottom: space[6] }} keyboardShouldPersistTaps="handled">
        <Txt size="sm" muted>{t('billing.return_hint')}</Txt>
        {inv.items.map((it, n) => {
          const left = Math.round((it.qty - (it.returned_qty ?? 0)) * 100) / 100;
          const over = num(qtys[it.id] ?? '') > left;
          return (
            <View key={it.id} style={{ gap: space[2] }}>
              {n > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="semibold">{lang === 'mr' && it.description_mr ? it.description_mr : it.description_en}</Txt>
                  <Txt size="sm" muted>
                    {it.part_no ? `${it.part_no} · ` : ''}{t('billing.sold', { qty: qty(it.qty) })}
                    {it.returned_qty ? ` · ${t('billing.already_back', { qty: qty(it.returned_qty) })}` : ''}
                  </Txt>
                </View>
                <TextInput
                  value={qtys[it.id] ?? ''}
                  onChangeText={(v) => setQtys((q) => ({ ...q, [it.id]: v }))}
                  editable={left > 0}
                  placeholder="0"
                  placeholderTextColor={c.muted}
                  keyboardType="decimal-pad"
                  accessibilityLabel={t('billing.return_qty')}
                  style={[styles.qty, { color: c.text, borderColor: over ? c.danger : c.borderStrong, fontFamily: font('semibold'), opacity: left > 0 ? 1 : 0.4 }]}
                />
              </View>
              {it.part_id && num(qtys[it.id] ?? '') > 0 ? (
                <Pressable onPress={() => setFaulty((f) => ({ ...f, [it.id]: !f[it.id] }))} accessibilityRole="checkbox" accessibilityState={{ checked: !faulty[it.id] }} style={styles.check}>
                  {faulty[it.id] ? <Square size={22} color={c.muted} /> : <SquareCheck size={22} color={c.primary} />}
                  <Txt size="sm">{t('billing.restock')}</Txt>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Field label={t('billing.return_reason')} value={reason} onChangeText={setReason} required />
        {p ? (
          <View style={{ gap: space[2] }}>
            <View style={styles.kv}>
              <Txt weight="bold">{t('billing.return_total')}</Txt>
              <Txt size="lg" weight="bold" tabular>{money(p.totals.total)}</Txt>
            </View>
            {p.max_refund > 0 ? (
              <>
                <Banner text={p.must_refund > 0 ? t('billing.refund_walkin', { amount: money(p.must_refund) }) : t('billing.refund_max', { amount: money(p.max_refund) })} />
                <Field label={`${t('billing.refund')} (₹)`} value={refundValue} onChangeText={setRefund} keyboardType="decimal-pad" />
                <Segmented<RefundMode> value={mode} onChange={setMode} options={(['cash', 'upi', 'bank'] as const).map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
              </>
            ) : (
              <Txt size="sm" muted>{t('billing.no_refund')}</Txt>
            )}
          </View>
        ) : null}
        <Button title={t('billing.return')} icon={items.length ? Undo2 : Check} variant="danger" loading={save.isPending} disabled={!items.length || !reason.trim()} needsOnline onPress={() => void submit()} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  qty: { width: 76, borderWidth: 1, borderRadius: radius.input, minHeight: 48, textAlign: 'center', fontSize: size.lg },
  check: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 40 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
