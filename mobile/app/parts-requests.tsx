import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RequestList } from '@/components/requestList';

/** Parts requests (queue or approvals) as a page, for people who do not have that tab (e.g. the owner from More). */
export default function PartsRequestsScreen() {
  const { t } = useTranslation();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const approvals = mode === 'approvals';
  return (
    <>
      <Stack.Screen options={{ title: approvals ? t('nav.approvals') : t('requests.title') }} />
      <RequestList mode={approvals ? 'approvals' : 'queue'} />
    </>
  );
}
