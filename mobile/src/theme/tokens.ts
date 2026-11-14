// Design tokens - mirror of public_html/assets/css/tokens.css. Change both together.

export const palette = {
  light: {
    bg: '#F7F8FA',
    surface: '#FFFFFF',
    surface2: '#F3F4F6',
    border: '#E5E7EB',
    borderStrong: '#D1D5DB',
    text: '#111827',
    muted: '#6B7280',
    primary: '#F97316',
    primaryPressed: '#EA580C',
    primaryInk: '#111827', // dark ink on orange: white fails WCAG AA
    primarySoft: '#FFF1E6',
    primaryText: '#C2410C',
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
    primary: '#FB923C',
    primaryPressed: '#FDBA74',
    primaryInk: '#111827',
    primarySoft: 'rgba(251,146,60,0.14)',
    primaryText: '#FDBA74',
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
    overlay: 'rgba(0,0,0,0.6)',
  },
};

export type Colors = typeof palette.light;

/** 4 px grid */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
export const radius = { input: 8, card: 12, chip: 999 } as const;
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
