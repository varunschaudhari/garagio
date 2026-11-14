// Build the upload packages for cPanel from the last commit (never from uncommitted files).
//   node tools/make-release.mjs
// Writes to dist/:
//   garage-manager-<date>-<sha>-site.zip      → extract INSIDE public_html (contents, incl. .htaccess)
//   garage-manager-<date>-<sha>-database.zip  → schema.sql, seed.sql, migrations/ for phpMyAdmin
//   garage-manager-<date>-<sha>-docs.zip      → DEPLOY.md, GO_LIVE.md, user guide, checklists
// config.php is never in the zip (it is not in git); on an update, keep the server's config.php and storage/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const dirty = git('status', '--porcelain');
if (dirty) {
  console.warn('Note: you have uncommitted changes. The packages contain the last commit only:\n' + dirty + '\n');
}
const sha = git('rev-parse', '--short', 'HEAD');
const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const base = `garage-manager-${day}-${sha}`;
const out = resolve(root, 'dist');
fs.mkdirSync(out, { recursive: true });

const pack = (suffix, ...treeish) => {
  const file = resolve(out, `${base}-${suffix}.zip`);
  execFileSync('git', ['archive', '--format=zip', '-o', file, ...treeish], { cwd: root });
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ${file}  (${kb} KB)`);
  return file;
};

console.log(`Release ${base}`);
pack('site', 'HEAD:public_html');
pack('database', 'HEAD:database');
pack('docs', 'HEAD:docs', 'DEPLOY.md', 'GO_LIVE.md', 'USER_GUIDE_MR.md', 'MOBILE_TEST_CHECKLIST.md', 'PRINTER_SETUP.md', 'API.md');

const migrations = git('ls-tree', '--name-only', 'HEAD', 'public_html/api/migrations/').split('\n').filter((f) => f.endsWith('.sql'));
console.log(`\nNext (see docs/DEPLOY.md):
  1. First install: import schema.sql then seed.sql; extract the site zip inside public_html; create api/config.php.
  2. Update: back up first, extract the site zip over public_html (keep api/config.php and api/storage/).
${migrations.length ? '     Then run api/cron/migrate.php (applies: ' + migrations.map((m) => m.split('/').pop()).join(', ') + ')' : '     No database migrations in this release.'}
  3. Log in as owner → Settings → System: every line should be green or yellow.`);
