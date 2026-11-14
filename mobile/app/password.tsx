import { router, Stack, useLocalSearchParams } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { api, ApiError } from '@/api/client';
import { toast } from '@/components/toast';
import { Banner, Button, Field, OfflineBanner, Txt } from '@/components/ui';
import { errorText, fieldError } from '@/i18n';
import { useSession } from '@/store/session';
import { space, useTheme } from '@/theme';
import type { User } from '@/types';

/** Change password. With ?forced=1 this is the first-login step and cannot be skipped. */
export default function Password() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { forced } = useLocalSearchParams<{ forced?: string }>();
  const isForced = forced === '1';
  const setAuth = useSession((s) => s.setAuth);
  const logout = useSession((s) => s.logout);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!cur) e.current_password = fieldError('required');
    if (!next) e.new_password = fieldError('required');
    if (next && next !== again) e.confirm_password = t('auth.passwords_dont_match');
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await api.post<{ token: string; user: User }>('/auth/password', { current_password: cur, new_password: next });
      await setAuth(res.token, res.user);
      toast(t('auth.password_changed'));
      if (isForced) router.replace('/');
      else router.back();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrs(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, k === 'current_password' && v === 'wrong' ? t('errors.wrong_password') : fieldError(v)])));
      } else {
        setErrs({ form: errorText(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      <Stack.Screen options={{ headerBackVisible: !isForced, gestureEnabled: !isForced, title: isForced ? t('auth.must_change_title') : t('auth.change_password') }} />
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[6], gap: space[5] }} keyboardShouldPersistTaps="handled">
        {isForced ? <Txt muted>{t('auth.must_change_text')}</Txt> : null}
        {errs.form ? <Banner tone="danger" text={errs.form} /> : null}
        <Field label={t('auth.current_password')} value={cur} onChangeText={setCur} secureTextEntry autoCapitalize="none" error={errs.current_password} />
        <Field label={t('auth.new_password')} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" hint={t('auth.password_hint')} error={errs.new_password} />
        <Field label={t('auth.confirm_password')} value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" error={errs.confirm_password} onSubmitEditing={submit} />
        <Button title={t('auth.change_password')} icon={KeyRound} onPress={submit} loading={busy} needsOnline />
        {isForced ? (
          <Button
            title={t('auth.logout')}
            variant="ghost"
            small
            onPress={async () => {
              await logout();
              router.replace('/login');
            }}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
