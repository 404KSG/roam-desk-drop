import { createFakeRoam } from '../fake-roam.js';
const bundleMode = new URLSearchParams(location.search).has('bundle');
const lifecycle = (await import(bundleMode ? '../../extension.js' : '../../src/extension-entry.js')).default;

let fake, runtime, navigation = 0;
const results = document.querySelector('#results');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const waitFor = async predicate => {
  const end = performance.now() + 1500;
  while (!predicate()) { if (performance.now() > end) throw new Error('等待结果超时'); await new Promise(r => setTimeout(r, 10)); }
};
function render() {
  document.querySelector('#entries').textContent = fake.desk()[':block/children'].map(x => x[':block/string']).join('\n') || '空';
  document.querySelector('#navigation').textContent = `Desk 导航次数：${navigation}`;
}
function reset() {
  runtime?.stop();
  fake = createFakeRoam(); navigation = 0;
  fake.hooks.afterCreate = render;
  const originalDelete = fake.api.data.block.delete;
  fake.api.data.block.delete = async args => { await originalDelete(args); render(); };
  window.roamAlphaAPI = fake.api;
  runtime = { start: () => lifecycle.onload(), stop: () => lifecycle.onunload() };
  runtime.start(); render();
}
function event(type, target, transfer, options = {}) {
  const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, ...options });
  target.dispatchEvent(e); return e;
}
function begin(selector = '#bullet', options = {}) {
  const dt = new DataTransfer();
  // 构造出来的 DataTransfer 默认为 none；模拟原生 Block 拖拽允许的 all。
  // 真实鼠标拖拽另行验收，不让生产代码为合成事件放宽限制。
  Object.defineProperty(dt, 'effectAllowed', { value: 'all' });
  event('dragstart', document.querySelector(selector), dt, options);
  return dt;
}
document.querySelectorAll('.rm-bullet').forEach(bullet => bullet.addEventListener('dragstart', e => {
  const uid = bullet.closest('[data-block-uid]').dataset.blockUid;
  e.dataTransfer.setData('roam/block-uid-list-only-parents', uid);
  e.dataTransfer.setData('roam/block-uid-list', uid);
  e.dataTransfer.setData('roam/roam-uri-list', `roam://#/app/Test%20graph/page/${uid}`);
}));
document.querySelector('#desk').addEventListener('click', () => { navigation++; render(); });
document.querySelector('#stop').addEventListener('click', () => runtime.stop());

async function runTests() {
  const report = [];
  async function check(name, fn) {
    reset();
    try { await fn(); report.push({ name, ok: true }); }
    catch (error) { report.push({ name, ok: false, error: error.message }); }
    results.textContent = JSON.stringify(report, null, 2);
  }
  await check('浏览器 DOM 事件：拖入 Desk 创建嵌入，原文保留，不自动导航', async () => {
    const before = structuredClone(fake.records.get('block0001'));
    const dt = begin();
    const over = event('dragover', document.querySelector('#desk'), dt);
    assert(over.defaultPrevented, 'Desk 没有接收拖放');
    event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => fake.desk()[':block/children'].length === 1);
    assert(fake.desk()[':block/children'][0][':block/string'] === '{{embed-path: ((block0001)) closed}}', '不是原生嵌入');
    assert(JSON.stringify(fake.records.get('block0001')) === JSON.stringify(before), '源 Block 被修改');
    assert(navigation === 0, '不应自动导航');
  });
  await check('查看和撤销使用可点击按钮，撤销后原文仍在', async () => {
    const dt = begin(); event('dragover', document.querySelector('#desk'), dt); event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => document.querySelector('[data-rr-desk-drop-action="undo"]'));
    document.querySelector('[data-rr-desk-drop-action="view"]').click();
    assert(navigation === 1, '查看未保留原生导航');
    document.querySelector('[data-rr-desk-drop-action="undo"]').click();
    await waitFor(() => fake.desk()[':block/children'].length === 0);
    assert(fake.block('block0001')[':block/string'] === '原始内容', '撤销伤害原文');
  });
  await check('重复拖入不重复添加', async () => {
    for (let i = 0; i < 2; i++) {
      const dt = begin(); event('dragover', document.querySelector('#desk'), dt); event('drop', document.querySelector('#desk'), dt);
      await waitFor(() => document.querySelector('.rr-desk-drop-notice')?.textContent.includes(i ? '已在 Desk' : '已加入 Desk'));
    }
    assert(fake.desk()[':block/children'].length === 1, '重复创建');
    assert(!document.querySelector('[data-rr-desk-drop-action="undo"]'), '旧入口不应出现撤销');
  });
  await check('其他区域的原生拖动不被接管', async () => {
    const dt = begin(); const target = document.querySelector('#ordinary-target');
    const over = event('dragover', target, dt), drop = event('drop', target, dt);
    await new Promise(requestAnimationFrame);
    assert(!over.defaultPrevented && !drop.defaultPrevented, '拦截了原生拖放');
    assert(fake.desk()[':block/children'].length === 0, '错误写入');
  });
  await check('四种修饰键全部让行', async () => {
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      const dt = begin('#bullet', { [key]: true });
      const over = event('dragover', document.querySelector('#desk'), dt, { [key]: true });
      const drop = event('drop', document.querySelector('#desk'), dt, { [key]: true });
      assert(!over.defaultPrevented && !drop.defaultPrevented, '抢走修饰键 ' + key);
    }
    await new Promise(requestAnimationFrame);
    assert(fake.desk()[':block/children'].length === 0, '修饰键导致写入');
  });
  await check('引用视图与外部拖放在首版不接管', async () => {
    let dt = begin('#reference-bullet');
    assert(!event('dragover', document.querySelector('#desk'), dt).defaultPrevented, '误接管引用视图');
    event('drop', document.querySelector('#desk'), dt);
    dt = new DataTransfer(); dt.setData('text/plain', '外部文字');
    assert(!event('drop', document.querySelector('#desk'), dt).defaultPrevented, '误接管外部输入');
    await new Promise(requestAnimationFrame);
    assert(fake.desk()[':block/children'].length === 0, '非法来源写入');
  });
  await check('dragover 不读取保护模式载荷，drop 时才读取', async () => {
    const dt = begin(); let reads = 0; const get = dt.getData.bind(dt);
    Object.defineProperty(dt, 'getData', { value: type => { reads++; return get(type); } });
    event('dragover', document.querySelector('#desk'), dt);
    assert(reads === 0, '在 dragover 中读取了载荷');
    event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => fake.desk()[':block/children'].length === 1);
    assert(reads > 0, 'drop 没读取官方载荷');
  });
  await check('取消和卸载都移除高亮，卸载后无监听副作用', async () => {
    let dt = begin(); event('dragover', document.querySelector('#desk'), dt);
    assert(document.querySelector('.rr-desk-drop-hint'), '没有高亮');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!document.querySelector('.rr-desk-drop-hint'), '取消后高亮未清除');
    dt = begin(); event('dragover', document.querySelector('#desk'), dt); runtime.stop();
    assert(!document.querySelector('.rr-desk-drop-hint') && !document.querySelector('[data-rr-desk-drop-style]'), '卸载残留 UI');
    assert(!event('dragover', document.querySelector('#desk'), dt).defaultPrevented, '卸载残留监听');
    event('drop', document.querySelector('#desk'), dt); await new Promise(requestAnimationFrame);
    assert(fake.desk()[':block/children'].length === 0, '卸载后仍写入');
    document.querySelector('#desk').click(); assert(navigation === 1, '破坏原生 click');
  });
  await check('重复加载不叠加监听和样式', async () => {
    runtime.start(); runtime.start();
    assert(document.querySelectorAll('[data-rr-desk-drop-style]').length === 1, '重复样式');
    const dt = begin(); event('dragover', document.querySelector('#desk'), dt); event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => document.querySelector('[data-rr-desk-drop-action="undo"]'));
    assert(fake.desk()[':block/children'].length === 1, '重复写入');
  });
  await check('graph 切换后拒绝旧拖放', async () => {
    const dt = begin(); fake.api.graph.name = 'Other graph';
    event('drop', document.querySelector('#desk'), dt); await new Promise(requestAnimationFrame);
    assert(fake.desk()[':block/children'].length === 0, '跨图谱写入');
  });
  window.__deskDropTestResults = report;
  return report;
}
document.querySelector('#run-tests').addEventListener('click', runTests);
window.__deskDropFixture = { reset, runTests, snapshot: () => fake.snapshot(), runtime: () => runtime };
reset();
