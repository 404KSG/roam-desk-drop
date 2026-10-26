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
  assert(document.hasFocus(), 'Focus the fixture before running pointer/focus integration checks');
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
  await check('Native Desk navigation and inline Undo work without a toast', async () => {
    const dt = begin(); event('dragover', document.querySelector('#desk'), dt); event('drop', document.querySelector('#desk'), dt);
    await waitFor(() => document.querySelector('[data-rr-desk-drop-action="undo"]'));
    document.querySelector('#desk').click();
    assert(navigation === 1, 'Native Desk navigation changed');
    assert(!document.querySelector('.rr-desk-drop-notice'), 'A global toast was created');
    assert(document.querySelector('#desk [data-rr-desk-drop-action="undo"]'), 'Undo is not inline');
    const undo = document.querySelector('[data-rr-desk-drop-action="undo"]');
    // A real click focuses the button first; .click() alone misses blur reentrancy.
    undo.focus(); undo.click();
    await waitFor(() => fake.desk()[':block/children'].length === 0);
    assert(fake.block('block0001')[':block/string'] === 'Original content', 'Undo changed the source');
    assert(navigation === 1, 'Undo bubbled into native navigation');
  });
  await check('Repeated drops do not create duplicate entries', async () => {
    for (let i = 0; i < 2; i++) {
      const dt = begin(); event('dragover', document.querySelector('#desk'), dt); event('drop', document.querySelector('#desk'), dt);
      await waitFor(() => document.querySelector('#desk').dataset.rrDeskDrop === (i ? 'existing' : 'added'));
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
    assert(document.querySelector('#desk[data-rr-desk-drop="ready"]'), 'Highlight is missing');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!document.querySelector('.rr-desk-drop-accessory'), 'Highlight remained after cancellation');
    dt = begin(); event('dragover', document.querySelector('#desk'), dt); runtime.stop();
    assert(!document.querySelector('.rr-desk-drop-accessory,.rr-desk-drop-live,[data-rr-desk-drop-style]'), 'UI remained after unload');
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
  await check('Drag feedback preserves native label, icon, dimensions, and adjacent rows', async () => {
    const row = document.querySelector('#desk'), label = document.querySelector('#desk-label'), nativeIcon = document.querySelector('#desk-icon');
    const shape = node => JSON.stringify(node.getBoundingClientRect().toJSON());
    const before = [row, label, nativeIcon, row.nextElementSibling].map(shape);
    const dt = begin(); event('dragover', row, dt);
    assert(row.textContent.trim() === 'Desk', 'Drag added instructional copy');
    assert(!document.querySelector('.rr-desk-drop-hint,.rr-desk-drop-notice'), 'Old overlay UI returned');
    assert(JSON.stringify([row, label, nativeIcon, row.nextElementSibling].map(shape)) === JSON.stringify(before), 'Navigation geometry changed');
    assert(row.scrollWidth <= row.clientWidth, 'Feedback overflows the row');
    assert(getComputedStyle(row.querySelector('.rr-desk-drop-accessory')).pointerEvents === 'none', 'Feedback intercepts pointer input');
    window.dispatchEvent(new Event('dragend'));
    assert(!row.hasAttribute('data-rr-desk-drop') && !row.querySelector('.rr-desk-drop-accessory'), 'Drag marker remained');
  });
  await check('Pending writes stay local; screen-reader feedback is not a visible banner', async () => {
    let release; fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
    const row = document.querySelector('#desk'), dt = begin(); event('drop', row, dt);
    await waitFor(() => release);
    assert(row.dataset.rrDeskDrop === 'pending' && row.getAttribute('aria-busy') === 'true', 'Missing pending state');
    assert(row.querySelector('.rr-desk-drop-spinner').getBoundingClientRect().width > 0, 'Spinner has no size');
    assert(row.textContent.trim() === 'Desk', 'Pending state added visible copy');
    const live = document.querySelector('.rr-desk-drop-live');
    assert(live.getAttribute('role') === 'status' && live.textContent.includes('Adding'), 'No accessible progress');
    assert(live.getBoundingClientRect().width === 1, 'Live status is visible');
    release(); await waitFor(() => row.dataset.rrDeskDrop === 'added');
    assert(!row.hasAttribute('aria-busy'), 'Busy state remained after success');
    assert(!document.querySelector('.rr-desk-drop-notice'), 'Global notification returned');
  });
  await check('Errors retain details at Desk instead of displaying a global notification', async () => {
    fake.hooks.beforeCreate = () => { throw new Error('Simulated unavailable writer'); };
    const row = document.querySelector('#desk'), dt = begin(); event('drop', row, dt);
    await waitFor(() => row.dataset.rrDeskDrop === 'error');
    const warning = row.querySelector('.rr-desk-drop-error');
    assert(warning.title.length > 20 && warning.getAttribute('aria-label') === warning.title, 'Error detail was lost');
    assert(row.textContent.trim() === 'Desk' && !document.querySelector('.rr-desk-drop-notice'), 'Error added visible prose or a toast');
    assert(fake.desk()[':block/children'].length === 0, 'Failed write claimed an entry');
    warning.focus(); assert(document.activeElement === warning, 'Warning is not keyboard-accessible');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!row.querySelector('.rr-desk-drop-accessory'), 'Escape did not dismiss error feedback');
  });
  await check('Unsafe inline Undo reports an error without deleting an edited entry', async () => {
    const row = document.querySelector('#desk'), dt = begin(); event('drop', row, dt);
    await waitFor(() => row.dataset.rrDeskDrop === 'added');
    const uid = fake.desk()[':block/children'][0][':block/uid'];
    fake.records.get(uid).string += ' Edited notes';
    row.querySelector('[data-rr-desk-drop-action="undo"]').click();
    await waitFor(() => row.dataset.rrDeskDrop === 'error');
    assert(fake.records.has(uid) && fake.desk()[':block/children'].length === 1, 'Unsafe Undo deleted the entry');
    assert(navigation === 0, 'Unsafe Undo navigated');
  });
  await check('Latest accepted drop owns the inline Undo, even with queued writes', async () => {
    let release; fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
    const row = document.querySelector('#desk'); event('drop', row, begin());
    await waitFor(() => release);
    event('drop', row, begin('#child-bullet')); fake.hooks.beforeCreate = null; release();
    await waitFor(() => fake.desk()[':block/children'].length === 2 && row.dataset.rrDeskDrop === 'added');
    row.querySelector('[data-rr-desk-drop-action="undo"]').click();
    await waitFor(() => fake.desk()[':block/children'].length === 1);
    assert(fake.desk()[':block/children'][0][':block/string'] === '{{embed-path: ((block0001)) closed}}', 'Undo belongs to a stale drop');
    assert(fake.records.get('block0001').children[0] === 'child0001', 'Source hierarchy changed');
  });
  await check('Graph changes discard feedback from an already submitted write', async () => {
    let release; fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
    const row = document.querySelector('#desk'); event('drop', row, begin());
    await waitFor(() => release);
    fake.api.graph.name = 'Other graph'; window.dispatchEvent(new Event('hashchange'));
    assert(!row.hasAttribute('data-rr-desk-drop'), 'Old graph feedback remained');
    release(); await waitFor(() => fake.desk()[':block/children'].length === 1);
    await new Promise(requestAnimationFrame);
    assert(!row.hasAttribute('data-rr-desk-drop') && !document.querySelector('.rr-desk-drop-accessory'), 'Late feedback leaked into another graph');
  });
  await check('Unload restores pre-existing attributes and removes all plugin UI', async () => {
    const row = document.querySelector('#desk'); row.setAttribute('data-rr-desk-drop', 'pre-existing'); row.setAttribute('aria-busy', 'false');
    let release; fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
    event('drop', row, begin()); await waitFor(() => release); runtime.stop();
    assert(row.getAttribute('data-rr-desk-drop') === 'pre-existing' && row.getAttribute('aria-busy') === 'false', 'Existing attributes were not restored');
    assert(!document.querySelector('.rr-desk-drop-accessory,.rr-desk-drop-live,[data-rr-desk-drop-style]'), 'Plugin UI survived unload');
    row.removeAttribute('data-rr-desk-drop'); row.removeAttribute('aria-busy');
    release(); await waitFor(() => fake.desk()[':block/children'].length === 1); await new Promise(requestAnimationFrame);
    assert(!document.querySelector('.rr-desk-drop-accessory'), 'Late completion recreated unloaded UI');
  });
  await check('Compact and dark sidebars preserve their native label and foreground', async () => {
    const row = document.querySelector('#desk'), sidebar = row.closest('.roam-sidebar-container');
    const oldStyle = sidebar.getAttribute('style');
    try {
      sidebar.style.width = '160px'; sidebar.style.background = '#1d1d20'; sidebar.style.color = '#dedee1';
      const color = getComputedStyle(row).color, before = JSON.stringify(row.getBoundingClientRect().toJSON());
      event('dragover', row, begin());
      assert(getComputedStyle(row).color === color, 'Native foreground was replaced');
      assert(JSON.stringify(row.getBoundingClientRect().toJSON()) === before, 'Compact row changed size');
      assert(row.scrollWidth <= row.clientWidth, 'Compact row overflows');
      const label = document.querySelector('#desk-label').getBoundingClientRect(), accessory = row.querySelector('.rr-desk-drop-accessory').getBoundingClientRect();
      assert(label.right + 8 < accessory.left, 'Compact feedback overlaps the label');
    } finally { if (oldStyle === null) sidebar.removeAttribute('style'); else sidebar.setAttribute('style', oldStyle); }
  });
  window.__deskDropTestResults = report;
  return report;
}
document.querySelector('#run-tests').addEventListener('click', runTests);
window.__deskDropFixture = { reset, runTests, snapshot: () => fake.snapshot(), runtime: () => runtime, fake: () => fake };
reset();
