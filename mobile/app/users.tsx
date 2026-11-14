import { useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { useWorkMutation } from '@/api/queries';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Button, Card, Field, Loading, OfflineBanner, Txt } from '@/components/ui';
import { datetime } from '@/format';
import { useSession } from '@/store/session';
import { space, useTheme } from '@/theme';
import type { User } from '@/types';

/** Owner: staff list - activate / deactivate and reset passwords. New users are added on the web. */
export default function Users() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const me = useSession((s) => s.user);
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ items: (User & { last_login_at: string | null })[] }>('/users').then((r) => r.items) });
  const upd = useWorkMutation((v: { id: number; body: unknown }) => api.put(`/users/${v.id}`, v.body));
  const [reset, setReset] = useState<User | null>(null);
  const [pw, setPw] = useState('');

  const save = async (id: number, body: unknown, ok: string) => {
    try {
      await upd.mutateAsync({ id, body });
      toast(ok);
      void q.refetch();
      setReset(null);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[2], paddingBottom: space[10] }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} colors={[c.primary]} />}>
        {q.isPending ? <Loading /> : null}
        {(q.data ?? []).map((u) => (
          <Card key={u.id} style={{ gap: space[2] }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Txt weight="semibold">{u.name}{u.id === me?.id ? ` (${t('users.you')})` : ''}</Txt>
                <Txt size="sm" muted>@{u.username} · {t(`roles.${u.role}`)} · {u.last_login_at ? datetime(u.last_login_at) : t('users.never')}</Txt>
              </View>
              {u.id !== me?.id ? (
                <Switch
                  value={!!u.active}
                  onValueChange={(v) => void save(u.id, { active: v }, t('common.saved'))}
                  trackColor={{ true: c.primary, false: c.borderStrong }}
                  accessibilityLabel={t('common.active')}
                />
              ) : null}
            </View>
            <Pressable onPress={() => { setPw(''); setReset(u); }} accessibilityRole="button" style={styles.link}>
              <KeyRound size={16} color={c.primaryText} />
              <Txt size="sm" color="primaryText" weight="semibold">{t('users.reset_password')}</Txt>
            </Pressable>
          </Card>
        ))}
      </ScrollView>
      {reset ? (
        <Sheet visible onClose={() => setReset(null)} title={`${t('users.reset_password')} · ${reset.name}`}>
          <Field label={t('users.temp_password')} value={pw} onChangeText={setPw} hint={t('users.temp_password_hint')} autoCapitalize="none" autoFocus />
          <Button title={t('common.save')} onPress={() => void save(reset.id, { reset_password: pw }, t('common.saved'))} disabled={pw.length < 8} loading={upd.isPending} needsOnline />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
});
