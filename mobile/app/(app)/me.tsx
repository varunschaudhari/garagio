import { router } from 'expo-router';
import { Globe, KeyRound, LogOut } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { queryClient } from '@/api/queries';
import { Button, Card, Divider, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { useSession } from '@/store/session';
import { space } from '@/theme';
import type { Lang } from '@/types';
import { appVersion } from '@/version';

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Txt muted>{label}</Txt>
      <Txt weight="semibold" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Txt>
    </View>
  );
}

export default function Me() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const lang = useSession((s) => s.lang);
  const server = useSession((s) => s.server);
  const setLang = useSession((s) => s.setLang);
  const logout = useSession((s) => s.logout);
  const forgetServer = useSession((s) => s.forgetServer);

  const changeLang = async (l: Lang) => {
    await setLang(l);
    api.post('/auth/language', { language: l }).catch(() => {});
  };

  const confirmLogout = () =>
    Alert.alert(t('auth.logout'), t('mobile.logout_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.logout'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          queryClient.clear();
          router.replace('/login');
        },
      },
    ]);

  const changeServer = () =>
    Alert.alert(t('mobile.change_server'), server?.base ?? '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('mobile.change_server'),
        style: 'destructive',
        onPress: async () => {
          await forgetServer();
          queryClient.clear();
          router.replace('/setup');
        },
      },
    ]);

  if (!user) return null;
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <Card style={{ gap: space[3] }}>
          <Txt size="xl" weight="bold">
            {user.name}
          </Txt>
          <Line label={t('users.username')} value={'@' + user.username} />
          <Divider />
          <Line label={t('users.role')} value={t(`roles.${user.role}`)} />
        </Card>
        <Card style={{ gap: space[3] }}>
          <Txt weight="semibold">{t('common.language')}</Txt>
          <Segmented<Lang>
            value={lang}
            onChange={(l) => void changeLang(l)}
            options={[
              { value: 'mr', label: 'मराठी' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Card>
        <Button title={t('auth.change_password')} icon={KeyRound} variant="secondary" onPress={() => router.push('/password')} needsOnline />
        <Button title={t('auth.logout')} icon={LogOut} variant="danger" onPress={confirmLogout} />
        <Card style={{ gap: space[3] }}>
          <Line label={t('mobile.server')} value={server?.base ?? ''} />
          <Divider />
          <Line label={t('mobile.app_version')} value={appVersion()} />
          <Button title={t('mobile.change_server')} icon={Globe} variant="ghost" small onPress={changeServer} />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3], alignItems: 'center' },
});
