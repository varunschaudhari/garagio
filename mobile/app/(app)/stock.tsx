import { router } from 'expo-router';
import { ListChecks } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { PartsList } from '@/components/parts';
import { Button } from '@/components/ui';
import { hasRole, useSession } from '@/store/session';
import { space } from '@/theme';

/** Stock lookup: every role can see stock and rack location. */
export default function StockTab() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const canCount = hasRole(user, 'owner', 'inventory');
  return (
    <PartsList
      header={
        canCount ? (
          <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
            <Button title={t('stock.count_title')} icon={ListChecks} variant="secondary" small onPress={() => router.push('/count')} />
          </View>
        ) : null
      }
    />
  );
}
