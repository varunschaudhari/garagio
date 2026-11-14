import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { PartsList } from '@/components/parts';

/** Stand-alone parts list (from More, or a scanned rack label: ?location=2&rack=G1). */
export default function PartsScreen() {
  const { t } = useTranslation();
  const { location, rack } = useLocalSearchParams<{ location?: string; rack?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: rack ? t('mobile.rack_parts', { rack }) : t('parts.title') }} />
      <PartsList location={location ? Number(location) : undefined} rack={rack || undefined} />
    </>
  );
}
