import type { TFunction } from 'i18next';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { useWorkMutation } from '@/api/queries';
import { fieldErrors } from '@/fieldErrors';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Button, Field, Txt } from '@/components/ui';
import { space, useTheme } from '@/theme';

export interface Person {
  id: number;
  name: string;
  username: string | null;
  phone: string | null;
  login?: boolean;
}

/**
 * Owner: add a mechanic (person = null) or change someone's name, username and phone. Mechanics may be without a
 * login ("Uses the app" off): they are given jobs and paid but never open the app.
 */
export function PersonSheet({ person, mechanic, onClose, onSaved }: { person: Person | null; mechanic: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [login, setLogin] = useState(person ? person.login !== false : false);
  const [username, setUsername] = useState(person?.username ?? '');
  const [password, setPassword] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const hadLogin = !!person && person.login !== false;
  const save = useWorkMutation((body: Record<string, unknown>) => (person ? api.put(`/users/${person.id}`, body) : api.post('/users', { ...body, role: 'mechanic' })));

  const submit = async () => {
    const body: Record<string, unknown> = { name: name.trim(), phone: phone.trim() };
    if (mechanic) body.login = login;
    if (login) {
      body.username = username.trim();
      if (password) body[person ? 'reset_password' : 'password'] = password;
    }
    try {
      await save.mutateAsync(body);
      toast(person ? t('common.saved') : t('common.created'));
      onSaved();
    } catch (e) {
      const f = fieldErrors(e, t);
      setErrs({ ...f, password: f.password ?? f.reset_password ?? '' });
      toastError(e);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={person ? `${mechanic ? t('mechanics.edit') : t('users.edit')} · ${person.name}` : t('mechanics.add')}>
      <Field label={t('common.name')} value={name} onChangeText={setName} error={errs.name} required autoFocus={!person} />
      <Field label={t('common.phone')} value={phone} onChangeText={setPhone} error={errs.phone} keyboardType="phone-pad" />
      {mechanic ? (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Txt weight="semibold">{t('users.uses_app')}</Txt>
            <Txt size="sm" muted>{t('users.uses_app_hint')}</Txt>
          </View>
          <Switch value={login} onValueChange={setLogin} trackColor={{ true: c.primary, false: c.borderStrong }} accessibilityLabel={t('users.uses_app')} />
        </View>
      ) : null}
      {login ? (
        <>
          <Field label={t('users.username')} value={username} onChangeText={setUsername} error={errs.username} hint={t('users.username_hint')} autoCapitalize="none" autoCorrect={false} required />
          <Field
            label={hadLogin ? t('users.reset_password') : t('users.temp_password')}
            value={password}
            onChangeText={setPassword}
            error={errs.password || undefined}
            hint={hadLogin ? t('users.reset_password_hint') : t('users.temp_password_hint')}
            autoCapitalize="none"
            autoCorrect={false}
            required={!hadLogin}
          />
        </>
      ) : null}
      <Button title={t('common.save')} onPress={submit} loading={save.isPending} disabled={!name.trim()} needsOnline />
    </Sheet>
  );
}

/** Owner: remove someone - deleted when nothing points at them, else hidden (old records keep the name). */
export function confirmRemovePerson(person: Person, t: TFunction, onDone: () => void) {
  Alert.alert(t('users.remove_q', { name: person.name }), t('users.remove_hint'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('users.remove'),
      style: 'destructive',
      onPress: () =>
        void api
          .del<{ deleted: boolean }>(`/users/${person.id}`)
          .then((r) => {
            toast(r.deleted ? t('users.removed') : t('users.hidden_done'));
            onDone();
          })
          .catch(toastError),
    },
  ]);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
