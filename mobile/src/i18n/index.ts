// UI strings are shared with the web app (public_html/assets/i18n). Run `npm run sync-i18n` after editing them.
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import mr from './mr.json';
import type { Lang, Named } from '@/types';
import { ApiError } from '@/api/client';

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, mr: { translation: mr } },
  lng: 'mr',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

export function setI18nLang(lang: Lang) {
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
}

/** Name in the current language, falling back to the other one. */
export function nm(obj: object | null | undefined, base = 'name'): string {
  if (!obj) return '';
  const o = obj as Record<string, unknown>;
  const mr = (o[`${base}_mr`] as string | null | undefined) || '';
  const en = (o[`${base}_en`] as string | null | undefined) || '';
  return i18n.language === 'mr' ? mr || en : en || mr;
}

/** The other-language name, for a subtitle. */
export function nmAlt(obj: Partial<Named> | null | undefined): string {
  if (!obj) return '';
  const alt = i18n.language === 'mr' ? obj.name_en : obj.name_mr;
  return alt && alt !== nm(obj) ? alt : '';
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    if (i18n.exists(key)) return i18n.t(key);
    if (err.code === 'server_invalid') return i18n.t('mobile.server_invalid');
    return err.message || i18n.t('errors.server_error');
  }
  return i18n.t('errors.server_error');
}

export function fieldError(code: unknown): string {
  const key = `fields.${String(code)}`;
  return i18n.exists(key) ? i18n.t(key) : i18n.t('fields.invalid');
}
