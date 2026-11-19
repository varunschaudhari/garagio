import React, { useId } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme';

/*
 * The shop's look: the logo ("TA" monogram over a road line on the orange gradient), gradient panels and the
 * number plate for a bike. The same logo drawing is in the web app (assets/js/ui/logo.js) and on the bills.
 */

function Glyph() {
  return (
    <G fill="#FFFFFF">
      <Rect x={9} y={14} width={20} height={6} rx={1.5} />
      <Rect x={16} y={14} width={6} height={28} rx={1.5} />
      <Path fillRule="evenodd" d="M33 42 41.5 14h5L55 42h-5.5l-1.9-6.5h-7.2L38.5 42zm8.8-11.2h4.4L44 23.2z" />
      <Rect x={9} y={47} width={46} height={3} rx={1.5} opacity={0.6} />
    </G>
  );
}

/** The logo badge. */
export function Logo({ size = 56 }: { size?: number }) {
  const { c } = useTheme();
  const id = `logo${useId().replace(/:/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Trimurti Auto">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={c.brandFrom} />
          <Stop offset="0.6" stopColor={c.brandMid} />
          <Stop offset="1" stopColor={c.brandTo} />
        </LinearGradient>
      </Defs>
      <Rect width={64} height={64} rx={18} fill={`url(#${id})`} />
      <Glyph />
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
