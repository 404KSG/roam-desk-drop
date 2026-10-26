import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionLifecycle } from '../src/extension-entry.js';

test('尚未加载或重复卸载时清理操作安全', () => {
  const lifecycle = createExtensionLifecycle(undefined);
  assert.doesNotThrow(() => lifecycle.onunload());
  assert.doesNotThrow(() => lifecycle.onunload());
  assert.throws(() => lifecycle.onload(), /Roam 浏览器环境/);
});
