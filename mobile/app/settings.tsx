import { Save } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { api, ApiError } from '@/api/client';
import { useSettings, useWorkMutation } from '@/api/queries';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Field, Loading, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { fieldError } from '@/i18n';
import { space } from '@/theme';

const KEYS = ['shop_name', 'shop_name_mr', 'shop_phone', 'shop_gstin', 'shop_address', 'shop_address_mr', 'approval_limit', 'upi_id'] as const;
type Key = (typeof KEYS)[number] | 'receipt_width' | 'gst_registered';

/** Owner: the settings most often changed from a phone. Everything else is on the web. */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const s = useSettings();
  const [edits, setEdits] = useState<Partial<Record<Key, string>>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const save = useWorkMutation((body: unknown) => api.put('/settings', body));

  if (!s.data) return <Loading />;
  const val = (k: Key) => edits[k] ?? s.data[k] ?? '';

  const submit = async () => {
    try {
      await save.mutateAsync(edits);
      toast(t('common.saved'));
      setEdits({});
      setErrs({});
      void s.refetch();
    } catch (e) {
      if (e instanceof ApiError) setErrs(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, fieldError(v)])));
      toastError(e);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space[3] }}>
          {KEYS.map((k) => (
            <Field
              key={k}
              label={t(`settings.${k}`)}
              value={val(k)}
              onChangeText={(v) => setEdits((e) => ({ ...e, [k]: v }))}
              keyboardType={k === 'approval_limit' ? 'decimal-pad' : k === 'shop_phone' ? 'phone-pad' : 'default'}
              autoCapitalize={k === 'shop_gstin' ? 'characters' : 'sentences'}
              multiline={k === 'shop_address' || k === 'shop_address_mr'}
              placeholder={k === 'upi_id' ? t('settings.upi_placeholder') : undefined}
              hint={k === 'approval_limit' ? t('settings.approval_limit_hint') : k === 'upi_id' ? t('settings.upi_hint') : undefined}
              error={errs[k]}
            />
          ))}
          <Txt size="sm" weight="semibold">{t('settings.gst_registered')}</Txt>
          <Segmented
            options={[
              { value: '0', label: t('common.no') },
              { value: '1', label: t('common.yes') },
            ]}
            value={val('gst_registered') === '1' ? '1' : '0'}
            onChange={(v) => setEdits((e) => ({ ...e, gst_registered: v }))}
          />
          <Txt size="sm" muted>{t('settings.gst_registered_hint')}</Txt>
          <Txt size="sm" weight="semibold">{t('settings.receipt_width')}</Txt>
          <Segmented
            options={[
              { value: '58', label: t('settings.receipt_58') },
              { value: '80', label: t('settings.receipt_80') },
            ]}
            value={val('receipt_width') || '80'}
            onChange={(v) => setEdits((e) => ({ ...e, receipt_width: v }))}
          />
        </Card>
        <Banner tone="warning" text={t('settings.ca_note')} />
        <Button title={t('common.save_changes')} icon={Save} onPress={submit} disabled={!Object.keys(edits).length} loading={save.isPending} needsOnline />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
