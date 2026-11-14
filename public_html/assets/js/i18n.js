// UI strings from assets/i18n/{en,mr}.json (shared with the Android app).
// Missing Marathi keys fall back to English, then to the key itself.

const dicts = { en: {}, mr: {} };
let lang = readLang();
const listeners = new Set();

function readLang() {
  try {
    const l = localStorage.getItem('gm.lang');
    return l === 'en' || l === 'mr' ? l : 'mr';
  } catch {
    return 'mr';
  }
}

export async function loadI18n() {
  const [en, mr] = await Promise.all([
    fetch('assets/i18n/en.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('assets/i18n/mr.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  dicts.en = en;
  dicts.mr = mr;
  document.documentElement.lang = lang;
}

function lookup(dict, key) {
  return key.split('.').reduce((node, k) => (node && typeof node === 'object' ? node[k] : undefined), dict);
}

export function has(key) {
  return typeof lookup(dicts.en, key) === 'string' || typeof lookup(dicts.mr, key) === 'string';
}

export function t(key, vars) {
  let s = lookup(dicts[lang], key);
  if (typeof s !== 'string') s = lookup(dicts.en, key);
  if (typeof s !== 'string') return key;
  if (vars) s = s.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

/** Translate in a specific language (for bilingual documents). */
export function tIn(l, key, vars) {
  const saved = lang;
  lang = l;
  try {
    return t(key, vars);
  } finally {
    lang = saved;
  }
}

export const getLang = () => lang;

export function setLang(l) {
  if (l !== 'en' && l !== 'mr') return;
  const changed = l !== lang;
  lang = l;
  try {
    localStorage.setItem('gm.lang', l);
  } catch {
    /* private mode */
  }
  document.documentElement.lang = l;
  if (changed) listeners.forEach((fn) => fn(l));
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Bilingual record name in the user's language: nm(part) uses name_mr / name_en. */
export function nm(obj, base = 'name') {
  if (!obj) return '';
  const mr = obj[base + '_mr'];
  const en = obj[base + '_en'];
  return lang === 'mr' ? mr || en || '' : en || mr || '';
}

/** The other-language name, shown as a subtitle. */
export function nmAlt(obj, base = 'name') {
  if (!obj) return '';
  const mr = obj[base + '_mr'];
  const en = obj[base + '_en'];
  const alt = lang === 'mr' ? en : mr;
  return alt && alt !== nm(obj, base) ? alt : '';
}

export function errorText(err) {
  if (err && err.code && has('errors.' + err.code)) return t('errors.' + err.code);
  return (err && err.message) || t('errors.server_error');
}

export function fieldError(code) {
  return has('fields.' + code) ? t('fields.' + code) : String(code);
}
