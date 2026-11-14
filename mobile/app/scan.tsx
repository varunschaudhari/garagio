import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Flashlight, FlashlightOff, X } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '@/api/client';
import { toast, toastError } from '@/components/toast';
import { Button, EmptyState, IconButton, Txt } from '@/components/ui';
import { parseRackCode, useScan } from '@/store/scan';
import { space, useTheme } from '@/theme';
import type { Part } from '@/types';

/**
 * QR scanner. mode=open (default): open the scanned part, or the parts on a scanned rack.
 * mode=pick: hand the code back to the screen that opened the scanner (stock count).
 */
export default function Scan() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { mode = 'open' } = useLocalSearchParams<{ mode?: 'open' | 'pick' }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const busy = useRef(false);
  const put = useScan((s) => s.put);

  const onScan = async ({ data }: BarcodeScanningResult) => {
    if (busy.current || !data) return;
    busy.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const code = data.trim();
    if (mode === 'pick') {
      put(code);
      router.back();
      return;
    }
    const rack = parseRackCode(code);
    if (rack) {
      router.replace({ pathname: '/parts', params: { location: String(rack.locationId), rack: rack.rack } });
      return;
    }
    try {
      const res = await api.get<{ item: Part }>(`/parts/by-code/${encodeURIComponent(code)}`);
      router.replace(`/part/${res.item.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) toast(t('mobile.scanned_unknown', { code }), 'error');
      else toastError(e);
      setTimeout(() => (busy.current = false), 1500);
    }
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}>
        <EmptyState
          icon={Camera}
          title={t('mobile.scan_title')}
          text={t('mobile.camera_needed')}
          action={
            <View style={{ gap: space[3], alignSelf: 'stretch' }}>
              <Button title={t('mobile.allow_camera')} icon={Camera} onPress={() => void requestPermission()} />
              <Button title={t('common.close')} variant="ghost" onPress={() => router.back()} />
            </View>
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13'] }}
        onBarcodeScanned={onScan}
      />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.top}>
          <IconButton icon={X} label={t('common.close')} color="#FFFFFF" onPress={() => router.back()} />
          <IconButton icon={torch ? FlashlightOff : Flashlight} label={t('mobile.torch')} color="#FFFFFF" onPress={() => setTorch(!torch)} />
        </View>
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={[styles.frame, { borderColor: c.primary }]} />
        </View>
        <View style={styles.bottom}>
          <Txt center style={{ color: '#FFFFFF' }} weight="semibold">
            {t('mobile.scan_hint')}
          </Txt>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { flexDirection: 'row', justifyContent: 'space-between', padding: space[3] },
  frameWrap: { alignItems: 'center' },
  frame: { width: 260, height: 260, borderWidth: 4, borderRadius: 24 },
  bottom: { padding: space[6], backgroundColor: 'rgba(0,0,0,0.45)' },
});
