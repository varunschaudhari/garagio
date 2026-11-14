import { X } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space, useTheme } from '@/theme';
import { IconButton, Txt } from './ui';

/** Bottom sheet for short forms (payments, adjustments). `full` makes it a tall picker. */
export function Sheet({ visible, onClose, title, children, full = false }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; full?: boolean }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel={t('common.close')} />
      <KeyboardAvoidingView behavior="padding" style={styles.wrap} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + space[3] }, full && { height: '88%' }]}>
          <View style={styles.head}>
            <Txt size="lg" weight="bold" style={{ flex: 1 }} numberOfLines={1}>
              {title}
            </Txt>
            <IconButton icon={X} label={t('common.close')} onPress={onClose} />
          </View>
          {full ? (
            <View style={{ flex: 1 }}>{children}</View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: space[4], paddingHorizontal: space[5], paddingBottom: space[2] }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: space[2], maxHeight: '92%' },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: space[5], paddingRight: space[2] },
});
