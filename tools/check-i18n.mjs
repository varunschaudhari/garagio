// Checks that en.json and mr.json have the same keys and the same {{placeholders}},
// and that the mobile copies match the web files.
//   node tools/check-i18n.mjs
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = (l) => resolve(root, 'public_html/assets/i18n', `${l}.json`);
const mobile = (l) => resolve(root, 'mobile/src/i18n', `${l}.json`);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}
const vars = (s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');

const problems = [];
const en = flatten(load(web('en')));
const mr = flatten(load(web('mr')));
for (const k of Object.keys(en)) {
  if (!(k in mr)) problems.push(`mr.json is missing "${k}"`);
  else if (vars(en[k]) !== vars(mr[k])) problems.push(`placeholders differ for "${k}": en {${vars(en[k])}} mr {${vars(mr[k])}}`);
  else if (en[k].trim() !== '' && mr[k].trim() === '') problems.push(`mr.json has an empty "${k}"`);
}
for (const k of Object.keys(mr)) if (!(k in en)) problems.push(`en.json is missing "${k}"`);

for (const l of ['en', 'mr']) {
  if (!fs.existsSync(mobile(l)) || fs.readFileSync(mobile(l), 'utf8') !== fs.readFileSync(web(l), 'utf8')) {
    problems.push(`mobile/src/i18n/${l}.json is out of date - run "npm run sync-i18n" in mobile/`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`i18n OK: ${Object.keys(en).length} keys in both languages, mobile copies in sync`);
