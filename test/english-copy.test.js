import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const decodeEscapes = text => text.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})/gi, (match, full, short) => {
  const code = parseInt(full ?? short, 16);
  return code <= 0x10ffff ? String.fromCodePoint(code) : match;
});
const untranslated = text => /\p{Script=Han}/u.test(text) || [...text].some(char => {
  const code = char.codePointAt(0);
  return (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef);
});

async function filesIn(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (/\.(?:[cm]?js|html|md|json|css)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test('current source, docs, fixtures, and bundle contain no untranslated Chinese text', async () => {
  const files = ['README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'package.json', 'extension.js'].map(path => resolve(root, path));
  for (const dir of ['src', 'scripts', 'test', 'docs']) files.push(...await filesIn(resolve(root, dir)));
  const failures = [];
  for (const file of files) {
    if (untranslated(decodeEscapes(await readFile(file, 'utf8')))) failures.push(file.slice(root.length));
  }
  assert.deepEqual(failures, [], `Untranslated text remains in: ${failures.join(', ')}`);
});
