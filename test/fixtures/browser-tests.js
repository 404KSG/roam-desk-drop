import { createFakeRoam } from '../fake-roam.js';
const bundleMode = new URLSearchParams(location.search).has('bundle');
const lifecycle = (await import(bundleMode ? '../../extension.js' : '../../src/extension-entry.js')).default;

let fake, runtime, navigation = 0;
const results = document.querySelector('#results');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const waitFor = async predicate => {
  const end = performance.now() + 1500;
  while (!predicate()) { if (performance.now() > end) throw new Error('Timed out waiting for the result'); await new Promise(r => setTimeout(r, 10)); }
};
function render() {
  document.querySelector('#entries').textContent = fake.desk()[':block/children'].map(x => x[':block/string']).join('\n') || 'Empty';
  document.querySelector('#navigation').textContent = `Desk navigations: ${navigation}`;
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
  // Constructed DataTransfer objects default to none; model native block drags that allow all.
  // Real pointer drags are checked separately without relaxing production input checks.
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
  await check('DOM drop creates a native embed, preserves the source, and does not navigate', async () => {
    const before = structuredClone(fake.records.get('block0001'));
    const dt = begin();
    const over = event('dragover', document.querySelector('#desk'), dt);
    assert(over.defaultPrevented, 'Desk did not accept the drop');
    event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => fake.desk()[':block/children'].length === 1);
    assert(fake.desk()[':block/children'][0][':block/string'] === '{{embed-path: ((block0001)) closed}}', 'Entry is not a native embed');
    assert(JSON.stringify(fake.records.get('block0001')) === JSON.stringify(before), 'Source block changed');
    assert(navigation === 0, 'Unexpected automatic navigation');
  });
  await check('View and Undo buttons work; Undo preserves the source', async () => {
    const dt = begin(); event('dragover', document.querySelector('#desk'), dt); event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => document.querySelector('[data-rr-desk-drop-action="undo"]'));
    document.querySelector('[data-rr-desk-drop-action="view"]').click();
    assert(navigation === 1, 'View did not use native navigation');
    document.querySelector('[data-rr-desk-drop-action="undo"]').click();
    await waitFor(() => fake.desk()[':block/children'].length === 0);
    assert(fake.block('block0001')[':block/string'] === 'Original content', 'Undo changed the source');
  });
  await check('Repeated drops do not create duplicate entries', async () => {
    for (let i = 0; i < 2; i++) {
      const dt = begin(); event('dragover', document.querySelector('#desk'), dt); event('drop', document.querySelector('#desk'), dt);
      await waitFor(() => document.querySelector('.rr-desk-drop-notice')?.textContent.includes(i ? 'Already on Desk' : 'Added to Desk'));
    }
    assert(fake.desk()[':block/children'].length === 1, 'Duplicate entry created');
    assert(!document.querySelector('[data-rr-desk-drop-action="undo"]'), 'An existing entry must not receive an Undo action');
  });
  await check('Native drops outside Desk are not intercepted', async () => {
    const dt = begin(); const target = document.querySelector('#ordinary-target');
    const over = event('dragover', target, dt), drop = event('drop', target, dt);
    await new Promise(requestAnimationFrame);
    assert(!over.defaultPrevented && !drop.defaultPrevented, 'Native drop was intercepted');
    assert(fake.desk()[':block/children'].length === 0, 'Unexpected write');
  });
  await check('All four modifier keys are left to existing handlers', async () => {
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      const dt = begin('#bullet', { [key]: true });
      const over = event('dragover', document.querySelector('#desk'), dt, { [key]: true });
      const drop = event('drop', document.querySelector('#desk'), dt, { [key]: true });
      assert(!over.defaultPrevented && !drop.defaultPrevented, 'Modifier drag was intercepted: ' + key);
    }
    await new Promise(requestAnimationFrame);
    assert(fake.desk()[':block/children'].length === 0, 'Modifier drag caused a write');
  });
  await check('Reference views and external drops are not intercepted', async () => {
    let dt = begin('#reference-bullet');
    assert(!event('dragover', document.querySelector('#desk'), dt).defaultPrevented, 'Reference view was intercepted');
    event('drop', document.querySelector('#desk'), dt);
    dt = new DataTransfer(); dt.setData('text/plain', 'External text');
    assert(!event('drop', document.querySelector('#desk'), dt).defaultPrevented, 'External input was intercepted');
    await new Promise(requestAnimationFrame);
    assert(fake.desk()[':block/children'].length === 0, 'Unsupported input caused a write');
  });
  await check('Protected payload data is read on drop, not on dragover', async () => {
    const dt = begin(); let reads = 0; const get = dt.getData.bind(dt);
    Object.defineProperty(dt, 'getData', { value: type => { reads++; return get(type); } });
    event('dragover', document.querySelector('#desk'), dt);
    assert(reads === 0, 'Payload was read during dragover');
    event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => fake.desk()[':block/children'].length === 1);
    assert(reads > 0, 'Drop did not read the native payload');
  });
  await check('Cancel and unload clear highlights; unloading removes listeners', async () => {
    let dt = begin(); event('dragover', document.querySelector('#desk'), dt);
    assert(document.querySelector('.rr-desk-drop-hint'), 'Highlight is missing');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!document.querySelector('.rr-desk-drop-hint'), 'Highlight remained after cancellation');
    dt = begin(); event('dragover', document.querySelector('#desk'), dt); runtime.stop();
    assert(!document.querySelector('.rr-desk-drop-hint') && !document.querySelector('[data-rr-desk-drop-style]'), 'UI remained after unload');
    assert(!event('dragover', document.querySelector('#desk'), dt).defaultPrevented, 'Listener remained after unload');
    event('drop', document.querySelector('#desk'), dt); await new Promise(requestAnimationFrame);
    assert(fake.desk()[':block/children'].length === 0, 'Write occurred after unload');
    document.querySelector('#desk').click(); assert(navigation === 1, 'Native click behavior changed');
  });
  await check('Repeated loads do not duplicate listeners or styles', async () => {
    runtime.start(); runtime.start();
    assert(document.querySelectorAll('[data-rr-desk-drop-style]').length === 1, 'Duplicate stylesheet');
    const dt = begin(); event('dragover', document.querySelector('#desk'), dt); event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => document.querySelector('[data-rr-desk-drop-action="undo"]'));
    assert(fake.desk()[':block/children'].length === 1, 'Duplicate write');
  });
  await check('A graph switch rejects a stale drop', async () => {
    const dt = begin(); fake.api.graph.name = 'Other graph';
    event('drop', document.querySelector('#desk'), dt); await new Promise(requestAnimationFrame);
    assert(fake.desk()[':block/children'].length === 0, 'Cross-graph write');
  });
  window.__deskDropTestResults = report;
  return report;
}
document.querySelector('#run-tests').addEventListener('click', runTests);
window.__deskDropFixture = { reset, runTests, snapshot: () => fake.snapshot(), runtime: () => runtime };
reset();
