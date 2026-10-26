import test from 'node:test';
import assert from 'node:assert/strict';
import { readDropPayload } from '../src/drop-payload.js';
const origin = { graphName: 'Test graph', graphType: 'hosted', userUid: 'user-one' };
const transfer = (overrides = {}) => {
  const data = { 'roam/block-uid-list-only-parents': 'block0001', 'roam/roam-uri-list': 'roam://#/app/Test%20graph/page/block0001', ...overrides };
  return { types: Object.keys(data), getData: type => data[type] ?? '' };
};

test('native drag payloads validate UID and graph without guessing from block text', () => {
  assert.deepEqual(readDropPayload(transfer(), origin, 'block0001'), ['block0001']);
  for (const data of [
    { 'roam/roam-uri-list': 'roam://#/app/Other/page/block0001' },
    { 'roam/roam-uri-list': 'https://example.com/#/app/Test%20graph/page/block0001' },
    { 'roam/roam-uri-list': '' },
    { 'roam/block-uid-list-only-parents': 'another01' },
    { 'roam/block-uid-list-only-parents': 'block0001\nchild0001' },
  ]) assert.throws(() => readDropPayload(transfer(data), origin, 'block0001'));
});

test('HTTPS/offline links, Unicode graph names, and long UIDs work; plain text is rejected', () => {
  assert.deepEqual(readDropPayload(transfer({ 'roam/roam-uri-list': 'https://roamresearch.com/#/app/Test%20graph/page/block0001' }), origin), ['block0001']);
  const uid = 'imported-block-with-long-uid';
  const context = { ...origin, graphName: 'Research \u{1F4DA}', graphType: 'offline' };
  assert.deepEqual(readDropPayload(transfer({ 'roam/block-uid-list-only-parents': uid, 'roam/roam-uri-list': `roam://#/offline/${encodeURIComponent('Research \u{1F4DA}')}/page/${uid}` }), context), [uid]);
  assert.throws(() => readDropPayload({ types: ['text/plain'], getData: () => 'block0001' }, origin));
  assert.throws(() => readDropPayload(transfer(), { ...origin, graphType: 'offline' }));
});
