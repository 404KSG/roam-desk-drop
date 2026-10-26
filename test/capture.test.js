import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskCapture } from '../src/desk-capture.js';
import { createFakeRoam } from './fake-roam.js';

const origin = { graphName: 'Test graph', graphType: 'hosted', userUid: 'user-one' };

test('Undo removes only the new entry and preserves later source edits', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const result = await capture.capture({ uids: ['block0001'], origin });
  assert.ok(result.receipt);
  await fake.api.data.block.update({ block: { uid: 'block0001', string: 'A later user edit' } });
  await capture.undo(result.receipt);
  assert.equal(fake.desk()[':block/children'].length, 0);
  assert.equal(fake.block('block0001')[':block/string'], 'A later user edit');
  assert.deepEqual(fake.block('block0001')[':block/_children'], [{ ':block/uid': 'page00001' }]);
  assert.equal(fake.block('child0001')[':block/string'], 'Original child block');
});

test('new entries go to the top; duplicate drops do not reorder existing entries', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const a = await capture.capture({ uids: ['block0001'], origin });
  const b = await capture.capture({ uids: ['child0001'], origin });
  await capture.capture({ uids: ['block0001'], origin });
  assert.deepEqual(fake.desk()[':block/children'].map(x => x[':block/uid']), [b.entryUid, a.entryUid]);
});

test('unloading or rebinding Desk during a read stops the operation before writing', async (t) => {
  await t.test('unload', async () => {
    const fake = createFakeRoam();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    const before = fake.snapshot();
    fake.hooks.onPull = (_s, lookup) => { if (lookup[1] === 'block0001') capture.dispose(); };
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'ABORTED');
    assert.deepEqual(fake.snapshot(), before);
  });
  await t.test('rebind', async () => {
    const fake = createFakeRoam();
    fake.records.set('desk-two', { uid: 'desk-two', title: 'Another desk', children: [] });
    let reads = 0;
    fake.hooks.onPull = (_s, lookup) => { if (lookup[0] === ':user/uid' && ++reads === 2) fake.users.get('user-one').desk = 'desk-two'; };
    const before = fake.snapshot();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'DESK_CHANGED');
    assert.deepEqual(fake.snapshot(), before);
  });
});

test('Undo refuses entries that were edited, referenced, or given child blocks', async (t) => {
  for (const change of ['edit', 'reference', 'child']) await t.test(change, async () => {
    const fake = createFakeRoam();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    const added = await capture.capture({ uids: ['block0001'], origin });
    if (change === 'edit') await fake.api.data.block.update({ block: { uid: added.entryUid, string: 'New user content' } });
    else await fake.api.data.block.create({
      location: { 'parent-uid': change === 'child' ? added.entryUid : 'page00001', order: 'last' },
      block: { uid: 'extra0001', string: change === 'reference' ? `((${added.entryUid}))` : 'Keep this child block' },
    });
    const before = fake.snapshot();
    await assert.rejects(capture.undo(added.receipt), e => e.code === 'UNDO_UNSAFE');
    assert.deepEqual(fake.snapshot(), before);
    await assert.rejects(capture.undo({ ...added.receipt }), e => e.code === 'INVALID_RECEIPT');
  });
});

test('cancellation prevents creation and native embed variants are deduplicated', async (t) => {
  await t.test('canceled', async () => {
    const fake = createFakeRoam(), controller = new AbortController();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    controller.abort();
    await assert.rejects(capture.capture({ uids: ['block0001'], origin, signal: controller.signal }), e => e.code === 'ABORTED');
    assert.equal(fake.desk()[':block/children'].length, 0);
  });
  for (const string of ['{{embed: ((block0001))}}', '{{embed-path: ((block0001))}}', '{{[[embed-path]]: ((block0001)) closed}}', '{{embed-path: ((block0001)) closed}} Additional notes']) await t.test(string, async () => {
    const fake = createFakeRoam();
    await fake.api.data.block.create({ location: { 'parent-uid': 'desk-user-one', order: 'first' }, block: { uid: 'existing1', string } });
    const capture = createDeskCapture({ getAPI: () => fake.api });
    const result = await capture.capture({ uids: ['block0001'], origin });
    assert.equal(result.status, 'existing'); assert.equal(result.entryUid, 'existing1');
    assert.equal(fake.desk()[':block/children'].length, 1);
  });
});

test('a mismatched readback UID cannot produce success or an Undo receipt', async () => {
  const fake = createFakeRoam();
  const pull = fake.api.data.pull;
  fake.api.data.pull = (selector, lookup) => {
    const result = pull(selector, lookup);
    return lookup[1]?.startsWith('new') && result ? { ...result, ':block/uid': 'foreign01' } : result;
  };
  const capture = createDeskCapture({ getAPI: () => fake.api });
  await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'WRITE_UNCONFIRMED');
});

test('write errors trigger readback, not blind retries', async (t) => {
  await t.test('a completed write is confirmed even when the SDK reports an error', async () => {
    const fake = createFakeRoam();
    fake.hooks.afterCreate = () => { throw new Error('response lost'); };
    const capture = createDeskCapture({ getAPI: () => fake.api });
    const result = await capture.capture({ uids: ['block0001'], origin });
    assert.equal(result.status, 'added');
    assert.equal(fake.desk()[':block/children'].length, 1);
  });
  await t.test('an unconfirmed result blocks a second creation attempt', async () => {
    const fake = createFakeRoam();
    fake.hooks.beforeCreate = () => { throw new Error('unknown write outcome'); };
    const capture = createDeskCapture({ getAPI: () => fake.api });
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'WRITE_UNCONFIRMED');
    delete fake.hooks.beforeCreate;
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'WRITE_UNCONFIRMED');
    assert.equal(fake.desk()[':block/children'].length, 0);
  });
});

test('rapid drops are serialized and deduplicated; unloading rejects new writes', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const results = await Promise.all([
    capture.capture({ uids: ['block0001'], origin }),
    capture.capture({ uids: ['block0001'], origin }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), ['added', 'existing']);
  assert.equal(fake.desk()[':block/children'].length, 1);
  capture.dispose();
  const before = fake.snapshot();
  await assert.rejects(capture.capture({ uids: ['child0001'], origin }), e => e.code === 'ABORTED');
  assert.deepEqual(fake.snapshot(), before);
});

test('stale drops and Undo receipts cannot write after a graph switch', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const created = await capture.capture({ uids: ['block0001'], origin });
  const before = fake.snapshot();
  fake.api.graph.name = 'Another graph';
  await assert.rejects(capture.capture({ uids: ['child0001'], origin }), e => e.code === 'CONTEXT_CHANGED');
  await assert.rejects(capture.undo(created.receipt), e => e.code === 'CONTEXT_CHANGED');
  assert.deepEqual(fake.snapshot(), before);
});

test('a graph change during an async read stops entry creation', async () => {
  const fake = createFakeRoam();
  const before = fake.snapshot();
  fake.hooks.onPull = (_selector, lookup) => {
    if (lookup[1] === 'block0001') fake.api.graph.name = 'Another graph';
  };
  const capture = createDeskCapture({ getAPI: () => fake.api });
  await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'CONTEXT_CHANGED');
  assert.deepEqual(fake.snapshot(), before);
});

test('dropping one block creates a native embed and preserves the source and its children', async () => {
  const fake = createFakeRoam();
  const before = structuredClone(fake.records.get('block0001'));
  const childBefore = structuredClone(fake.records.get('child0001'));
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const result = await capture.capture({ uids: ['block0001'], origin });
  assert.equal(result.status, 'added');
  assert.deepEqual(fake.desk()[':block/children'], [
    { ':block/uid': result.entryUid, ':block/string': '{{embed-path: ((block0001)) closed}}' },
  ]);
  assert.deepEqual(fake.records.get('block0001'), before);
  assert.deepEqual(fake.records.get('child0001'), childBefore);
});

test('duplicate drops do not add entries or issue an Undo receipt for an existing entry', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const first = await capture.capture({ uids: ['block0001'], origin });
  const second = await capture.capture({ uids: ['block0001'], origin });
  assert.equal(second.status, 'existing');
  assert.equal(second.entryUid, first.entryUid);
  assert.equal(fake.desk()[':block/children'].length, 1);
  assert.equal(second.receipt, undefined);
});

test('invalid sources, Desk-owned blocks, and invalid bindings produce no writes', async (t) => {
  const cases = [
    { name: 'missing block', uids: ['missing01'], code: 'SOURCE_MISSING' },
    { name: 'a page is not a block', uids: ['page00001'], code: 'NOT_A_BLOCK' },
    { name: 'Desk itself', uids: ['desk-user-one'], code: 'DESK_SOURCE' },
    { name: 'multiple top-level blocks', uids: ['block0001', 'child0001'], code: 'SINGLE_BLOCK_ONLY' },
    { name: 'empty payload', uids: [], code: 'SINGLE_BLOCK_ONLY' },
    { name: 'an invalid UID cannot inject markup', uids: ['bad)) closed}}'], code: 'INVALID_UID' },
    { name: 'an unbound Desk does not trigger a name-based guess', uids: ['block0001'], code: 'DESK_UNBOUND', setup: f => { f.users.get('user-one').desk = null; } },
    { name: 'a dangling binding does not create a page', uids: ['block0001'], code: 'DESK_MISSING', setup: f => { f.users.get('user-one').desk = 'gone-desk'; } },
    { name: 'a block inside Desk', uids: ['desknote1'], code: 'DESK_SOURCE', setup: async f => {
      await f.api.data.block.create({ location: { 'parent-uid': 'desk-user-one', order: 'first' }, block: { uid: 'desknote1', string: 'A note owned by Desk' } });
    } },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const fake = createFakeRoam();
    await scenario.setup?.(fake);
    const before = fake.snapshot();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    await assert.rejects(capture.capture({ uids: scenario.uids, origin }), e => e.code === scenario.code);
    assert.deepEqual(fake.snapshot(), before);
  });
});
