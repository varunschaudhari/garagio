import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { Check, Minus, Plus, ScanLine, Search, Trash2, UserRound, X } from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/api/client';
import { useBillingMutation, useCustomers } from '@/api/queries';
import { emptyPayments, PaymentEntry, paymentsBody, type Payments } from '@/components/bills';
import { PartPicker } from '@/components/pickers';
import { Sheet } from '@/components/sheet';
import { toast } from '@/components/toast';
import { Button, Card, Field, IconButton, OfflineBanner, Txt } from '@/components/ui';
import { money, qty } from '@/format';
import { errorText, nm } from '@/i18n';
import { useScan } from '@/store/scan';
import { radius, size, space, touch, useTheme } from '@/theme';
import type { Customer, Invoice, Part } from '@/types';

interface Line {
  part: Part;
  qty: number;
}

/** Counter sale: parts by search or QR, walk-in or known customer, split payment, save in one step. */
export default function CounterSale() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [walkName, setWalkName] = useState('');
  const [walkPhone, setWalkPhone] = useState('');
  const [pickPart, setPickPart] = useState(false);
  const [pickCust, setPickCust] = useState(false);
  const [custText, setCustText] = useState('');
  const [pay, setPay] = useState<Payments>(emptyPayments());
  const customers = useCustomers(custText.trim());
  const create = useBillingMutation((body: unknown) => api.post<{ item: Invoice }>('/invoices', body));
  const finalize = useBillingMutation((v: { id: number; body: unknown }) => api.post<{ item: Invoice }>(`/invoices/${v.id}/finalize`, v.body));

  const add = useCallback((p: Part) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.part.id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { part: p, qty: 1 }];
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      const code = useScan.getState().take();
      if (!code) return;
      api.get<{ item: Part }>(`/parts/by-code/${encodeURIComponent(code)}`).then((r) => add(r.item)).catch(() => toast(t('mobile.scanned_unknown', { code }), 'error'));
    }, [add, t])
  );

  const items = useMemo(() => lines.map((l) => ({ part_id: l.part.id, qty: l.qty })), [lines]);
  const preview = useQuery({
    queryKey: ['counter-preview', JSON.stringify(items), customer?.id],
    queryFn: () => api.post<{ totals: { grand_total: number; taxable_total: number } | null }>('/invoices/preview', { items, customer_id: customer?.id }),
    enabled: items.length > 0,
    placeholderData: (p) => p,
  });
  const total = items.length ? preview.data?.totals?.grand_total ?? 0 : 0;

  const submit = async () => {
    if (!lines.length) return toast(t('purchases.no_lines'), 'error');
    let draft: Invoice;
    try {
      draft = (await create.mutateAsync({ items, customer_id: customer?.id, cust_name: customer ? undefined : walkName, cust_phone: customer ? undefined : walkPhone })).item;
    } catch (e) {
      return Alert.alert(t('billing.new_counter'), errorText(e));
    }
    try {
      const fin = (await finalize.mutateAsync({ id: draft.id, body: { payments: paymentsBody(pay) } })).item;
      toast(t('billing.finalized', { no: fin.invoice_no }));
    } catch (e) {
      Alert.alert(t('billing.finalize'), errorText(e));
    }
    router.replace(`/invoice/${draft.id}`);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={t('billing.add_part')} icon={Plus} variant="secondary" onPress={() => setPickPart(true)} style={{ flex: 1 }} />
          <Button title={t('mobile.scan')} icon={ScanLine} variant="secondary" onPress={() => router.push({ pathname: '/scan', params: { mode: 'pick' } })} />
        </View>
        {lines.map((l) => (
          <Card key={l.part.id} style={{ gap: space[2] }}>
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <View style={{ flex: 1 }}>
                <Txt weight="semibold">{nm(l.part)}</Txt>
                <Txt size="sm" muted>{l.part.part_no} · {t('inv.mrp')} {money(l.part.selling_price)} · {t('purchases.in_stock')} {qty(l.part.current_stock)}</Txt>
              </View>
              <IconButton icon={Trash2} label={t('common.delete')} color={c.dangerText} onPress={() => setLines((ls) => ls.filter((x) => x.part.id !== l.part.id))} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <View style={[styles.stepper, { borderColor: c.borderStrong }]}>
                <Pressable onPress={() => setLines((ls) => ls.map((x) => (x.part.id === l.part.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} style={[styles.stepBtn, { backgroundColor: c.surface2 }]} accessibilityLabel="−1"><Minus size={22} color={c.text} /></Pressable>
                <Txt size="lg" weight="bold" tabular style={{ minWidth: 44, textAlign: 'center' }}>{qty(l.qty)}</Txt>
                <Pressable onPress={() => setLines((ls) => ls.map((x) => (x.part.id === l.part.id ? { ...x, qty: x.qty + 1 } : x)))} style={[styles.stepBtn, { backgroundColor: c.surface2 }]} accessibilityLabel="+1"><Plus size={22} color={c.text} /></Pressable>
              </View>
              <View style={{ flex: 1 }} />
              <Txt weight="bold" tabular>{money(l.qty * l.part.selling_price)}</Txt>
            </View>
          </Card>
        ))}

        <Card style={{ gap: space[3] }}>
          <Txt weight="semibold">{t('billing.customer')}</Txt>
          {customer ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <UserRound size={20} color={c.muted} />
              <Txt style={{ flex: 1 }}>{customer.name} · {customer.phone}</Txt>
              <IconButton icon={X} label={t('common.clear')} onPress={() => setCustomer(null)} />
            </View>
          ) : (
            <>
              <Button title={t('billing.pick_customer')} icon={Search} variant="secondary" small onPress={() => setPickCust(true)} />
              <Field label={t('billing.walk_in_name')} value={walkName} onChangeText={setWalkName} />
              <Field label={t('billing.walk_in_phone')} value={walkPhone} onChangeText={setWalkPhone} keyboardType="phone-pad" />
            </>
          )}
        </Card>

        <Card style={{ gap: space[3] }}>
          <View style={styles.kv}>
            <Txt size="lg" weight="bold">{t('inv.grand_total')}</Txt>
            <Txt size="xl" weight="bold" tabular>{money(total)}</Txt>
          </View>
          <PaymentEntry total={total} value={pay} onChange={setPay} />
        </Card>
        <Button title={t('billing.finalize')} icon={Check} onPress={submit} loading={create.isPending || finalize.isPending} needsOnline disabled={!lines.length} />
      </ScrollView>

      <PartPicker visible={pickPart} onClose={() => setPickPart(false)} onPick={(p) => { add(p); setPickPart(false); }} />
      <Sheet visible={pickCust} onClose={() => setPickCust(false)} title={t('billing.customer')} full>
        <View style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}>
          <View style={[styles.search, { borderColor: c.borderStrong }]}>
            <Search size={20} color={c.muted} />
            <TextInput value={custText} onChangeText={setCustText} autoFocus placeholder={t('billing.pick_customer')} placeholderTextColor={c.muted} style={{ flex: 1, fontSize: size.md, color: c.text, fontFamily: font('regular') }} accessibilityLabel={t('billing.pick_customer')} />
          </View>
        </View>
        <FlatList
          data={customers.data?.items ?? []}
          keyExtractor={(x) => String(x.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[6] }}
          renderItem={({ item }) => (
            <Pressable onPress={() => { setCustomer(item); setPickCust(false); }} style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <Txt weight="semibold">{item.name}</Txt>
                <Txt size="sm" muted>{item.phone}{item.balance > 0 ? ` · ${money(item.balance)}` : ''}</Txt>
              </View>
            </Pressable>
          )}
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.input, overflow: 'hidden' },
  stepBtn: { width: 52, height: 48, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderWidth: 1, borderRadius: radius.card },
});
