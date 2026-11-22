// Design tokens - mirror of public_html/assets/css/tokens.css. Change both together.

export const palette = {
  light: {
    bg: '#F4F6FA',
    surface: '#FFFFFF',
    surface2: '#F1F3F8',
    border: '#E6E9EF',
    borderStrong: '#D2D7E0',
    text: '#111827',
    muted: '#6B7280',
    // The logo's red (Trimurti Rambhau Auto): white on #C1272D is 5.8:1.
    primary: '#C1272D',
    primaryPressed: '#A31F25',
    primaryInk: '#FFFFFF',
    primarySoft: '#FDECEC',
    primaryText: '#B0232A',
    brandGrey: '#58595B',
    success: '#16A34A',
    successSoft: '#DCFCE7',
    successText: '#166534',
    warning: '#D97706',
    warningSoft: '#FEF3C7',
    warningText: '#92400E',
    danger: '#DC2626',
    dangerSoft: '#FEE2E2',
    dangerText: '#991B1B',
    info: '#2563EB',
    infoSoft: '#DBEAFE',
    infoText: '#1E40AF',
    violetSoft: '#EDE9FE',
    violetText: '#5B21B6',
    tealSoft: '#CCFBF1',
    tealText: '#115E59',
    pinkSoft: '#FCE7F3',
    pinkText: '#9D174D',
    /** Brand gradient (Home banner, login): the logo's grey to its red; white text reads on all of it. */
    brandFrom: '#303236',
    brandMid: '#5C2A2E',
    brandTo: '#B3242A',
    shadow: '#101828',
    overlay: 'rgba(17,24,39,0.45)',
  },
  dark: {
    bg: '#0F1115',
    surface: '#171A21',
    surface2: '#1F232C',
    border: '#2A2F3A',
    borderStrong: '#3A4150',
    text: '#F3F4F6',
    muted: '#9CA3AF',
    primary: '#D63339',
    primaryPressed: '#E0484E',
    primaryInk: '#FFFFFF',
    primarySoft: 'rgba(214,51,57,0.16)',
    primaryText: '#FCA5A5',
    brandGrey: '#9CA3AF',
    success: '#4ADE80',
    successSoft: 'rgba(74,222,128,0.14)',
    successText: '#86EFAC',
    warning: '#FBBF24',
    warningSoft: 'rgba(251,191,36,0.14)',
    warningText: '#FCD34D',
    danger: '#F87171',
    dangerSoft: 'rgba(248,113,113,0.14)',
    dangerText: '#FCA5A5',
    info: '#60A5FA',
    infoSoft: 'rgba(96,165,250,0.14)',
    infoText: '#93C5FD',
    violetSoft: 'rgba(167,139,250,0.16)',
    violetText: '#C4B5FD',
    tealSoft: 'rgba(45,212,191,0.14)',
    tealText: '#5EEAD4',
    pinkSoft: 'rgba(244,114,182,0.14)',
    pinkText: '#F9A8D4',
    brandFrom: '#1E1F22',
    brandMid: '#3B1C1F',
    brandTo: '#8E1C22',
    shadow: '#000000',
    overlay: 'rgba(0,0,0,0.6)',
  },
};

export type Colors = typeof palette.light;

/** 4 px grid */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
export const radius = { input: 12, card: 18, xl: 22, chip: 999 } as const;

/** Soft card shadow (Android uses elevation). */
export const elevation = {
  card: { shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  raised: { shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 18, elevation: 5 },
} as const;
/** Type scale 12 / 14 / 16 / 20 / 24 / 32 */
export const size = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 } as const;
/** Big targets for greasy hands: buttons are taller than the 44 px minimum. */
export const touch = { min: 44, button: 52 } as const;

export const fontFamilies = {
  en: { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' },
  mr: {
    regular: 'NotoSansDevanagari_400Regular',
    medium: 'NotoSansDevanagari_500Medium',
    semibold: 'NotoSansDevanagari_600SemiBold',
    bold: 'NotoSansDevanagari_700Bold',
  },
} as const;
export type Weight = keyof typeof fontFamilies.en;
