import { useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, ShieldCheck, Trash2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { useWorkMutation } from '@/api/queries';
import { confirmRemovePerson, PersonSheet } from '@/components/personSheet';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Button, Card, Chip, Field, Loading, OfflineBanner, Txt } from '@/components/ui';
import { datetime } from '@/format';
import { useSession } from '@/store/session';
import { space, useTheme } from '@/theme';
import type { Perm, Role, User } from '@/types';

type Row = User & { last_login_at: string | null };
interface UsersResponse {
  items: Row[];
  permissions: Perm[];
  role_defaults: Record<Role, Record<Perm, boolean>>;
}

/** Owner: staff list - change name / username / phone, activate / deactivate, reset passwords, tick what each person may do, remove. New users are added on the web (mechanics also from Mechanic summary). */
export default function Users() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const me = useSession((s) => s.user);
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<UsersResponse>('/users') });
  const upd = useWorkMutation((v: { id: number; body: unknown }) => api.put(`/users/${v.id}`, v.body));
  const [reset, setReset] = useState<Row | null>(null);
  const [pw, setPw] = useState('');
  const [permUser, setPermUser] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [ticks, setTicks] = useState<Partial<Record<Perm, boolean>>>({});

  const keys = q.data?.permissions ?? [];
  const defaults = q.data?.role_defaults;
  const custom = (u: Row) => u.role !== 'owner' && !!defaults && keys.some((k) => !!u.perms?.[k] !== !!defaults[u.role]?.[k]);

  const save = async (id: number, body: unknown, ok: string) => {
    try {
      await upd.mutateAsync({ id, body });
      toast(ok);
      void q.refetch();
      setReset(null);
      setPermUser(null);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[2], paddingBottom: space[10] }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} colors={[c.primary]} />}>
        {q.isPending ? <Loading /> : null}
        {(q.data?.items ?? []).map((u) => (
          <Card key={u.id} style={{ gap: space[2] }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Txt weight="semibold">{u.name}{u.id === me?.id ? ` (${t('users.you')})` : ''}</Txt>
                <Txt size="sm" muted>{u.username ? `@${u.username}` : t('users.no_login')} · {t(`roles.${u.role}`)} · {u.last_login_at ? datetime(u.last_login_at) : t('users.never')}</Txt>
                {custom(u) ? <Chip label={t('users.perm_custom')} tone="warning" /> : null}
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
            <View style={{ flexDirection: 'row', gap: space[4], flexWrap: 'wrap' }}>
              <Pressable onPress={() => setEditing(u)} accessibilityRole="button" style={styles.link}>
                <Pencil size={16} color={c.primaryText} />
                <Txt size="sm" color="primaryText" weight="semibold">{t('common.edit')}</Txt>
              </Pressable>
              {u.login !== false ? (
              <Pressable onPress={() => { setPw(''); setReset(u); }} accessibilityRole="button" style={styles.link}>
                <KeyRound size={16} color={c.primaryText} />
                <Txt size="sm" color="primaryText" weight="semibold">{t('users.reset_password')}</Txt>
              </Pressable>
              ) : null}
              {u.role !== 'owner' ? (
                <Pressable onPress={() => { setTicks({ ...(u.perms ?? {}) }); setPermUser(u); }} accessibilityRole="button" style={styles.link}>
                  <ShieldCheck size={16} color={c.primaryText} />
                  <Txt size="sm" color="primaryText" weight="semibold">{t('users.perm_title')}</Txt>
                </Pressable>
              ) : null}
              {u.id !== me?.id ? (
                <Pressable onPress={() => confirmRemovePerson(u, t, () => void q.refetch())} accessibilityRole="button" style={styles.link}>
                  <Trash2 size={16} color={c.danger} />
                  <Txt size="sm" color="danger" weight="semibold">{t('users.remove')}</Txt>
                </Pressable>
              ) : null}
            </View>
          </Card>
        ))}
      </ScrollView>
      {editing ? (
        <PersonSheet
          person={editing}
          mechanic={editing.role === 'mechanic' && editing.id !== me?.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void q.refetch();
          }}
        />
      ) : null}
      {reset ? (
        <Sheet visible onClose={() => setReset(null)} title={`${t('users.reset_password')} · ${reset.name}`}>
          <Field label={t('users.temp_password')} value={pw} onChangeText={setPw} hint={t('users.temp_password_hint')} autoCapitalize="none" autoFocus />
          <Button title={t('common.save')} onPress={() => void save(reset.id, { reset_password: pw }, t('common.saved'))} disabled={pw.length < 8} loading={upd.isPending} needsOnline />
        </Sheet>
      ) : null}
      {permUser ? (
        <Sheet visible onClose={() => setPermUser(null)} title={`${t('users.perm_title')} · ${permUser.name}`}>
          <Txt size="sm" muted>{t('users.perm_hint')}</Txt>
          <ScrollView style={{ maxHeight: 420 }}>
            {keys.map((k) => {
              const changed = !!ticks[k] !== !!defaults?.[permUser.role]?.[k];
              return (
                <View key={k} style={[styles.permRow, { borderColor: c.border }]}>
                  <View style={{ flex: 1 }}>
                    <Txt size="sm">{t(`users.perms.${k}`)}</Txt>
                    {changed ? <Txt size="xs" color="warningText">{t('users.perm_changed')}</Txt> : null}
                  </View>
                  <Switch
                    value={!!ticks[k]}
                    onValueChange={(v) => setTicks((x) => ({ ...x, [k]: v }))}
                    trackColor={{ true: c.primary, false: c.borderStrong }}
                    accessibilityLabel={t(`users.perms.${k}`)}
                  />
                </View>
              );
            })}
          </ScrollView>
          <Button
            title={t('common.save')}
            onPress={() => void save(permUser.id, { permissions: Object.fromEntries(keys.map((k) => [k, !!ticks[k]])) }, t('common.saved'))}
            loading={upd.isPending}
            needsOnline
          />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth },
});
