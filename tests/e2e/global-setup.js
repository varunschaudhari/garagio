import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export default function globalSetup() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '../..');
  execFileSync(process.env.PHP_BIN || 'php', [resolve(root, 'tools/reset-dev-db.php'), resolve(here, 'config.e2e.php'), '--e2e'], { stdio: 'inherit' });
}
