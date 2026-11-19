import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { fieldErrors } from '@/fieldErrors';
import type { Invoice, Part } from '@/types';
import { Sheet } from './sheet';
import { toast, toastError } from './toast';
import { Button, Field, Txt } from './ui';

/**
 * MRPs change: a new MRP from the bill screen. It becomes the part's price for this bill (invoiceId = a draft)
 * and for later bills. Needs the change_mrp tick.
 */
export function MrpSheet({ partId, name, price, invoiceId, onClose, onDone }: {
  partId: number;
  name: string;
  price: number;
  invoiceId?: number;
  onClose: () => void;
  onDone: (res: { item: Part; invoice: Invoice | null }) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = useState(String(Number(price)));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ item: Part; invoice: Invoice | null }>(`/parts/${partId}/mrp`, { mrp: v.replace(',', '.'), ...(invoiceId ? { invoice_id: invoiceId } : {}) });
      void qc.invalidateQueries({ queryKey: ['parts'] });
      void qc.invalidateQueries({ queryKey: ['part'] });
      toast(t('billing.mrp_changed'));
      onDone(res);
    } catch (e) {
      const fe = fieldErrors(e, t);
      if (fe.mrp) setErr(fe.mrp);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible onClose={onClose} title={t('billing.change_mrp')}>
      <Txt muted>{t('billing.change_mrp_note', { part: name })}</Txt>
      <Field label={`${t('inv.mrp')} (₹)`} value={v} onChangeText={(x) => { setV(x); setErr(''); }} keyboardType="decimal-pad" autoFocus selectTextOnFocus error={err} />
      <Button title={t('common.save')} icon={Check} onPress={() => void save()} loading={busy} disabled={!(Number(v.replace(',', '.')) > 0)} needsOnline />
    </Sheet>
  );
}
