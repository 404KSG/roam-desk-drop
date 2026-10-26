import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionLifecycle } from '../src/extension-entry.js';

test('cleanup is safe before loading and on repeated unloads', () => {
  const lifecycle = createExtensionLifecycle(undefined);
  assert.doesNotThrow(() => lifecycle.onunload());
  assert.doesNotThrow(() => lifecycle.onunload());
  assert.throws(() => lifecycle.onload(), /Roam browser environment/);
});
