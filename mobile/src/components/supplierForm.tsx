import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { fieldErrors } from '@/fieldErrors';
import type { Supplier } from '@/types';
import { Sheet } from './sheet';
import { toast, toastError } from './toast';
import { Button, Field } from './ui';

type Form = { name: string; contact_person: string; phone: string; gstin: string; opening_balance: string; address: string };

/** New supplier, or edit one. The state comes from the GSTIN (another state → IGST on purchases). */
export function SupplierFormSheet({ supplier, onClose, onSaved }: { supplier?: Supplier | null; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>({
    name: supplier?.name ?? '',
    contact_person: supplier?.contact_person ?? '',
    phone: supplier?.phone ?? '',
    gstin: supplier?.gstin ?? '',
    opening_balance: supplier ? String(Number(supplier.opening_balance) || '') : '',
    address: supplier?.address ?? '',
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrs((e) => ({ ...e, [k]: '' }));
  };

  const save = async () => {
    if (!f.name.trim()) return setErrs({ name: t('fields.required') });
    setBusy(true);
    try {
      const body = { ...f, opening_balance: f.opening_balance.replace(',', '.') || 0 };
      const res = supplier ? await api.put<{ item: Supplier }>(`/suppliers/${supplier.id}`, body) : await api.post<{ item: Supplier }>('/suppliers', body);
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      void qc.invalidateQueries({ queryKey: ['supplier'] });
      void qc.invalidateQueries({ queryKey: ['supplier-ledger'] });
      toast(supplier ? t('common.saved') : t('common.created'));
      onSaved(res.item);
    } catch (e) {
      const fe = fieldErrors(e, t);
      if (Object.keys(fe).length) setErrs(fe);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={supplier ? t('suppliers.edit') : t('suppliers.new')}>
      <Field label={t('suppliers.name')} value={f.name} onChangeText={set('name')} error={errs.name} required autoFocus={!supplier} />
      <Field label={t('suppliers.contact_person')} value={f.contact_person} onChangeText={set('contact_person')} error={errs.contact_person} />
      <Field label={t('common.phone')} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={errs.phone} />
      <Field label={t('suppliers.gstin')} value={f.gstin} onChangeText={set('gstin')} autoCapitalize="characters" hint={t('suppliers.gstin_hint')} error={errs.gstin} />
      <Field label={t('suppliers.opening_balance')} value={f.opening_balance} onChangeText={set('opening_balance')} keyboardType="numbers-and-punctuation" hint={t('suppliers.opening_hint')} error={errs.opening_balance} />
      <Field label={t('common.address')} value={f.address} onChangeText={set('address')} multiline error={errs.address} />
      <Button title={t('common.save')} icon={Check} onPress={() => void save()} loading={busy} needsOnline />
    </Sheet>
  );
}
