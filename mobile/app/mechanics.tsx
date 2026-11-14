import { useQuery } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useWorkMutation } from '@/api/queries';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Divider, Field, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { date, money } from '@/format';
import { space, useTheme } from '@/theme';

interface MechDay {
  id: number;
  name: string;
  jobs: { job_id: number; job_no: string; reg_no: string; labour: number; parts: number }[];
  jobs_count: number;
  labour_billed: number;
  parts_value: number;
  paid_daily: number;
  paid_advance: number;
}

function iso(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Owner: mechanic daily summary and pay. */
export default function Mechanics() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [day, setDay] = useState(iso(0));
  const q = useQuery({ queryKey: ['mechanics-daily', day], queryFn: () => api.get<{ items: MechDay[] }>('/mechanics/daily', { date: day }) });
  const [paying, setPaying] = useState<MechDay | null>(null);
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'daily' | 'advance'>('daily');
  const pay = useWorkMutation((v: { id: number; body: unknown }) => api.post(`/mechanics/${v.id}/payments`, v.body));

  const save = async () => {
    if (!paying) return;
    try {
      await pay.mutateAsync({ id: paying.id, body: { work_date: day, amount: Number(amount.replace(',', '.')), kind } });
      toast(t('mechanics.saved'));
      setPaying(null);
      void q.refetch();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} colors={[c.primary]} />}
      >
        <Segmented<string> value={day} onChange={setDay} options={[{ value: iso(0), label: t('common.today') }, { value: iso(-1), label: t('common.yesterday') }, { value: iso(-2), label: date(iso(-2)).slice(0, 5) }]} />
        <Banner text={t('mechanics.your_decision')} />
        {q.isPending ? <Loading /> : null}
        {(q.data?.items ?? []).map((m) => (
          <Card key={m.id} style={{ gap: space[2] }}>
            <Txt size="lg" weight="bold">{m.name}</Txt>
            <View style={styles.kv}><Txt muted>{t('mechanics.jobs')}</Txt><Txt weight="semibold">{m.jobs_count}</Txt></View>
            <View style={styles.kv}><Txt muted>{t('mechanics.labour')}</Txt><Txt weight="semibold" tabular>{money(m.labour_billed)}</Txt></View>
            <View style={styles.kv}><Txt muted>{t('mechanics.parts')}</Txt><Txt weight="semibold" tabular>{money(m.parts_value)}</Txt></View>
            {m.jobs.length ? <Divider /> : null}
            {m.jobs.map((j) => (
              <Txt key={j.job_id} size="sm" muted>{j.reg_no} · {j.job_no} · {money(j.labour)} + {money(j.parts)}</Txt>
            ))}
            <Divider />
            <View style={styles.kv}>
              <Txt>{t('mechanics.paid')}: <Txt weight="bold">{money(m.paid_daily)}</Txt>{m.paid_advance ? ` · ${t('mechanics.advance')}: ${money(m.paid_advance)}` : ''}</Txt>
            </View>
            <Button title={t('mechanics.pay')} icon={HandCoins} small onPress={() => { setAmount(''); setKind('daily'); setPaying(m); }} needsOnline />
          </Card>
        ))}
      </ScrollView>
      {paying ? (
        <Sheet visible onClose={() => setPaying(null)} title={`${t('mechanics.pay')} · ${paying.name}`}>
          <Field label={t('mechanics.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus />
          <Segmented<'daily' | 'advance'> value={kind} onChange={setKind} options={[{ value: 'daily', label: t('mechanics.kind_daily') }, { value: 'advance', label: t('mechanics.kind_advance') }]} />
          <Button title={t('common.save')} onPress={save} loading={pay.isPending} disabled={!(Number(amount.replace(',', '.')) > 0)} needsOnline />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
