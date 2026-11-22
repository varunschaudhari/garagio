import React, { useId } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme';

/*
 * The shop's look: the logo (grey gear, red ring and spanner), gradient panels and the number plate for a bike.
 * The same logo drawing is in the web app (assets/js/ui/logo.js), on the bills and in the Android icons.
 */

const GREY = '#58595B';
const RED = '#C1272D';
const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

/** The logo on a white rounded tile (white in dark mode too, like the signboard). */
export function Logo({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Trimurti Rambhau Auto">
      <Rect width={100} height={100} rx={24} fill="#FFFFFF" />
      <G transform="translate(7 7) scale(0.86)">
        <G fill={GREY}>
          {TEETH.map((a) => (
            <Rect key={a} x={43.5} y={3} width={13} height={13} rx={2.5} transform={`rotate(${a} 50 50)`} />
          ))}
        </G>
        <Circle cx={50} cy={50} r={37} fill="none" stroke={GREY} strokeWidth={8} />
        <Path d="M30.08 61.5A23 23 0 1 1 50 73" fill="none" stroke={RED} strokeWidth={8} />
        <Path fill={RED} d="M52.75 37.02A7.5 7.5 0 1 1 47.25 37.02V43h5.5z" />
        <Rect x={46.75} y={47} width={6.5} height={30} fill={RED} />
      </G>
    </Svg>
  );
}

/** A panel on the brand gradient (Home banner, login header). Children sit on top. */
export function GradientPanel({ children, style, radius = 22 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  const { c } = useTheme();
  const id = `grad${useId().replace(/:/g, '')}`;
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden', shadowColor: c.brandMid, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 6 }, style]}>
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c.brandFrom} />
            <Stop offset="0.6" stopColor={c.brandMid} />
            <Stop offset="1" stopColor={c.brandTo} />
          </LinearGradient>
        </Defs>
        <Rect width={100} height={100} fill={`url(#${id})`} />
      </Svg>
      {/* Soft circles, as on the web banner. */}
      <View pointerEvents="none" style={[styles.circle, { width: 220, height: 220, right: -70, top: -110 }]} />
      <View pointerEvents="none" style={[styles.circle, { width: 160, height: 160, right: 80, bottom: -110 }]} />
      {children}
    </View>
  );
}

/** A bike's registration number drawn like an Indian number plate. */
export function Plate({ reg, large = false }: { reg: string; large?: boolean }) {
  const { font } = useTheme();
  return (
    <View style={[styles.plate, large && styles.plateLg]} accessibilityLabel={reg}>
      <View style={styles.ind}>
        <Svg width={large ? 18 : 14} height={large ? 10 : 8} viewBox="0 0 18 10">
          <Rect width={18} height={10} rx={2} fill="#1D4ED8" />
        </Svg>
      </View>
      <Text style={{ fontFamily: font('bold'), fontSize: large ? 22 : 15, color: '#111827', letterSpacing: 1.2 }}>{reg.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  plate: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderWidth: 2, borderColor: '#111827', borderRadius: 6, backgroundColor: '#FFFFFF', paddingLeft: 3, paddingRight: 8, paddingVertical: 1 },
  plateLg: { borderWidth: 3, borderRadius: 8, paddingLeft: 4, paddingRight: 12, paddingVertical: 2 },
  ind: { justifyContent: 'center' },
});
