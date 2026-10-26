import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['src', 'scripts']) for (const file of await readdir(resolve(root, dir))) {
  if (/\.[cm]?js$/.test(file)) execFileSync(process.execPath, ['--check', resolve(root, dir, file)]);
}
const bundle = await readFile(resolve(root, 'extension.js'), 'utf8');
assert.doesNotMatch(bundle, /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/);
assert.doesNotMatch(bundle, /\.block\.(move|update)\s*\(/);
assert.doesNotMatch(bundle, /Test graph|user-one|block0001/);
const extension = await import(pathToFileURL(resolve(root, 'extension.js')).href);
assert.equal(typeof extension.default.onload, 'function');
assert.equal(typeof extension.default.onunload, 'function');
console.log('源码语法、构建产物入口、外部网络和源块移动/更新检查通过。');
