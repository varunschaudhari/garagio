import { router } from 'expo-router';
import { Eye, EyeOff, LogIn } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { queryClient } from '@/api/queries';
import { GradientPanel, Logo } from '@/components/brand';
import { Banner, Button, Card, Field, IconButton, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { errorText } from '@/i18n';
import { useSession } from '@/store/session';
import { radius, space, useTheme } from '@/theme';
import type { Lang, User } from '@/types';

export default function Login() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const info = useSession((s) => s.info);
  const lang = useSession((s) => s.lang);
  const setLang = useSession((s) => s.setLang);
  const setAuth = useSession((s) => s.setAuth);
  const setUser = useSession((s) => s.setUser);
  const server = useSession((s) => s.server);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passRef = useRef<TextInputInstance>(null);

  const shop = (lang === 'mr' ? info?.shop_name_mr || info?.shop_name : info?.shop_name) ?? server?.base ?? '';

  const submit = async () => {
    setError(null);
    if (!username.trim() || !password) {
      setError(t('errors.bad_credentials'));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ token: string; user: User }>('/auth/login', { username: username.trim(), password });
      queryClient.clear();
      await setAuth(res.token, res.user);
      const me = await api.get<{ user: User; can_see_cost: boolean }>('/auth/me');
      setUser(me.user, me.can_see_cost);
      router.replace(res.user.must_change_password ? { pathname: '/password', params: { forced: '1' } } : '/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <GradientPanel radius={28} style={styles.hero}>
            <View style={styles.logoRing}>
              <Logo size={64} />
            </View>
            <Txt size="xl" weight="bold" center numberOfLines={2} style={{ color: '#FFFFFF' }}>
              {shop}
            </Txt>
            <Txt size="sm" weight="semibold" center style={{ color: 'rgba(255,255,255,0.92)' }}>
              {t('app.name')}
            </Txt>
          </GradientPanel>
          <Card style={{ gap: space[4], padding: space[5] }}>
          <Segmented<Lang>
            value={lang}
            onChange={(l) => void setLang(l)}
            options={[
              { value: 'mr', label: 'मराठी' },
              { value: 'en', label: 'English' },
            ]}
          />
          <View style={{ gap: space[1] }}>
            <Txt size="xxl" weight="bold">
              {t('auth.login_title')}
            </Txt>
            <Txt muted>{t('auth.login_sub')}</Txt>
          </View>
          {error ? <Banner tone="danger" text={error} /> : null}
          <Field
            label={t('auth.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            returnKeyType="next"
            onSubmitEditing={() => passRef.current?.focus()}
          />
          <Field
            ref={passRef}
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={submit}
            right={<IconButton icon={show ? EyeOff : Eye} label={t(show ? 'auth.hide_password' : 'auth.show_password')} onPress={() => setShow(!show)} />}
          />
          <Button title={t('auth.sign_in')} icon={LogIn} onPress={submit} loading={busy} needsOnline />
          </Card>
          <Button title={t('mobile.change_server')} variant="ghost" small onPress={() => router.replace('/setup')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space[5], gap: space[5], flexGrow: 1, justifyContent: 'center' },
  hero: { alignItems: 'center', gap: space[1], paddingVertical: space[6], paddingHorizontal: space[5] },
  logoRing: { padding: 5, borderRadius: radius.xl, backgroundColor: '#FFFFFF', marginBottom: space[2] },
});
