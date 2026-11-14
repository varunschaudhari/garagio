// Playwright smoke tests. Needs MySQL (docker compose up -d) and PHP.
// PHP_BIN defaults to "php"; on Windows with XAMPP: set PHP_BIN=C:\xampp\php\php.exe
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const php = process.env.PHP_BIN || 'php';

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  globalSetup: './global-setup.js',
  use: {
    baseURL: 'http://127.0.0.1:8098',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'laptop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
      testIgnore: /responsive\.spec\.js/,
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 760 } },
      testMatch: /responsive\.spec\.js/,
    },
  ],
  webServer: {
    command: `"${php}" -S 127.0.0.1:8098 -t "${resolve(root, 'public_html')}" "${resolve(root, 'tools/dev-router.php')}"`,
    // A static file: the API needs garage_e2e, which globalSetup creates only after the server is up.
    url: 'http://127.0.0.1:8098/index.html',
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'ignore',
    env: { GM_CONFIG: resolve(here, 'config.e2e.php'), PHP_CLI_SERVER_WORKERS: '4' },
    timeout: 30_000,
  },
});
