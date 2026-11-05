import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskCapture } from '../src/desk-capture.js';
import { createFakeRoam } from './fake-roam.js';

const origin = { graphName: 'Test graph', graphType: 'hosted', userUid: 'user-one' };
const target = uid => ({ kind: 'page', uid });
const setup = () => {
  const fake = createFakeRoam();
  return { fake, capture: createDeskCapture({ getAPI: () => fake.api }) };
};
const entries = (fake, uid) => fake.block(uid)[':block/children'];

test('one block creates a native embed at the top and preserves the source hierarchy', async () => {
  const { fake, capture } = setup();
  const source = structuredClone(fake.records.get('block0001'));
  const child = structuredClone(fake.records.get('child0001'));
  const a = await capture.capture({ uids: ['block0001'], origin });
  const b = await capture.capture({ uids: ['child0001'], origin });
  assert.deepEqual(fake.desk()[':block/children'], [
    { ':block/uid': b.entryUid, ':block/string': '{{embed-path: ((child0001)) closed}}' },
    { ':block/uid': a.entryUid, ':block/string': '{{embed-path: ((block0001)) closed}}' },
  ]);
  assert.deepEqual(fake.records.get('block0001'), source);
  assert.deepEqual(fake.records.get('child0001'), child);
  assert.equal(a.receipt, undefined);
  assert.equal(capture.undo, undefined);
});

test('starred destinations deduplicate independently and preserve existing entry order', async () => {
  const { fake, capture } = setup();
  for (const uid of ['target001', 'target002']) {
    const first = await capture.capture({ uids: ['block0001'], origin, destination: target(uid) });
    const second = await capture.capture({ uids: ['child0001'], origin, destination: target(uid) });
    const repeated = await capture.capture({ uids: ['block0001'], origin, destination: target(uid) });
    assert.equal(repeated.status, 'existing');
    assert.equal(repeated.entryUid, first.entryUid);
    assert.deepEqual(entries(fake, uid).map(x => x[':block/uid']), [second.entryUid, first.entryUid]);
  }
  assert.equal(fake.desk()[':block/children'].length, 0);
});

test('Desk-owned source blocks can be collected into a different page', async () => {
  const { fake, capture } = setup();
  await fake.api.data.block.create({ location: { 'parent-uid': 'desk-user-one', order: 'first' }, block: { uid: 'desk-note', string: 'A Desk note' } });
  const before = structuredClone(fake.records.get('desk-note'));
  await capture.capture({ uids: ['desk-note'], origin, destination: target('target001') });
  assert.equal(entries(fake, 'target001')[0][':block/string'], '{{embed-path: ((desk-note)) closed}}');
  assert.deepEqual(fake.records.get('desk-note'), before);
});

test('Daily Notes creates today only when missing, then deduplicates the embed', async () => {
  const { fake, capture } = setup();
  const today = new Date(), uid = fake.api.util.dateToPageUid(today), title = fake.api.util.dateToPageTitle(today);
  let creates = 0;
  fake.hooks.beforePageCreate = () => { creates++; };
  await capture.capture({ uids: ['block0001'], origin, destination: { kind: 'daily' } });
  assert.equal(fake.records.get(uid).title, title);
  assert.equal(entries(fake, uid)[0][':block/string'], '{{embed-path: ((block0001)) closed}}');
  const result = await capture.capture({ uids: ['block0001'], origin, destination: { kind: 'daily' } });
  assert.equal(result.status, 'existing');
  assert.equal(creates, 1);
  assert.equal(entries(fake, uid).length, 1);
});

test('Daily Notes reuses an existing page and never creates a replacement for a conflicting UID', async t => {
  await t.test('existing day', async () => {
    const { fake, capture } = setup();
    const uid = fake.api.util.dateToPageUid(new Date()), title = fake.api.util.dateToPageTitle(new Date());
    fake.records.set(uid, { uid, title, children: [] });
    fake.hooks.beforePageCreate = () => { throw new Error('Must reuse existing DNP'); };
    await capture.capture({ uids: ['block0001'], origin, destination: { kind: 'daily' } });
    assert.equal(entries(fake, uid).length, 1);
  });
  await t.test('UID belongs to a block', async () => {
    const { fake, capture } = setup();
    const uid = fake.api.util.dateToPageUid(new Date());
    fake.records.set(uid, { uid, string: 'Keep this block', parent: 'page00001', children: [] });
    const before = fake.snapshot();
    await assert.rejects(capture.capture({ uids: ['block0001'], origin, destination: { kind: 'daily' } }));
    assert.deepEqual(fake.snapshot(), before);
  });
});

test('Daily Notes keeps the date accepted at drop while a prior write crosses midnight', async () => {
  const ActualDate = globalThis.Date;
  let time = new ActualDate(2026, 9, 29, 23, 59).getTime();
  globalThis.Date = class extends ActualDate {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  };
  try {
    const { fake, capture } = setup(); let release;
    fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
    const first = capture.capture({ uids: ['block0001'], origin });
    for (let i = 0; !release && i < 100; i++) await Promise.resolve();
    assert.ok(release, 'First write never reached the SDK');
    const daily = capture.capture({ uids: ['child0001'], origin, destination: { kind: 'daily' } });
    time = new ActualDate(2026, 9, 30, 0, 1).getTime();
    delete fake.hooks.beforeCreate; release(); await Promise.all([first, daily]);
    assert.equal(fake.block('10-29-2026')?.[':block/children'].length, 1);
    assert.equal(fake.block('10-30-2026'), null);
  } finally { globalThis.Date = ActualDate; }
});

test('unloading or aborting during DNP resolution cannot create a page afterward', async t => {
  for (const mode of ['dispose', 'abort']) await t.test(mode, async () => {
    const { fake, capture } = setup(), controller = new AbortController();
    const today = fake.api.util.dateToPageUid(new Date()), before = fake.snapshot();
    fake.hooks.onPull = (_selector, lookup) => {
      if (lookup[1] === today) {
        if (mode === 'dispose') capture.dispose();
        else controller.abort();
      }
    };
    await assert.rejects(capture.capture({ uids: ['block0001'], origin, destination: { kind: 'daily' }, signal: controller.signal }), error => error.code === 'ABORTED');
    assert.deepEqual(fake.snapshot(), before);
  });
});

test('Daily Notes reconciles page-create responses and refuses conflicting titles', async t => {
  await t.test('page created before response error', async () => {
    const { fake, capture } = setup();
    const uid = fake.api.util.dateToPageUid(new Date());
    fake.hooks.afterPageCreate = () => { throw new Error('Page response lost'); };
    await capture.capture({ uids: ['block0001'], origin, destination: { kind: 'daily' } });
    assert.equal(entries(fake, uid).length, 1);
  });
  await t.test('title belongs to another UID', async () => {
    const { fake, capture } = setup();
    fake.records.set('other-day', { uid: 'other-day', title: fake.api.util.dateToPageTitle(new Date()), children: [] });
    const before = fake.snapshot();
    await assert.rejects(capture.capture({ uids: ['block0001'], origin, destination: { kind: 'daily' } }));
    assert.deepEqual(fake.snapshot(), before);
  });
});

test('blocks already on the destination are informational results with no writes', async t => {
  for (const kind of ['page', 'desk', 'daily']) await t.test(kind, async () => {
    const { fake, capture } = setup();
    let uid = 'page00001', destination = target(uid);
    if (kind === 'desk') { uid = 'desk-user-one'; destination = { kind: 'desk' }; }
    if (kind === 'daily') {
      uid = fake.api.util.dateToPageUid(new Date()); destination = { kind: 'daily' };
      fake.records.set(uid, { uid, title: fake.api.util.dateToPageTitle(new Date()), children: [] });
    }
    if (kind !== 'page') {
      fake.records.get('page00001').children = [];
      fake.records.get(uid).children.push('block0001'); fake.records.get('block0001').parent = uid;
    }
    const before = fake.snapshot();
    const result = await capture.capture({ uids: ['block0001'], origin, destination });
    assert.equal(result.status, 'existing'); assert.equal(result.reason, 'source-on-page');
    assert.equal(result.pageUid, uid);
    assert.deepEqual(fake.snapshot(), before);
  });
});

test('invalid sources and destinations produce no graph writes', async t => {
  const cases = [
    { name: 'missing block', uids: ['missing01'] },
    { name: 'whole page', uids: ['page00001'] },
    { name: 'Desk itself', uids: ['desk-user-one'] },
    { name: 'multiple top-level blocks', uids: ['block0001', 'child0001'] },
    { name: 'empty payload', uids: [] },
    { name: 'markup injection', uids: ['bad)) closed}}'] },
    { name: 'unbound Desk', prepare: f => { f.users.get('user-one').desk = null; } },
    { name: 'dangling Desk binding', prepare: f => { f.users.get('user-one').desk = 'gone-desk'; } },
    { name: 'destination missing', destination: target('gone-page') },
    { name: 'destination is a block', destination: target('child0001') },
    { name: 'invalid destination UID', destination: target('bad))}}') },
    { name: 'unknown destination kind', destination: { kind: 'unknown', uid: 'target001' } },
    { name: 'invalid source cannot create today', uids: ['missing01'], destination: { kind: 'daily' } },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const { fake, capture } = setup();
    scenario.prepare?.(fake);
    const before = fake.snapshot();
    await assert.rejects(capture.capture({ uids: scenario.uids ?? ['block0001'], origin, destination: scenario.destination }));
    assert.deepEqual(fake.snapshot(), before);
  });
});

test('unload and Desk rebinding during reads stop before entry creation', async t => {
  await t.test('unload', async () => {
    const { fake, capture } = setup();
    const before = fake.snapshot();
    fake.hooks.onPull = (_s, lookup) => { if (lookup[1] === 'block0001') capture.dispose(); };
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'ABORTED');
    assert.deepEqual(fake.snapshot(), before);
  });
  await t.test('rebind', async () => {
    const { fake, capture } = setup();
    fake.records.set('desk-two', { uid: 'desk-two', title: 'Another Desk', children: [] });
    let reads = 0;
    fake.hooks.onPull = (_s, lookup) => { if (lookup[0] === ':user/uid' && ++reads === 2) fake.users.get('user-one').desk = 'desk-two'; };
    const before = fake.snapshot();
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }));
    assert.deepEqual(fake.snapshot(), before);
  });
});

test('native embed variants are deduplicated within the chosen destination', async t => {
  for (const string of ['{{embed: ((block0001))}}', '{{embed-path: ((block0001))}}', '{{[[embed-path]]: ((block0001)) closed}}', '{{embed-path: ((block0001)) closed}} Additional notes']) await t.test(string, async () => {
    const { fake, capture } = setup();
    await fake.api.data.block.create({ location: { 'parent-uid': 'target001', order: 'first' }, block: { uid: 'existing1', string } });
    const result = await capture.capture({ uids: ['block0001'], origin, destination: target('target001') });
    assert.equal(result.status, 'existing');
    assert.equal(result.entryUid, 'existing1');
    assert.equal(entries(fake, 'target001').length, 1);
  });
});

test('write errors trigger readback and never blind retries', async t => {
  await t.test('completed write despite response error', async () => {
    const { fake, capture } = setup();
    fake.hooks.afterCreate = () => { throw new Error('Response lost'); };
    const result = await capture.capture({ uids: ['block0001'], origin, destination: target('target001') });
    assert.equal(result.status, 'added');
    assert.equal(entries(fake, 'target001').length, 1);
  });
  await t.test('unconfirmed write blocks another attempt only at that destination', async () => {
    const { fake, capture } = setup();
    fake.hooks.beforeCreate = () => { throw new Error('Unknown outcome'); };
    await assert.rejects(capture.capture({ uids: ['block0001'], origin, destination: target('target001') }), e => e.code === 'WRITE_UNCONFIRMED');
    delete fake.hooks.beforeCreate;
    await assert.rejects(capture.capture({ uids: ['block0001'], origin, destination: target('target001') }), e => e.code === 'WRITE_UNCONFIRMED');
    assert.equal(entries(fake, 'target001').length, 0);
    await capture.capture({ uids: ['block0001'], origin, destination: target('target002') });
    assert.equal(entries(fake, 'target002').length, 1);
  });
  await t.test('mismatched readback UID is not success', async () => {
    const { fake, capture } = setup();
    const pull = fake.api.data.pull;
    fake.api.data.pull = (selector, lookup) => {
      const result = pull(selector, lookup);
      return lookup[1]?.startsWith('new') && result ? { ...result, ':block/uid': 'foreign01' } : result;
    };
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'WRITE_UNCONFIRMED');
  });
});

test('rapid drops serialize and deduplicate per destination', async () => {
  const { fake, capture } = setup();
  const results = await Promise.all([
    capture.capture({ uids: ['block0001'], origin, destination: target('target001') }),
    capture.capture({ uids: ['block0001'], origin, destination: target('target001') }),
    capture.capture({ uids: ['block0001'], origin, destination: target('target002') }),
  ]);
  assert.deepEqual(results.map(result => result.status), ['added', 'existing', 'added']);
  assert.equal(entries(fake, 'target001').length, 1);
  assert.equal(entries(fake, 'target002').length, 1);
});

test('queued destinations are snapshotted rather than accepting later caller mutation', async () => {
  const { fake, capture } = setup();
  const destination = target('target001');
  const request = capture.capture({ uids: ['block0001'], origin, destination });
  destination.uid = 'target002';
  await request;
  assert.equal(entries(fake, 'target001').length, 1);
  assert.equal(entries(fake, 'target002').length, 0);
});

test('cancellation, unload, graph changes and user changes prevent further writes', async t => {
  for (const mode of ['cancel', 'unload', 'graph', 'user', 'during-read']) await t.test(mode, async () => {
    const { fake, capture } = setup(), controller = new AbortController();
    const before = fake.snapshot();
    if (mode === 'cancel') controller.abort();
    if (mode === 'unload') capture.dispose();
    if (mode === 'graph') fake.api.graph.name = 'Another graph';
    if (mode === 'user') fake.setUser('user-two');
    if (mode === 'during-read') fake.hooks.onPull = (_s, lookup) => { if (lookup[1] === 'block0001') fake.api.graph.name = 'Another graph'; };
    await assert.rejects(capture.capture({ uids: ['block0001'], origin, destination: target('target001'), signal: controller.signal }));
    assert.deepEqual(fake.snapshot(), before);
  });
});
