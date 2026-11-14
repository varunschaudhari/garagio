// The web app owns the translations (public_html/assets/i18n). Metro cannot import files
// outside the project, so copy them into src/i18n. Run after editing en.json / mr.json:
//   npm run sync-i18n
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', '..', 'public_html', 'assets', 'i18n');
const to = join(here, '..', 'src', 'i18n');
for (const f of ['en.json', 'mr.json']) {
  copyFileSync(join(from, f), join(to, f));
  console.log(`copied ${f}`);
}
