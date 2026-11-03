import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsableNativeDrag } from '../src/runtime.js';

const nativeEvent = overrides => ({
  defaultPrevented: false,
  dataTransfer: { types: ['roam/block-uid-list-only-parents'] },
  ...overrides,
});

test('native drag is usable only after an uncanceled handler supplies a Roam payload', () => {
  assert.equal(isUsableNativeDrag(nativeEvent()), true);
  assert.equal(isUsableNativeDrag(nativeEvent({ defaultPrevented: true })), false);
  assert.equal(isUsableNativeDrag(nativeEvent({ dataTransfer: { types: ['text/plain'] } })), false);
  assert.equal(isUsableNativeDrag(nativeEvent({ shiftKey: true })), false);
});
