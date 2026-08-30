/**
 * 配布用の拡張機能をつくる。
 *
 *   node scripts/package-extension.mjs [--url https://xxx.workers.dev]
 *
 * ★--url を渡すと、接続先を焼き込んだ zip ができる。
 *   接続先は manifest.json / popup.js / background.js の3箇所にあり、
 *   手で直すと必ずどれか1つ忘れる。ここで一括して書き換える。
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'extension');
const OUT = resolve(ROOT, 'dist/note-connect');

const args = process.argv.slice(2);
const i = args.indexOf('--url');
const URL_ARG = i >= 0 && args[i + 1] ? args[i + 1].replace(/\/+$/, '') : null;

if (URL_ARG && !/^https:\/\/[^\s/]+$/.test(URL_ARG)) {
  console.error(`✗ --url は "https://ホスト名" の形で指定してください（パスは付けない）: ${URL_ARG}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

if (URL_ARG) {
  // popup.js / background.js の既定の接続先
  for (const file of ['popup.js', 'background.js']) {
    const path = resolve(OUT, file);
    const before = readFileSync(path, 'utf8');
    const after = before.replace(
      /const DEFAULT_ENDPOINT = '[^']*';/,
      `const DEFAULT_ENDPOINT = '${URL_ARG}';`,
    );
    if (before === after) {
      console.error(`✗ ${file} の接続先を書き換えられませんでした（DEFAULT_ENDPOINT が見つかりません）`);
      process.exit(1);
    }
    writeFileSync(path, after);
  }

  // manifest.json のアクセス許可
  const manifestPath = resolve(OUT, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [
    'https://note.com/*',
    'https://*.note.com/*',
    `${URL_ARG}/*`,
  ];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`接続先を焼き込みました: ${URL_ARG}`);
}

execFileSync('zip', ['-qr', 'note-connect.zip', 'note-connect', '-x', '*.DS_Store'], {
  cwd: resolve(ROOT, 'dist'),
});

// ★焼き込み忘れがないか、できあがったものを読み返して確かめる
const check = readFileSync(resolve(OUT, 'background.js'), 'utf8');
const endpoint = /const DEFAULT_ENDPOINT = '([^']*)';/.exec(check)?.[1];
console.log('dist/note-connect.zip を作成しました');
console.log(`  接続先: ${endpoint}`);
