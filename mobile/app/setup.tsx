import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Globe, Wrench } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { probeServer } from '@/api/client';
import { Button, Field, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { errorText } from '@/i18n';
import { useSession } from '@/store/session';
import { radius, space, useTheme } from '@/theme';
import type { Lang } from '@/types';

/** First launch: server address and language. */
export default function Setup() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const lang = useSession((s) => s.lang);
  const setLang = useSession((s) => s.setLang);
  const setServer = useSession((s) => s.setServer);
  const current = useSession((s) => s.server);
  const fallback = (Constants.expoConfig?.extra as { defaultServer?: string } | undefined)?.defaultServer ?? 'https://';
  const [url, setUrl] = useState(current?.base ?? fallback);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      const { server, info } = await probeServer(url);
      await setServer(server, info);
      router.replace('/login');
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
          <View style={[styles.mark, { backgroundColor: c.primary }]}>
            <Wrench size={36} color={c.primaryInk} />
          </View>
          <Txt size="xl" weight="bold">
            {t('mobile.setup_title')}
          </Txt>
          <Txt muted>{t('mobile.setup_sub')}</Txt>

          <View style={{ gap: space[2] }}>
            <Txt size="sm" weight="semibold">
              {t('mobile.choose_language')}
            </Txt>
            <Segmented<Lang>
              value={lang}
              onChange={(l) => void setLang(l)}
              options={[
                { value: 'mr', label: 'मराठी' },
                { value: 'en', label: 'English' },
              ]}
            />
          </View>

          <Field
            label={t('mobile.server')}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint={t('auth.server_hint')}
            error={error}
            onSubmitEditing={connect}
            returnKeyType="go"
          />
          <Button title={t('mobile.connect')} icon={Globe} onPress={connect} loading={busy} needsOnline />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space[6], gap: space[5], flexGrow: 1, justifyContent: 'center' },
  mark: { width: 64, height: 64, borderRadius: radius.card + 6, alignItems: 'center', justifyContent: 'center' },
});
