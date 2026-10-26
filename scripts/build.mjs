import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.ESBUILD_BIN || resolve(root, 'node_modules/.bin/esbuild');
try { await access(binary, constants.X_OK); }
catch { throw new Error('esbuild was not found. Set ESBUILD_BIN to an existing executable; this script will not install dependencies.'); }
execFileSync(binary, ['src/extension-entry.js', '--bundle', '--format=esm', '--platform=browser', '--target=es2020', '--outfile=extension.js', '--legal-comments=inline'], { cwd: root, stdio: 'inherit' });
