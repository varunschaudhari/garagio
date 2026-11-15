// Build a signed release APK on this computer (no Expo account): Expo prebuild + Gradle.
//   node tools/build-apk-local.mjs
// Needs: Java 17+ (JAVA_HOME, ~/.jdks/* or Android Studio's jbr) and the Android SDK
// (ANDROID_HOME or %LOCALAPPDATA%\Android\Sdk). Missing NDK / CMake are downloaded by Gradle.
//
// Signing key: ~/.garagio/trimurti-release.keystore + keystore.properties, created on the first run.
// BACK BOTH FILES UP. Every later APK must be signed with the same key, or phones refuse the update
// (staff would have to uninstall and lose their login).
//
// On Windows the build runs in a short folder (C:\gmb\mobile, or GARAGIO_BUILD_DIR): the C++ builds create
// folders that repeat the project path twice and pass Windows' 260-character limit otherwise. The app is
// mirrored there first (only changed files are copied after the first run).
//
// Output: dist/trimurti-garage-<version>-<commit>.apk
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'mobile');
const win = process.platform === 'win32';
const log = (m) => console.log(`\n▶ ${m}`);
const die = (m) => { console.error(`\n✖ ${m}`); process.exit(1); };

// ---------------------------------------------------------------- tools
function findJavaHome() {
  const candidates = [process.env.JAVA_HOME];
  const jdks = path.join(os.homedir(), '.jdks');
  if (fs.existsSync(jdks)) for (const d of fs.readdirSync(jdks).sort().reverse()) candidates.push(path.join(jdks, d));
  candidates.push('C:/Program Files/Android/Android Studio/jbr', path.join(process.env.LOCALAPPDATA || '', 'Programs/Android Studio/jbr'));
  return candidates.find((p) => p && fs.existsSync(path.join(p, 'bin', win ? 'java.exe' : 'java')));
}
function findSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk'), path.join(os.homedir(), 'Android/Sdk')];
  return candidates.find((p) => p && fs.existsSync(path.join(p, 'platforms')));
}
const javaHome = findJavaHome() || die('Java 17+ not found. Install a JDK (e.g. Temurin 17) or set JAVA_HOME.');
const sdk = findSdk() || die('Android SDK not found. Install Android Studio or set ANDROID_HOME.');
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${env.PATH}`;
console.log(`Java: ${javaHome}\nSDK:  ${sdk}`);

// ---------------------------------------------------------------- signing key (once)
const keyDir = path.join(os.homedir(), '.garagio');
const keystore = path.join(keyDir, 'trimurti-release.keystore');
const keyProps = path.join(keyDir, 'keystore.properties');
if (!fs.existsSync(keyProps)) {
  if (fs.existsSync(keystore)) die(`${keystore} exists but ${keyProps} is missing – restore it from your backup.`);
  log('Creating the release signing key (first build only)');
  fs.mkdirSync(keyDir, { recursive: true });
  const pass = crypto.randomBytes(18).toString('base64url');
  execFileSync(path.join(javaHome, 'bin', win ? 'keytool.exe' : 'keytool'), [
    '-genkeypair', '-noprompt', '-storetype', 'PKCS12', '-keystore', keystore, '-alias', 'trimurti',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-dname', 'CN=Trimurti Auto, O=Trimurti Auto, L=Dharangaon, ST=Maharashtra, C=IN',
    '-storepass', pass, '-keypass', pass,
  ], { stdio: 'inherit' });
  fs.writeFileSync(keyProps, [
    '# Trimurti Garage APK signing key. BACK UP this file and trimurti-release.keystore together.',
    `storeFile=${keystore.replaceAll('\\', '/')}`, `storePassword=${pass}`, 'keyAlias=trimurti', `keyPassword=${pass}`, '',
  ].join('\n'));
  console.log(`\n  !!! New signing key: ${keystore}\n  !!! Password file:   ${keyProps}\n  !!! Copy both to a safe place (Google Drive / pen drive). Without them, future updates cannot install over this APK.\n`);
}

// Version and commit are read now: the APK is built from the files as they are at this moment.
const version = JSON.parse(fs.readFileSync(path.join(source, 'app.json'), 'utf8')).expo.version;
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'mobile', 'public_html/assets/i18n'], { cwd: root, encoding: 'utf8' }).trim() ? '-dirty' : '';

// ---------------------------------------------------------------- where to build
let mobile = source;
if (win) {
  mobile = process.env.GARAGIO_BUILD_DIR || 'C:\\gmb\\mobile';
  log(`Mirroring the app to ${mobile} (short paths for the C++ build; first time copies node_modules)`);
  // /E copies new and changed files; /XD skips our generated android folder and Expo's cache.
  const rc = spawnSync('robocopy', [source, mobile, '/E', '/XD', path.join(source, 'android'), path.join(source, '.expo'), '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'], { stdio: 'inherit' }).status;
  if (rc === null || rc >= 8) die(`robocopy failed (exit ${rc})`);
}

// Some Windows setups mark files Hidden. Windows then refuses to overwrite them ("Access is denied"), and
// library build scripts that rewrite their own AndroidManifest.xml fail. Clear the flag (contents unchanged).
function unhide(dir) {
  if (win && fs.existsSync(dir)) spawnSync('cmd', ['/c', 'attrib -H * /S /D'], { cwd: dir, stdio: 'ignore' });
}
log('Clearing Windows "hidden" flags');
unhide(mobile);

// ---------------------------------------------------------------- native project
const pkgFile = path.join(mobile, 'package.json');
const pkgBefore = fs.readFileSync(pkgFile, 'utf8'); // prebuild rewrites the "android" script; put it back
log('Expo prebuild (android)');
const pre = spawnSync('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], { cwd: mobile, env: { ...env, CI: '1' }, stdio: 'inherit', shell: win });
fs.writeFileSync(pkgFile, pkgBefore);
if (pre.status !== 0) die('prebuild failed');

const android = path.join(mobile, 'android');
unhide(android);

// CMake 3.31+ ships ninja 1.12, which handles paths over 260 characters (with Windows long paths enabled).
// The default CMake 3.22 does not, and the C++ builds of gesture-handler / worklets need such paths.
const CMAKE = '3.31.6';
const cmakeDir = path.join(sdk, 'cmake', CMAKE);
if (win && !fs.existsSync(path.join(cmakeDir, 'bin', 'ninja.exe'))) {
  log(`Installing CMake ${CMAKE} into the Android SDK`);
  const sm = path.join(sdk, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');
  spawnSync('cmd', ['/c', `echo y| "${sm}" "cmake;${CMAKE}"`], { env, stdio: 'inherit' });
}
const localProps = [`sdk.dir=${sdk.replaceAll('\\', '/')}`];
if (fs.existsSync(cmakeDir)) localProps.push(`cmake.dir=${cmakeDir.replaceAll('\\', '/')}`);
fs.writeFileSync(path.join(android, 'local.properties'), localProps.join('\n') + '\n');

// Real phones only (ARM): x86 builds are for emulators and double the build time and size.
const gp = path.join(android, 'gradle.properties');
fs.writeFileSync(gp, fs.readFileSync(gp, 'utf8').replace(/^reactNativeArchitectures=.*$/m, 'reactNativeArchitectures=armeabi-v7a,arm64-v8a'));

// Release builds signed with our key instead of the debug key.
const appGradle = path.join(android, 'app', 'build.gradle');
let g = fs.readFileSync(appGradle, 'utf8');
const releaseSigning = `
        release {
            def props = new Properties()
            file(System.getenv('GARAGIO_KEYSTORE_PROPS')).withInputStream { props.load(it) }
            storeFile file(props['storeFile'])
            storePassword props['storePassword']
            keyAlias props['keyAlias']
            keyPassword props['keyPassword']
        }
    }
    buildTypes {`;
if (!/signingConfigs\s*\{[\s\S]*?\n    \}\n    buildTypes \{/.test(g)) die('Unexpected android/app/build.gradle layout (signingConfigs) – update tools/build-apk-local.mjs');
g = g.replace(/\n    \}\n    buildTypes \{/, releaseSigning);
g = g.replace(/(release \{\s*\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
if (!g.includes('signingConfig signingConfigs.release')) die('Could not switch the release build to the release key');
fs.writeFileSync(appGradle, g);

// ---------------------------------------------------------------- build
log('Gradle assembleRelease (first run downloads Gradle, NDK and libraries: 15–30 min)');
// Full path: some Windows setups do not run programs from the current folder (NoDefaultCurrentDirectoryInExePath).
const gradlew = win ? `"${path.join(android, 'gradlew.bat')}"` : './gradlew';
const b = spawnSync(gradlew, ['assembleRelease', '--no-daemon'], { cwd: android, env: { ...env, GARAGIO_KEYSTORE_PROPS: keyProps }, stdio: 'inherit', shell: win });
if (b.status !== 0) die('Gradle build failed (see the output above)');

const apk = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(apk)) die(`APK not found at ${apk}`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', `trimurti-garage-${version}-${sha}${dirty}.apk`);
fs.copyFileSync(apk, out);
console.log(`\n✔ APK ready: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
