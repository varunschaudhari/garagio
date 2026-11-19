import * as ImagePicker from 'expo-image-picker';
import { Camera, Image as ImageIcon, Trash2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { api, apiUrl } from '@/api/client';
import { useSession } from '@/store/session';
import { radius, space, useTheme } from '@/theme';
import { toast, toastError } from './toast';
import { Button, Card, IconButton, Txt } from './ui';

/*
 * Photo of a paper bill (expense or purchase bill). path = "/expenses/<id>/photo" or "/purchases/<id>/photo".
 * version = the stored file name, so a replaced photo is not served from the image cache.
 */

/** Take a photo with the camera or pick one from the gallery; null if cancelled or not allowed. */
export async function pickBillPhoto(source: 'camera' | 'library'): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    return shot.canceled ? null : (shot.assets[0]?.uri ?? null);
  }
  const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  return pick.canceled ? null : (pick.assets[0]?.uri ?? null);
}

export function uploadBillPhoto(path: string, uri: string) {
  const fd = new FormData();
  fd.append('photo', { uri, name: 'bill.jpg', type: 'image/jpeg' } as unknown as Blob);
  return api.post<{ photo: string }>(path, fd);
}

/** The photo with the login token, for <Image>. */
export function useBillPhotoSource(path: string, version: string | null | undefined) {
  const server = useSession((s) => s.server);
  const token = useSession((s) => s.token);
  if (!server || !version) return null;
  return { uri: apiUrl(server, path, { v: version }), headers: { Authorization: `Bearer ${token}`, 'X-Auth-Token': token ?? '' } };
}

/** Full-screen view of a bill photo; tap anywhere to close. */
export function BillPhotoViewer({ path, version, onClose }: { path: string; version: string; onClose: () => void }) {
  const { t } = useTranslation();
  const source = useBillPhotoSource(path, version);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewer} onPress={onClose} accessibilityLabel={t('common.close')}>
        {source ? <Image source={source} style={styles.full} resizeMode="contain" accessibilityLabel={t('bills.photo')} /> : null}
      </Pressable>
    </Modal>
  );
}

/** Camera + gallery buttons for picking a photo before the record exists (new expense / purchase). */
export function BillPhotoPicker({ uri, onChange }: { uri: string | null; onChange: (uri: string | null) => void }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <Txt size="sm" weight="semibold">{t('bills.photo')}</Txt>
      {uri ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <Image source={{ uri }} style={styles.thumb} accessibilityLabel={t('bills.photo')} />
          <IconButton icon={Trash2} label={t('bills.remove_photo')} color={c.dangerText} onPress={() => onChange(null)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={t('bills.take_photo')} icon={Camera} variant="secondary" small onPress={() => void pickBillPhoto('camera').then((u) => u && onChange(u))} style={{ flex: 1 }} />
          <Button title={t('bills.from_gallery')} icon={ImageIcon} variant="secondary" small onPress={() => void pickBillPhoto('library').then((u) => u && onChange(u))} style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );
}

/** Card on a saved record: the photo (tap to enlarge), take / replace, remove. */
export function BillPhotoCard({ path, version, canEdit, onChanged }: { path: string; version: string | null; canEdit: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const source = useBillPhotoSource(path, version);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const replace = async (from: 'camera' | 'library') => {
    const uri = await pickBillPhoto(from);
    if (!uri) return;
    setBusy(true);
    try {
      await uploadBillPhoto(path, uri);
      toast(t('bills.photo_saved'));
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt weight="semibold" style={{ flex: 1 }}>{t('bills.photo')}</Txt>
        {canEdit && version ? (
          <IconButton
            icon={Trash2}
            label={t('bills.remove_photo')}
            color={c.dangerText}
            onPress={() =>
              Alert.alert(t('bills.remove_photo_q'), '', [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.delete'), style: 'destructive', onPress: () => void api.del(path).then(onChanged).catch(toastError) },
              ])
            }
          />
        ) : null}
      </View>
      {source && version ? (
        <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={t('bills.view_photo')}>
          <Image source={source} style={styles.photo} resizeMode="contain" />
        </Pressable>
      ) : (
        <Txt size="sm" muted>{t('bills.no_photo')}</Txt>
      )}
      {canEdit ? (
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button title={version ? t('bills.replace_photo') : t('bills.take_photo')} icon={Camera} variant="secondary" small loading={busy} needsOnline onPress={() => void replace('camera')} style={{ flex: 1 }} />
          <Button title={t('bills.from_gallery')} icon={ImageIcon} variant="secondary" small disabled={busy} needsOnline onPress={() => void replace('library')} style={{ flex: 1 }} />
        </View>
      ) : null}
      {open && version ? <BillPhotoViewer path={path} version={version} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: space[3] },
  full: { width: '100%', height: '100%' },
  thumb: { width: 72, height: 72, borderRadius: radius.input },
  photo: { width: '100%', height: 280, borderRadius: radius.input },
});
