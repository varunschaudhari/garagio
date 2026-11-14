import * as Linking from 'expo-linking';
import { Download, Smartphone } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, EmptyState, Txt } from '@/components/ui';
import { useSession } from '@/store/session';
import { space, useTheme } from '@/theme';
import { appVersion } from '@/version';

/** Blocks the app when the server needs a newer version (settings.min_app_version). */
export default function Update() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const info = useSession((s) => s.info);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}>
      <EmptyState
        icon={Smartphone}
        title={t('mobile.update_title')}
        text={t('mobile.update_text')}
        action={
          <View style={{ gap: space[3], alignSelf: 'stretch' }}>
            {info?.latest_app_url ? (
              <Button title={t('mobile.update_download')} icon={Download} onPress={() => void Linking.openURL(info.latest_app_url)} />
            ) : null}
            <Txt size="sm" muted center>
              {t('mobile.app_version')}: {appVersion()} → {info?.min_app_version}
            </Txt>
          </View>
        }
      />
    </SafeAreaView>
  );
}
