// Publishes a built APK as a GitHub release, so phones always find the newest app at one fixed link:
//   https://github.com/<owner>/<repo>/releases/latest/download/trimurti-garage.apk
// Put that link once in Settings → App → "Link to latest APK"; raise "Minimum app version" to make phones update.
//   node tools/publish-apk.mjs [dist/trimurti-garage-<version>-<commit>.apk]        (Node 18+)
// Without an argument it takes the newest APK in dist/ for the version in mobile/app.json.
// Uses the GitHub login git already has on this computer (git credential fill, the same one `git push` uses);
// the key is read only while publishing and never printed or stored. The repository must be public (phones
// download without logging in). Release tag: app-v<version>; the file is always named trimurti-garage.apk.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSET = 'trimurti-garage.apk';
const API = 'https://api.github.com';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const die = (msg) => {
  console.error('✖ ' + msg);
  process.exit(1);
};
const git = (args, input) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', input, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
  return (r.stdout || '').trim();
};

const app = JSON.parse(readFileSync(join(root, 'mobile', 'app.json'), 'utf8')).expo;
const version = app.version;
const versionCode = app.android?.versionCode;

let apk = process.argv[2];
if (!apk) {
  const dist = join(root, 'dist');
  const found = existsSync(dist) ? readdirSync(dist).filter((f) => f.startsWith(`trimurti-garage-${version}-`) && f.endsWith('.apk')) : [];
  found.sort((a, b) => statSync(join(dist, b)).mtimeMs - statSync(join(dist, a)).mtimeMs);
  if (!found.length) die(`No APK for version ${version} in dist/. Build it first: node tools/build-apk-local.mjs`);
  apk = join(dist, found[0]);
}
if (!existsSync(apk)) die('APK not found: ' + apk);

// The commit the APK was built from (in its file name); the release tag points at it, so it must be on GitHub.
const short = basename(apk).match(/-([0-9a-f]{7,40})\.apk$/)?.[1];
const commit = short ? git(['rev-parse', '--verify', '--quiet', short + '^{commit}']) : '';
if (!commit) die('Cannot tell which commit this APK was built from (expected …-<commit>.apk).');
if (!git(['branch', '-r', '--contains', commit])) die(`Commit ${short} is not pushed to GitHub yet. Push first.`);

const repo = git(['remote', 'get-url', 'origin']).replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) die('origin is not a GitHub repository: ' + repo);

// git's saved GitHub login (Git Credential Manager on Windows).
const token = git(['credential', 'fill'], 'protocol=https\nhost=github.com\n\n').match(/^password=(.+)$/m)?.[1];
if (!token) die('No saved GitHub login for git on this computer. Run `git push` once (it asks you to sign in), then try again.');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'garagio-publish-apk' };

async function gh(method, url, body, extra = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url.startsWith('http') ? url : API + url, { method, headers: { ...headers, ...extra }, body });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      return { status: res.status, json };
    } catch (e) {
      // This office network sometimes drops GitHub connections; try a few times.
      if (attempt >= 4) die(`GitHub could not be reached (${e.cause?.code || e.message}). Check the internet and run again.`);
      console.log(`  connection dropped, retrying (${attempt}/3)…`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const tag = `app-v${version}`;
const subject = git(['log', '-1', '--format=%s', commit]);
const notes = [
  `Android app ${version} (versionCode ${versionCode}), built from ${commit.slice(0, 7)}.`,
  '',
  subject,
  '',
  `Install: open this link on the phone, download ${ASSET} and tap it. Android asks to confirm (apps not from the Play Store).`,
].join('\n');

let rel = await gh('GET', `/repos/${repo}/releases/tags/${tag}`);
if (rel.status === 404) {
  console.log(`Creating release ${tag} in ${repo}…`);
  rel = await gh('POST', `/repos/${repo}/releases`, JSON.stringify({ tag_name: tag, target_commitish: commit, name: `App ${version}`, body: notes, make_latest: 'true' }), { 'Content-Type': 'application/json' });
  if (rel.status !== 201) die(`GitHub refused to create the release (${rel.status}: ${rel.json?.message || ''}).`);
} else if (rel.status === 200) {
  console.log(`Release ${tag} exists; replacing its APK…`);
  for (const a of rel.json.assets.filter((x) => x.name === ASSET)) await gh('DELETE', `/repos/${repo}/releases/assets/${a.id}`);
  await gh('PATCH', `/repos/${repo}/releases/${rel.json.id}`, JSON.stringify({ make_latest: 'true' }), { 'Content-Type': 'application/json' });
} else {
  die(`GitHub answered ${rel.status}: ${rel.json?.message || ''}`);
}

const data = readFileSync(apk);
console.log(`Uploading ${basename(apk)} as ${ASSET} (${(data.length / 1048576).toFixed(1)} MB)…`);
const up = await gh('POST', `https://uploads.github.com/repos/${repo}/releases/${rel.json.id}/assets?name=${ASSET}`, data, { 'Content-Type': 'application/vnd.android.package-archive' });
if (up.status !== 201) die(`Upload failed (${up.status}: ${up.json?.message || ''}). Run again to retry.`);

// Check the fixed link now serves this file (follows GitHub's redirect to its file storage).
const link = `https://github.com/${repo}/releases/latest/download/${ASSET}`;
const check = await fetch(link, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': 'garagio-publish-apk' } }).catch(() => null);
const size = Number(check?.headers.get('content-length') || 0);
console.log(check?.ok && size === data.length ? `✔ The link serves this APK (${size} bytes).` : `! Uploaded, but the link check did not match (status ${check?.status ?? 'none'}, ${size} bytes); open the link to check.`);
console.log(`\nPhones download the newest app from:\n  ${link}`);
console.log(`Settings → App: "Link to latest APK" = that link; "Minimum app version" = ${version} to make every phone update.`);
