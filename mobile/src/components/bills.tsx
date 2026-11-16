import * as Print from 'expo-print';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Receipt, Search, ShoppingCart, Wallet } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/api/client';
import { useInvoices } from '@/api/queries';
import { can, useSession } from '@/store/session';
import { date, money } from '@/format';
import { radius, size, space, touch, useTheme } from '@/theme';
import type { Invoice, InvoiceListItem, PayMode } from '@/types';
import { toastError } from './toast';
import { Button, Chip, EmptyState, Loading, OfflineBanner, Segmented, Txt } from './ui';

export function BillChip({ inv }: { inv: Pick<InvoiceListItem, 'status' | 'pay_status'> }) {
  const { t } = useTranslation();
  if (inv.status === 'draft') return <Chip label={t('billing.draft')} />;
  if (inv.status === 'cancelled') return <Chip label={t('billing.cancelled')} tone="danger" />;
  const tone = ({ paid: 'success', partial: 'warning', unpaid: 'danger' } as const)[inv.pay_status];
  return <Chip label={t(`billing.${inv.pay_status}`)} tone={tone} />;
}

/** Bills list with search and a status filter; used by the Billing (desk) and Money (owner) tabs. */
export function BillsList({ header }: { header?: React.ReactNode }) {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'draft'>('all');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const canCash = can(useSession((s) => s.user), 'cash_book');
  const list = useInvoices({ q, status: filter === 'draft' ? 'draft' : '', pay_status: filter === 'unpaid' ? 'unpaid' : '' });

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={{ padding: space[4], gap: space[3] }}>
        {header}
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={t('billing.new_counter')} icon={ShoppingCart} onPress={() => router.push('/invoice/counter')} needsOnline style={{ flex: 1 }} />
          {canCash ? <Button title={t('cash.title')} icon={Wallet} variant="secondary" onPress={() => router.push('/cash')} /> : null}
        </View>
        <View style={[styles.search, { borderColor: c.borderStrong, backgroundColor: c.surface }]}>
          <Search size={20} color={c.muted} />
          <TextInput value={text} onChangeText={setText} placeholder={t('customers.search_placeholder')} placeholderTextColor={c.muted} style={{ flex: 1, fontSize: size.md, color: c.text, fontFamily: font('regular') }} accessibilityLabel={t('common.search')} />
        </View>
        <Segmented<'all' | 'unpaid' | 'draft'>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('billing.all_status') },
            { value: 'unpaid', label: t('billing.unpaid') },
            { value: 'draft', label: t('billing.draft') },
          ]}
        />
        {list.data ? (
          <Txt size="sm" muted>
            {t('billing.sum')}: {money(list.data.sum_total)} · {t('billing.sum_due')}: <Txt size="sm" weight="bold" color="dangerText">{money(list.data.sum_due)}</Txt>
          </Txt>
        ) : null}
      </View>
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[10] }}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} colors={[c.primary]} />}
          ListEmptyComponent={<EmptyState icon={Receipt} title={t('billing.empty_title')} text={t('billing.empty_text')} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/invoice/${item.id}`)} accessibilityRole="button" style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="semibold">{item.invoice_no ?? `${t('billing.draft')} #${item.id}`}</Txt>
                <Txt size="sm" muted numberOfLines={1}>
                  {item.customer_name ?? t('billing.walk_in')}
                  {item.reg_no ? ` · ${item.reg_no}` : ''} · {date(item.invoice_date ?? item.created_at)}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Txt weight="bold" tabular>{money(item.grand_total)}</Txt>
                <BillChip inv={item} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const MODES: Exclude<PayMode, 'credit'>[] = ['cash', 'upi', 'card', 'bank'];
export type Payments = Record<(typeof MODES)[number], string>;
export const emptyPayments = (): Payments => ({ cash: '', upi: '', card: '', bank: '' });

/** One amount per mode; the rest is credit (allowed only for trusted customers). */
export function PaymentEntry({ total, value, onChange }: { total: number; value: Payments; onChange: (v: Payments) => void }) {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const paid = MODES.reduce((s, m) => s + (Number(value[m].replace(',', '.')) || 0), 0);
  const credit = Math.max(0, Math.round((total - paid) * 100) / 100);
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt weight="semibold" style={{ flex: 1 }}>{t('billing.payment')}</Txt>
        <Button title={t('billing.exact')} small variant="ghost" onPress={() => onChange({ ...emptyPayments(), cash: String(total) })} />
      </View>
      <View style={styles.payGrid}>
        {MODES.map((m) => (
          <View key={m} style={{ width: '48%', gap: 4 }}>
            <Txt size="xs" muted>{t(`billing.pay_${m}`)}</Txt>
            <TextInput
              value={value[m]}
              onChangeText={(v) => onChange({ ...value, [m]: v })}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={c.muted}
              accessibilityLabel={t(`billing.pay_${m}`)}
              style={[styles.payInput, { color: c.text, borderColor: c.borderStrong, fontFamily: font('semibold'), backgroundColor: c.bg }]}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt muted>{t('billing.credit_part')}</Txt>
        <Txt weight="bold" tabular color={credit > 0 ? 'dangerText' : 'successText'}>{money(credit)}</Txt>
      </View>
    </View>
  );
}

export function paymentsBody(p: Payments) {
  return MODES.map((m) => ({ mode: m, amount: Number(p[m].replace(',', '.')) || 0 })).filter((x) => x.amount > 0);
}

/** Render the bilingual tax invoice to a PDF and open the share sheet (WhatsApp, etc.). */
/**
 * Print the bill as a thermal receipt (58 / 80 mm, see Settings) through the Android print dialog.
 * The Bluetooth printer appears there once its print service app is installed (docs/PRINTER_SETUP.md).
 */
export async function printReceipt(inv: Pick<Invoice, 'id'>, lang?: string) {
  try {
    const htmlText = await api.get<string>(`/invoices/${inv.id}/receipt`, { lang });
    await Print.printAsync({ html: htmlText });
  } catch (e) {
    toastError(e);
  }
}

export async function shareInvoicePdf(inv: Pick<Invoice, 'id' | 'invoice_no'>, lang?: string) {
  try {
    const htmlText = await api.get<string>(`/invoices/${inv.id}/html`, { lang });
    const { uri } = await Print.printToFileAsync({ html: htmlText });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: inv.invoice_no ?? 'Bill', UTI: 'com.adobe.pdf' });
    }
  } catch (e) {
    toastError(e);
  }
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderWidth: 1, borderRadius: radius.card },
  payGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space[2] },
  payInput: { borderWidth: 1, borderRadius: radius.input, minHeight: 50, textAlign: 'right', paddingHorizontal: space[3], fontSize: size.lg },
});
