import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskCapture } from '../src/desk-capture.js';
import { createFakeRoam } from './fake-roam.js';

const origin = { graphName: 'Test graph', graphType: 'hosted', userUid: 'user-one' };

test('撤销只移除本次入口，不回滚用户后来对源块的编辑', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const result = await capture.capture({ uids: ['block0001'], origin });
  assert.ok(result.receipt);
  await fake.api.data.block.update({ block: { uid: 'block0001', string: '用户后来的编辑' } });
  await capture.undo(result.receipt);
  assert.equal(fake.desk()[':block/children'].length, 0);
  assert.equal(fake.block('block0001')[':block/string'], '用户后来的编辑');
  assert.deepEqual(fake.block('block0001')[':block/_children'], [{ ':block/uid': 'page00001' }]);
  assert.equal(fake.block('child0001')[':block/string'], '原子块');
});

test('新入口放顶部，重复添加不重排已有条目', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const a = await capture.capture({ uids: ['block0001'], origin });
  const b = await capture.capture({ uids: ['child0001'], origin });
  await capture.capture({ uids: ['block0001'], origin });
  assert.deepEqual(fake.desk()[':block/children'].map(x => x[':block/uid']), [b.entryUid, a.entryUid]);
});

test('读取期间卸载或 Desk 重新绑定，都在写入前停止', async (t) => {
  await t.test('卸载', async () => {
    const fake = createFakeRoam();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    const before = fake.snapshot();
    fake.hooks.onPull = (_s, lookup) => { if (lookup[1] === 'block0001') capture.dispose(); };
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'ABORTED');
    assert.deepEqual(fake.snapshot(), before);
  });
  await t.test('重新绑定', async () => {
    const fake = createFakeRoam();
    fake.records.set('desk-two', { uid: 'desk-two', title: '另一张工作台', children: [] });
    let reads = 0;
    fake.hooks.onPull = (_s, lookup) => { if (lookup[0] === ':user/uid' && ++reads === 2) fake.users.get('user-one').desk = 'desk-two'; };
    const before = fake.snapshot();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'DESK_CHANGED');
    assert.deepEqual(fake.snapshot(), before);
  });
});

test('被编辑、引用或添加子块的入口不能被撤销删除', async (t) => {
  for (const change of ['edit', 'reference', 'child']) await t.test(change, async () => {
    const fake = createFakeRoam();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    const added = await capture.capture({ uids: ['block0001'], origin });
    if (change === 'edit') await fake.api.data.block.update({ block: { uid: added.entryUid, string: '用户的新内容' } });
    else await fake.api.data.block.create({
      location: { 'parent-uid': change === 'child' ? added.entryUid : 'page00001', order: 'last' },
      block: { uid: 'extra0001', string: change === 'reference' ? `((${added.entryUid}))` : '子块不能误删' },
    });
    const before = fake.snapshot();
    await assert.rejects(capture.undo(added.receipt), e => e.code === 'UNDO_UNSAFE');
    assert.deepEqual(fake.snapshot(), before);
    await assert.rejects(capture.undo({ ...added.receipt }), e => e.code === 'INVALID_RECEIPT');
  });
});

test('取消信号阻止创建；现有原生嵌入变体都能去重', async (t) => {
  await t.test('已取消', async () => {
    const fake = createFakeRoam(), controller = new AbortController();
    const capture = createDeskCapture({ getAPI: () => fake.api });
    controller.abort();
    await assert.rejects(capture.capture({ uids: ['block0001'], origin, signal: controller.signal }), e => e.code === 'ABORTED');
    assert.equal(fake.desk()[':block/children'].length, 0);
  });
  for (const string of ['{{embed: ((block0001))}}', '{{embed-path: ((block0001))}}', '{{[[embed-path]]: ((block0001)) closed}}', '{{embed-path: ((block0001)) closed}} 后续说明']) await t.test(string, async () => {
    const fake = createFakeRoam();
    await fake.api.data.block.create({ location: { 'parent-uid': 'desk-user-one', order: 'first' }, block: { uid: 'existing1', string } });
    const capture = createDeskCapture({ getAPI: () => fake.api });
    const result = await capture.capture({ uids: ['block0001'], origin });
    assert.equal(result.status, 'existing'); assert.equal(result.entryUid, 'existing1');
    assert.equal(fake.desk()[':block/children'].length, 1);
  });
});

test('读回 UID 不匹配时不能报告成功或提供撤销凭据', async () => {
  const fake = createFakeRoam();
  const pull = fake.api.data.pull;
  fake.api.data.pull = (selector, lookup) => {
    const result = pull(selector, lookup);
    return lookup[1]?.startsWith('new') && result ? { ...result, ':block/uid': 'foreign01' } : result;
  };
  const capture = createDeskCapture({ getAPI: () => fake.api });
  await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'WRITE_UNCONFIRMED');
});

test('写入报错后先读回；无法确认时不盲目重试', async (t) => {
  await t.test('服务已写入但返回错误时仍能确认实际结果', async () => {
    const fake = createFakeRoam();
    fake.hooks.afterCreate = () => { throw new Error('response lost'); };
    const capture = createDeskCapture({ getAPI: () => fake.api });
    const result = await capture.capture({ uids: ['block0001'], origin });
    assert.equal(result.status, 'added');
    assert.equal(fake.desk()[':block/children'].length, 1);
  });
  await t.test('结果未确认时再次拖入也不会创建第二次', async () => {
    const fake = createFakeRoam();
    fake.hooks.beforeCreate = () => { throw new Error('unknown write outcome'); };
    const capture = createDeskCapture({ getAPI: () => fake.api });
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'WRITE_UNCONFIRMED');
    delete fake.hooks.beforeCreate;
    await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'WRITE_UNCONFIRMED');
    assert.equal(fake.desk()[':block/children'].length, 0);
  });
});

test('快速连续拖入会串行去重，卸载后不再接受写入', async () => {
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

test('切换图谱后，旧拖拽和旧撤销都不能写入当前图谱', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const created = await capture.capture({ uids: ['block0001'], origin });
  const before = fake.snapshot();
  fake.api.graph.name = 'Another graph';
  await assert.rejects(capture.capture({ uids: ['child0001'], origin }), e => e.code === 'CONTEXT_CHANGED');
  await assert.rejects(capture.undo(created.receipt), e => e.code === 'CONTEXT_CHANGED');
  assert.deepEqual(fake.snapshot(), before);
});

test('异步读取期间图谱改变，也必须在创建入口前停止', async () => {
  const fake = createFakeRoam();
  const before = fake.snapshot();
  fake.hooks.onPull = (_selector, lookup) => {
    if (lookup[1] === 'block0001') fake.api.graph.name = 'Another graph';
  };
  const capture = createDeskCapture({ getAPI: () => fake.api });
  await assert.rejects(capture.capture({ uids: ['block0001'], origin }), e => e.code === 'CONTEXT_CHANGED');
  assert.deepEqual(fake.snapshot(), before);
});

test('拖入单块时加入原生嵌入，源块与子块仍在原处', async () => {
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

test('重复拖入同一个 Block 不重复添加，也不提供删除旧入口的撤销凭据', async () => {
  const fake = createFakeRoam();
  const capture = createDeskCapture({ getAPI: () => fake.api });
  const first = await capture.capture({ uids: ['block0001'], origin });
  const second = await capture.capture({ uids: ['block0001'], origin });
  assert.equal(second.status, 'existing');
  assert.equal(second.entryUid, first.entryUid);
  assert.equal(fake.desk()[':block/children'].length, 1);
  assert.equal(second.receipt, undefined);
});

test('非法来源、Desk 内部块和失效绑定都不能产生写入', async (t) => {
  const cases = [
    { name: '不存在的块', uids: ['missing01'], code: 'SOURCE_MISSING' },
    { name: '页面不是块', uids: ['page00001'], code: 'NOT_A_BLOCK' },
    { name: 'Desk 自身', uids: ['desk-user-one'], code: 'DESK_SOURCE' },
    { name: '多顶层块', uids: ['block0001', 'child0001'], code: 'SINGLE_BLOCK_ONLY' },
    { name: '空载荷', uids: [], code: 'SINGLE_BLOCK_ONLY' },
    { name: '非法 UID 不能注入新标记', uids: ['bad)) closed}}'], code: 'INVALID_UID' },
    { name: '没有绑定时不猜同名页面', uids: ['block0001'], code: 'DESK_UNBOUND', setup: f => { f.users.get('user-one').desk = null; } },
    { name: '绑定悬空时不偷偷创建页面', uids: ['block0001'], code: 'DESK_MISSING', setup: f => { f.users.get('user-one').desk = 'gone-desk'; } },
    { name: 'Desk 内部的块', uids: ['desknote1'], code: 'DESK_SOURCE', setup: async f => {
      await f.api.data.block.create({ location: { 'parent-uid': 'desk-user-one', order: 'first' }, block: { uid: 'desknote1', string: 'Desk 自己的笔记' } });
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
