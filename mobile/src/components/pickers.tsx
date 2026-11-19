import { Plus, Search } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useParts, useSuppliers, useSupplierPayment } from '@/api/queries';
import { money, qty } from '@/format';
import { nm } from '@/i18n';
import { radius, size, space, touch, useTheme } from '@/theme';
import type { Part, PayMode, Supplier } from '@/types';
import { Sheet } from './sheet';
import { toast, toastError } from './toast';
import { Banner, Button, Field, Loading, Segmented, Txt } from './ui';

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { c, font } = useTheme();
  return (
    <View style={[styles.search, { borderColor: c.borderStrong, backgroundColor: c.bg }]}>
      <Search size={20} color={c.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        autoFocus
        autoCorrect={false}
        style={{ flex: 1, fontSize: size.md, color: c.text, fontFamily: font('regular'), paddingVertical: space[2] }}
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

export function SupplierPicker({ visible, onClose, onPick, onNew }: { visible: boolean; onClose: () => void; onPick: (s: Supplier) => void; onNew?: () => void }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const list = useSuppliers(q);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('purchases.supplier')} full>
      <View style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}>
        <SearchBox value={text} onChange={setText} placeholder={t('purchases.choose_supplier')} />
        {onNew ? <Button title={t('suppliers.new')} icon={Plus} variant="ghost" small onPress={onNew} style={{ marginTop: space[2] }} /> : null}
      </View>
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(s) => String(s.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[6] }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]}
              accessibilityRole="button"
            >
              <View style={{ flex: 1 }}>
                <Txt weight="semibold">{item.name}</Txt>
                <Txt size="sm" muted>
                  {[item.contact_person, item.phone, item.gstin].filter(Boolean).join(' · ')}
                </Txt>
              </View>
              <Txt weight="semibold" tabular color={item.balance > 0 ? 'dangerText' : 'muted'}>
                {money(item.balance)}
              </Txt>
            </Pressable>
          )}
          ListEmptyComponent={<Txt muted center>{t('common.no_results')}</Txt>}
        />
      )}
    </Sheet>
  );
}

export function PartPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (p: Part) => void }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const list = useParts({ q, per_page: 40 });
  return (
    <Sheet visible={visible} onClose={onClose} title={t('purchases.part')} full>
      <View style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}>
        <SearchBox value={text} onChange={setText} placeholder={t('purchases.search_part')} />
      </View>
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(p) => String(p.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space[4], gap: space[2], paddingBottom: space[6] }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]}
              accessibilityRole="button"
            >
              <View style={{ flex: 1 }}>
                <Txt weight="semibold" numberOfLines={1}>
                  {nm(item)}
                </Txt>
                <Txt size="sm" muted>
                  {item.part_no} · {t('purchases.in_stock')} {qty(item.current_stock)}
                </Txt>
              </View>
              {item.last_purchase_price !== undefined ? (
                <Txt size="sm" muted tabular>
                  {money(item.last_purchase_price)}
                </Txt>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={<Txt muted center>{t('common.no_results')}</Txt>}
        />
      )}
    </Sheet>
  );
}

const PAY_MODES: PayMode[] = ['upi', 'cash', 'bank', 'card'];

/** Record a payment to a supplier (optionally against one bill). */
export function SupplierPaymentSheet({ supplier, purchaseId, amount, onClose }: { supplier: Supplier; purchaseId?: number; amount?: number; onClose: () => void }) {
  const { t } = useTranslation();
  const pay = useSupplierPayment(supplier.id);
  const [value, setValue] = useState(amount ? String(amount) : supplier.balance > 0 ? String(supplier.balance) : '');
  const [mode, setMode] = useState<PayMode>('upi');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const n = Number(value.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError(t('fields.out_of_range'));
      return;
    }
    try {
      await pay.mutateAsync({ amount: n, mode, reference: reference.trim() || undefined, purchase_id: purchaseId });
      toast(t('suppliers.payment_saved'));
      onClose();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={`${t('suppliers.record_payment')} · ${supplier.name}`}>
      <Banner tone={supplier.balance > 0 ? 'warning' : 'info'} text={`${t('suppliers.balance')}: ${money(supplier.balance)}`} />
      <Field label={`${t('suppliers.amount')} (₹)`} value={value} onChangeText={setValue} keyboardType="decimal-pad" error={error} required />
      <View style={{ gap: 6 }}>
        <Txt size="sm" weight="semibold">
          {t('suppliers.mode')}
        </Txt>
        <Segmented<PayMode> value={mode} onChange={setMode} options={PAY_MODES.map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
      </View>
      <Field label={t('suppliers.reference')} value={reference} onChangeText={setReference} placeholder="UTR / cheque no." />
      <Txt size="sm" muted>
        {t('suppliers.advance_note')}
      </Txt>
      <Button title={t('common.save')} onPress={save} loading={pay.isPending} needsOnline />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderWidth: 1, borderRadius: radius.card },
});
