import { useColorScheme } from 'react-native';
import { useSession } from '@/store/session';
import { fontFamilies, palette, type Weight } from './tokens';

export * from './tokens';

/** Colours for the current scheme and the font family for the user's language. */
export function useTheme() {
  const scheme = useColorScheme();
  const lang = useSession((s) => s.lang);
  const dark = scheme === 'dark';
  const families = fontFamilies[lang];
  return {
    c: dark ? palette.dark : palette.light,
    dark,
    lang,
    font: (w: Weight = 'regular') => families[w],
  };
}
