import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { CircleCheck, MessageCircle } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';
import { api } from '@/api/client';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, EmptyState, Loading, OfflineBanner, Txt } from '@/components/ui';
import { date, money } from '@/format';
import { space, useTheme } from '@/theme';

interface Due {
  customer_id: number;
  name: string;
  phone: string;
  url: string;
  text: string;
  log: Record<string, unknown>;
  reg_no?: string;
  model?: string;
  days?: number;
  est_km?: number | null;
  balance?: number;
  oldest?: string | null;
}

/** Service and payment reminders, each sent with one tap on WhatsApp. */
export default function Reminders() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const q = useQuery({ queryKey: ['reminders'], queryFn: () => api.get<{ service: Due[]; payment: Due[] }>('/messages/due') });

  const send = async (d: Due) => {
    try {
      await Linking.openURL(d.url);
      await api.post('/messages/log', { ...d.log, payload: d.text });
      toast(t('reminders.sent'));
      void q.refetch();
    } catch (e) {
      toastError(e);
    }
  };

  const section = (title: string, list: Due[] | undefined, empty: string, kind: 'service' | 'payment') => (
    <View style={{ gap: space[2] }}>
      <Txt size="lg" weight="bold">{title} ({list?.length ?? 0})</Txt>
      {list?.length ? (
        list.map((d) => (
          <Card key={`${kind}-${d.customer_id}-${d.reg_no ?? ''}`} style={{ gap: space[2] }}>
            <Txt weight="semibold">{d.name} · {d.phone}</Txt>
            <Txt size="sm" muted>
              {kind === 'service'
                ? `${d.reg_no} ${d.model ?? ''} · ${t('reminders.days_ago', { n: d.days })}${d.est_km ? ' · ' + t('reminders.est_km', { km: d.est_km }) : ''}`
                : `${money(d.balance)}${d.oldest ? ' · ' + t('reminders.oldest', { date: date(d.oldest) }) : ''}`}
            </Txt>
            <Button title={t('reminders.send')} icon={MessageCircle} small onPress={() => void send(d)} needsOnline />
          </Card>
        ))
      ) : (
        <EmptyState icon={CircleCheck} title={empty} />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[5], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} colors={[c.primary]} />}
      >
        <Banner text={t('reminders.hint')} />
        {q.isPending ? <Loading /> : null}
        {section(t('reminders.payment'), q.data?.payment, t('reminders.empty_payment'), 'payment')}
        {section(t('reminders.service'), q.data?.service, t('reminders.empty_service'), 'service')}
      </ScrollView>
    </View>
  );
}
