// Shared building blocks. Big text and big targets: the app is used with greasy hands in a noisy shop.
import { useNetInfo } from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { WifiOff } from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { elevation, radius, size, space, touch, useTheme, type Colors, type Weight } from '@/theme';

/* ------------------------------------------------------------------ text */

type TxtProps = {
  children?: React.ReactNode;
  size?: keyof typeof size;
  weight?: Weight;
  color?: keyof Colors;
  muted?: boolean;
  center?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  tabular?: boolean;
  selectable?: boolean;
  onPress?: () => void;
};

export function Txt({ children, size: s = 'md', weight = 'regular', color, muted, center, numberOfLines, style, tabular, selectable, onPress }: TxtProps) {
  const { c, font } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      onPress={onPress}
      accessibilityRole={onPress ? 'link' : undefined}
      style={[
        {
          fontFamily: font(weight),
          fontSize: size[s],
          lineHeight: Math.round(size[s] * 1.45),
          color: color ? c[color] : muted ? c.muted : c.text,
          textAlign: center ? 'center' : undefined,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------ online state */

export function useOnline(): boolean {
  const net = useNetInfo();
  // null while unknown: assume online so the first render does not flash a banner
  return net.isConnected !== false && net.isInternetReachable !== false;
}

export function OfflineBanner() {
  const online = useOnline();
  const { c } = useTheme();
  const { t } = useTranslation();
  if (online) return null;
  return (
    <View style={[styles.banner, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
      <WifiOff size={18} color={c.warningText} />
      <Txt size="sm" color="warningText" style={{ flex: 1 }}>
        {t('common.offline')}
      </Txt>
    </View>
  );
}

/* ------------------------------------------------------------------ button */

type ButtonProps = {
  title: string;
  onPress?: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Disable while offline (no offline writes in v1). */
  needsOnline?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({ title, onPress, variant = 'primary', icon: Icon, loading, disabled, needsOnline, small, style, accessibilityLabel }: ButtonProps) {
  const { c } = useTheme();
  const online = useOnline();
  const off = disabled || loading || (needsOnline && !online);
  const bg = { primary: c.primary, secondary: c.surface, ghost: 'transparent', danger: c.danger }[variant];
  const fg = { primary: c.primaryInk, secondary: c.text, ghost: c.text, danger: '#FFFFFF' }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        void onPress?.();
      }}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: small ? touch.min : touch.button,
          backgroundColor: pressed && variant === 'primary' ? c.primaryPressed : pressed ? c.surface2 : bg,
          borderColor: variant === 'secondary' ? c.borderStrong : 'transparent',
          opacity: off ? 0.5 : 1,
          ...(variant === 'primary' && !off ? { shadowColor: c.brandMid, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 3 } : {}),
          paddingHorizontal: small ? space[3] : space[5],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : Icon ? <Icon size={small ? 18 : 22} color={fg} /> : null}
      <Txt size={small ? 'sm' : 'md'} weight="semibold" style={{ color: fg }}>
        {title}
      </Txt>
    </Pressable>
  );
}

export function IconButton({ icon: Icon, onPress, label, color }: { icon: LucideIcon; onPress: () => void; label: string; color?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? c.surface2 : 'transparent' }]}
    >
      <Icon size={24} color={color ?? c.text} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ inputs */

type FieldProps = TextInputProps & {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  right?: React.ReactNode;
};

export const Field = React.forwardRef<TextInputInstance, FieldProps>(function Field({ label, error, hint, required, right, style, ...rest }, ref) {
  const { c, font } = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Txt size="sm" weight="semibold">
        {label}
        {required ? <Txt color="danger"> *</Txt> : null}
      </Txt>
      <View style={[styles.inputWrap, { borderColor: error ? c.danger : focused ? c.primary : c.borderStrong, backgroundColor: c.surface }]}>
        <TextInput
          ref={ref}
          placeholderTextColor={c.muted}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          accessibilityLabel={label}
          style={[styles.input, { color: c.text, fontFamily: font('regular') }, style]}
        />
        {right}
      </View>
      {error ? (
        <Txt size="sm" color="dangerText">
          {error}
        </Txt>
      ) : hint ? (
        <Txt size="sm" muted>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
});

/* ------------------------------------------------------------------ layout */

export function Card({ children, style, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { c } = useTheme();
  return <View style={[styles.card, elevation.card, { backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow, padding: padded ? space[4] : 0 }, style]}>{children}</View>;
}

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary' }) {
  const { c } = useTheme();
  const map = {
    neutral: [c.surface2, c.muted],
    success: [c.successSoft, c.successText],
    warning: [c.warningSoft, c.warningText],
    danger: [c.dangerSoft, c.dangerText],
    info: [c.infoSoft, c.infoText],
    primary: [c.primarySoft, c.primaryText],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Txt size="xs" weight="semibold" style={{ color: fg }}>
        {label}
      </Txt>
    </View>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: c.surface2 }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, active && [{ backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow }, elevation.card]]}
          >
            <Txt size="sm" weight="semibold" color={active ? 'text' : 'muted'} numberOfLines={1}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyArt, { backgroundColor: c.primarySoft }]}>
        <Icon size={32} color={c.primaryText} />
      </View>
      <Txt size="lg" weight="semibold" center>
        {title}
      </Txt>
      {text ? (
        <Txt muted center>
          {text}
        </Txt>
      ) : null}
      {action}
    </View>
  );
}

export function Banner({ text, tone = 'info', icon: Icon }: { text: string; tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: LucideIcon }) {
  const { c } = useTheme();
  const bg = { info: c.infoSoft, warning: c.warningSoft, danger: c.dangerSoft, success: c.successSoft }[tone];
  const fg = { info: c.infoText, warning: c.warningText, danger: c.dangerText, success: c.successText }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg, borderRadius: radius.card }]}>
      {Icon ? <Icon size={18} color={fg} /> : null}
      <Txt size="sm" style={{ color: fg, flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

/** The grand total of a bill, on a soft orange band. */
export function TotalBand({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.total, { backgroundColor: c.primarySoft }]} accessibilityLabel={`${label}: ${value}`}>
      <Txt size="md" weight="bold" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt size="xl" weight="bold" tabular style={{ color: c.primaryText }}>
        {value}
      </Txt>
    </View>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

export function Loading() {
  const { c } = useTheme();
  return (
    <View style={styles.empty}>
      <ActivityIndicator size="large" color={c.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3] },
  total: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderRadius: 14, paddingHorizontal: space[4], paddingVertical: space[3] },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], borderRadius: radius.input, borderWidth: 1 },
  iconButton: { width: touch.button, height: touch.button, alignItems: 'center', justifyContent: 'center', borderRadius: radius.chip },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.input, minHeight: touch.button },
  input: { flex: 1, fontSize: size.lg, paddingHorizontal: space[3], paddingVertical: space[2] },
  card: { borderWidth: 1, borderRadius: radius.card },
  chip: { borderRadius: radius.chip, paddingHorizontal: space[3], paddingVertical: 3, alignSelf: 'flex-start' },
  seg: { flexDirection: 'row', padding: 4, borderRadius: radius.input, gap: 2 },
  segItem: { flex: 1, minHeight: touch.min - 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: space[2] },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space[8], gap: space[3] },
  emptyArt: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
});
