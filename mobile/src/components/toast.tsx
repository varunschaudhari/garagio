import * as Haptics from 'expo-haptics';
import { CircleCheck, CircleExclamationPoint, Info } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { errorText } from '@/i18n';
import { radius, space } from '@/theme';
import { Txt } from './ui';

type Tone = 'success' | 'error' | 'info';
interface ToastState {
  msg: string | null;
  tone: Tone;
  seq: number;
}
const useToast = create<ToastState>()(() => ({ msg: null, tone: 'success', seq: 0 }));

/** Short, clear confirmation with a haptic tap (success) or buzz (error). */
export function toast(msg: string, tone: Tone = 'success') {
  useToast.setState((s) => ({ msg, tone, seq: s.seq + 1 }));
  if (tone === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  if (tone === 'error') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

export function toastError(err: unknown) {
  toast(errorText(err), 'error');
}

export function ToastHost() {
  const { msg, tone, seq } = useToast();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(() => useToast.setState({ msg: null }), tone === 'error' ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [seq, msg, tone]);
  if (!msg) return null;
  const Icon = tone === 'error' ? CircleExclamationPoint : tone === 'info' ? Info : CircleCheck;
  const iconColor = tone === 'error' ? '#F87171' : tone === 'info' ? '#93C5FD' : '#4ADE80';
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 80 }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <View style={styles.toast}>
        <Icon size={22} color={iconColor} />
        <Txt style={{ color: '#F9FAFB', flex: 1 }} weight="medium">
          {msg}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space[4], right: space[4], alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: '#111827',
    borderRadius: radius.card,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    maxWidth: 520,
    width: '100%',
    elevation: 6,
  },
});
