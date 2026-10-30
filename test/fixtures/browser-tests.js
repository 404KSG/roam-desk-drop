import { createFakeRoam } from '../fake-roam.js';
const bundleMode = new URLSearchParams(location.search).has('bundle');
const lifecycle = (await import(bundleMode ? '../../extension.js' : '../../src/extension-entry.js')).default;
let fake, runtime, navigation = 0;
const $ = selector => document.querySelector(selector);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const waitFor = async (predicate, timeout = 1800) => {
  const end = performance.now() + timeout;
  while (!predicate()) { if (performance.now() > end) throw new Error('Timed out waiting for the result'); await new Promise(resolve => setTimeout(resolve, 10)); }
};
const children = uid => fake.block(uid)?.[':block/children'] ?? [];
function render() {
  $('#entries').textContent = ['desk-user-one', 'target001', 'target002', fake.api.util.dateToPageUid(new Date())].map(uid => `${fake.records.get(uid)?.title || uid}: ${children(uid).map(x => x[':block/string']).join(', ') || 'Empty'}`).join('\n');
  $('#navigation').textContent = `Native navigations: ${navigation}`;
}
function reset() {
  runtime?.stop(); fake = createFakeRoam(); navigation = 0;
  fake.records.set('edited001', { uid: 'edited001', string: 'Currently editing this block', parent: 'page00001', children: [], edited: 1 });
  fake.records.get('page00001').children.push('edited001');
  fake.hooks.afterCreate = render;
  window.roamAlphaAPI = fake.api;
  runtime = { start: () => lifecycle.onload(), stop: () => lifecycle.onunload() };
  runtime.start(); render();
}
function event(type, target, transfer, options = {}) {
  const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, ...options });
  target.dispatchEvent(e); return e;
}
function begin(selector = '#bullet', options = {}, allowed = 'all') {
  const dt = new DataTransfer();
  Object.defineProperty(dt, 'effectAllowed', { value: allowed });
  let effect = 'none';
  Object.defineProperty(dt, 'dropEffect', { get: () => effect, set: value => { effect = value; } });
  event('dragstart', $(selector), dt, options); return dt;
}
function point(node) { const r = node.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; }
function pointer(type, node, coords = point(node), options = {}) {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...coords, ...options });
  node.dispatchEvent(e); return e;
}
function pointerDrag(source, target) {
  pointer('pointerdown', source); pointer('pointermove', target); pointer('pointerup', target);
}
for (const bullet of document.querySelectorAll('.rm-bullet')) bullet.addEventListener('dragstart', e => {
  // Model the native client: an edited block deliberately supplies no drag payload.
  if (bullet.id === 'editing-bullet') { e.preventDefault(); return; }
  const uid = bullet.closest('[data-block-uid]')?.dataset.blockUid;
  e.dataTransfer.setData('roam/block-uid-list-only-parents', uid);
  e.dataTransfer.setData('roam/block-uid-list', uid);
  e.dataTransfer.setData('roam/roam-uri-list', `roam://#/app/Test%20graph/page/${uid}`);
});
for (const row of document.querySelectorAll('.log-button,.starred-pages a')) row.addEventListener('click', e => { e.preventDefault(); navigation++; render(); });
$('#stop').addEventListener('click', () => runtime.stop());

async function runTests() {
  assert(document.hasFocus(), 'Focus the fixture before running integration checks');
  const report = [];
  async function check(name, fn) {
    reset();
    try { await fn(); report.push({ name, ok: true }); }
    catch (error) { report.push({ name, ok: false, error: error.message }); }
    $('#results').textContent = JSON.stringify(report, null, 2);
  }
  await check('Desk drop preserves source and child hierarchy without navigation or Undo', async () => {
    const before = fake.snapshot().filter(x => ['block0001', 'child0001'].includes(x.uid));
    const dt = begin(); assert(event('dragover', $('#desk'), dt).defaultPrevented, 'Desk rejected hover');
    event('drop', $('#desk'), dt); await waitFor(() => $('#desk').dataset.rrDeskDrop === 'added');
    assert(children('desk-user-one')[0][':block/string'] === '{{embed-path: ((block0001)) closed}}', 'Wrong embed');
    assert(JSON.stringify(fake.snapshot().filter(x => ['block0001', 'child0001'].includes(x.uid))) === JSON.stringify(before), 'Source changed');
    assert(navigation === 0 && !document.querySelector('[data-rr-desk-drop-action],.rr-desk-drop-undo,.rr-desk-drop-notice'), 'Navigation or removed Undo UI returned');
    $('#desk').click(); assert(navigation === 1, 'Native navigation failed');
  });
  await check('Starred page child targets resolve ancestor links and deduplicate per page', async () => {
    for (const selector of ['#build .rr-sidebar-ref-count', '#reading', '#build']) {
      const row = $(selector), dt = begin(); assert(event('dragover', row, dt).defaultPrevented, `Rejected ${selector}`); event('drop', row, dt);
      await waitFor(() => children(selector.includes('reading') ? 'target002' : 'target001').length === 1);
    }
    await waitFor(() => $('#build').dataset.rrDeskDrop === 'existing');
    assert(children('target001').length === 1 && children('target002').length === 1 && children('desk-user-one').length === 0, 'Wrong destination or duplicate');
  });
  await check('Daily Notes targets today rather than the currently viewed source page', async () => {
    const uid = fake.api.util.dateToPageUid(new Date());
    event('drop', $('#daily'), begin()); await waitFor(() => children(uid).length === 1);
    assert(children(uid)[0][':block/string'] === '{{embed-path: ((block0001)) closed}}', 'Wrong DNP content');
    assert(fake.records.get('page00001').children.length === 2, 'Source page changed');
  });
  await check('A block already in today shows a clear informational result without a write', async () => {
    const row = $('#daily'), uid = fake.api.util.dateToPageUid(new Date());
    fake.records.set(uid, { uid, title: fake.api.util.dateToPageTitle(new Date()), children: ['block0001'] });
    fake.records.get('page00001').children = ['edited001']; fake.records.get('block0001').parent = uid;
    const before = JSON.stringify(fake.snapshot());
    event('drop', row, begin()); await waitFor(() => row.dataset.rrDeskDrop === 'existing');
    assert(!row.querySelector('.rr-desk-drop-error,.rr-desk-drop-success'), 'Already-on-page still looks like failure or a new add');
    const tip = $('.rr-desk-drop-tooltip'), status = row.querySelector('.rr-desk-drop-result');
    assert(tip?.textContent === "Already in today's note", 'Already-in-today explanation is missing');
    assert(status.getAttribute('aria-describedby') === tip.id && tip.getAttribute('role') === 'tooltip', 'Explanation is not accessible');
    assert(!status.hasAttribute('title'), 'A competing native tooltip remains');
    status.dispatchEvent(new MouseEvent('mouseenter'));
    assert($('.rr-desk-drop-tooltip').textContent === status.getAttribute('aria-label'), 'Hover did not reveal the full explanation');
    assert(JSON.stringify(fake.snapshot()) === before, 'Informational result changed the graph');
    await waitFor(() => !row.hasAttribute('data-rr-desk-drop'), 2400);
    assert(!$('.rr-desk-drop-tooltip'), 'Informational explanation did not expire');
  });
  await check('Duplicate embeds have a neutral icon and an immediate Already added explanation', async () => {
    const row = $('#build'); event('drop', row, begin()); await waitFor(() => row.dataset.rrDeskDrop === 'added');
    const addedPath = row.querySelector('path').getAttribute('d');
    event('drop', row, begin()); await waitFor(() => row.dataset.rrDeskDrop === 'existing');
    assert($('.rr-desk-drop-tooltip')?.textContent === 'Already added', 'Duplicate explanation is missing');
    assert(!row.querySelector('.rr-desk-drop-success,.rr-desk-drop-error') && row.querySelector('path').getAttribute('d') !== addedPath, 'Duplicate uses the new-add or error icon');
    assert(children('target001').length === 1, 'Duplicate created another entry');
    assert(Math.abs(row.getBoundingClientRect().right - row.querySelector('.rr-desk-drop-accessory').getBoundingClientRect().right - 10) < .5, 'Duplicate moved the right slot');
    await waitFor(() => !row.hasAttribute('data-rr-desk-drop'), 2400);
    assert(getComputedStyle(row.querySelector('.rr-sidebar-ref-count')).visibility === 'visible', 'Duplicate expiry did not restore count');
  });
  await check('Real errors immediately explain the reason and remain available on focus', async () => {
    fake.hooks.beforeCreate = () => { throw new Error('Simulated unavailable writer'); };
    const row = $('#build'); event('drop', row, begin()); await waitFor(() => row.dataset.rrDeskDrop === 'error');
    const warning = row.querySelector('.rr-desk-drop-error');
    assert($('.rr-desk-drop-tooltip')?.textContent === warning.getAttribute('aria-label'), 'Error reason is hidden behind an unexplained warning');
    await waitFor(() => !$('.rr-desk-drop-tooltip'), 3000);
    assert(row.dataset.rrDeskDrop === 'error', 'Error indicator vanished with the explanation');
    warning.focus(); assert($('.rr-desk-drop-tooltip')?.textContent === warning.getAttribute('aria-label'), 'Keyboard focus did not reveal the reason');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert(!$('.rr-desk-drop-tooltip') && !row.hasAttribute('data-rr-desk-drop'), 'Escape left the error explanation');
  });
  await check('New drags, context changes, scroll, and unload remove contextual explanations', async () => {
    for (const mode of ['drag', 'context', 'scroll', 'unload']) {
      reset();
      await fake.api.data.block.create({ location: { 'parent-uid': 'target001', order: 'first' }, block: { uid: 'already01', string: '{{embed-path: ((block0001)) closed}}' } });
      event('drop', $('#build'), begin()); await waitFor(() => $('#build').dataset.rrDeskDrop === 'existing');
      assert($('.rr-desk-drop-tooltip'), 'Missing explanation: ' + mode);
      if (mode === 'drag') begin();
      if (mode === 'context') { fake.api.graph.name = 'Other graph'; window.dispatchEvent(new Event('hashchange')); }
      if (mode === 'scroll') document.dispatchEvent(new Event('scroll'));
      if (mode === 'unload') runtime.stop();
      assert(!$('.rr-desk-drop-tooltip'), 'Stale explanation remained: ' + mode);
    }
  });
  await check('Functional sidebar entries, headings and ordinary targets pass through', async () => {
    for (const selector of ['#depot', '.starred-pages-wrapper .title', '#ordinary-target']) {
      const dt = begin(); dt.dropEffect = 'move';
      assert(!event('dragover', $(selector), dt).defaultPrevented && !event('drop', $(selector), dt).defaultPrevented, 'Unsupported target intercepted');
      assert(dt.dropEffect === 'move', 'Native cursor changed');
    }
    await new Promise(requestAnimationFrame); assert(fake.snapshot().length === 7, 'Unexpected graph write');
  });
  await check('Cross-graph shortcut links and block links are not valid page writes', async () => {
    const anchor = $('#build').parentElement, old = anchor.getAttribute('href');
    try {
      anchor.setAttribute('href', '/#/app/Other/page/target001'); event('drop', $('#build'), begin());
      await new Promise(requestAnimationFrame); assert(children('target001').length === 0, 'Cross-graph write');
      anchor.setAttribute('href', '/#/app/Test%20graph/page/child0001'); event('drop', $('#build'), begin());
      await waitFor(() => $('#build').dataset.rrDeskDrop === 'error'); assert(fake.records.get('child0001').children.length === 0, 'Block accepted as page');
    } finally { anchor.setAttribute('href', old); }
  });
  await check('All four modifier gestures and ambiguous/external drags pass through', async () => {
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      const dt = begin('#bullet', { [key]: true }); dt.dropEffect = 'move';
      assert(!event('dragover', $('#desk'), dt, { [key]: true }).defaultPrevented && !event('drop', $('#desk'), dt, { [key]: true }).defaultPrevented, `Modifier intercepted: ${key}`);
      assert(dt.dropEffect === 'move', 'Modifier cursor changed');
    }
    let dt = begin('#reference-bullet'); assert(!event('drop', $('#desk'), dt).defaultPrevented, 'Reference intercepted');
    dt = new DataTransfer(); dt.setData('text/plain', 'External text'); assert(!event('drop', $('#desk'), dt).defaultPrevented, 'External intercepted');
    await new Promise(requestAnimationFrame); assert(children('desk-user-one').length === 0, 'Unsupported write');
  });
  await check('Protected drag payload is read only at drop', async () => {
    const dt = begin(), get = dt.getData.bind(dt); let reads = 0;
    Object.defineProperty(dt, 'getData', { value: type => { reads++; return get(type); } });
    event('dragover', $('#desk'), dt); assert(reads === 0, 'Payload read during hover');
    event('drop', $('#desk'), dt); await waitFor(() => children('desk-user-one').length === 1); assert(reads > 0, 'Payload not checked');
  });
  await check('Green check occupies exactly the plus slot and expires while hovered', async () => {
    const row = $('#build'), dt = begin(); event('dragover', row, dt);
    const before = point(row.querySelector('.rr-desk-drop-icon'));
    event('drop', row, dt); await waitFor(() => row.dataset.rrDeskDrop === 'added');
    const icon = row.querySelector('.rr-desk-drop-icon'), after = point(icon), color = getComputedStyle(icon).color;
    assert(before.clientX === after.clientX && before.clientY === after.clientY, 'Success icon shifted');
    const rgb = color.match(/[\d.]+/g)?.map(Number); assert(rgb && rgb[1] > rgb[0] && rgb[1] > rgb[2], `Success is not green: ${color}`);
    assert(getComputedStyle(row.querySelector('.rr-sidebar-ref-count')).visibility === 'hidden', 'Success did not cover the count');
    row.dispatchEvent(new MouseEvent('mouseenter'));
    await waitFor(() => !row.hasAttribute('data-rr-desk-drop'), 1300);
    assert(!row.querySelector('.rr-desk-drop-accessory'), 'Check persisted while hovering');
    assert(getComputedStyle(row.querySelector('.rr-sidebar-ref-count')).visibility === 'visible', 'Success expiry did not restore the count');
  });
  await check('Feedback stays at the far right with or without a count and never shifts the row', async () => {
    let slot;
    for (const selector of ['#build', '#reading']) {
      const row = $(selector), before = JSON.stringify(row.getBoundingClientRect().toJSON());
      event('dragover', row, begin());
      const rect = row.getBoundingClientRect(), icon = row.querySelector('.rr-desk-drop-accessory').getBoundingClientRect();
      assert(JSON.stringify(rect.toJSON()) === before, 'Row geometry changed');
      assert(Math.abs(rect.right - icon.right - 10) < .5, 'Feedback moved left to make room for a count');
      if (slot !== undefined) assert(Math.abs(slot - icon.right) < .5, 'Count changed the feedback slot');
      slot = icon.right;
      const count = row.querySelector('.rr-sidebar-ref-count');
      if (count) {
        assert(getComputedStyle(count).visibility === 'hidden' && getComputedStyle(count).display !== 'none', 'Count was not covered while preserving its space');
        assert(count.textContent === '99+', 'Covering changed the count value');
      }
      window.dispatchEvent(new Event('dragend'));
      if (count) assert(getComputedStyle(count).visibility === 'visible', 'Count not restored');
    }
  });
  await check('Pending and success cover live count updates without changing count styles', async () => {
    const row = $('#build'), count = row.querySelector('.rr-sidebar-ref-count');
    const style = count.getAttribute('style'), text = count.textContent;
    let release;
    try {
      count.style.color = 'rgb(90, 100, 110)'; count.style.visibility = 'visible';
      const originalStyle = count.getAttribute('style');
      fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
      event('drop', row, begin()); await waitFor(() => release);
      assert(getComputedStyle(count).visibility === 'hidden', 'Pending did not cover the count');
      count.textContent = '100'; release(); await waitFor(() => row.dataset.rrDeskDrop === 'added');
      assert(getComputedStyle(count).visibility === 'hidden', 'Success uncovered the count early');
      await waitFor(() => !row.hasAttribute('data-rr-desk-drop'), 1300);
      assert(count.textContent === '100' && getComputedStyle(count).visibility === 'visible', 'Latest count was not restored');
      assert(count.getAttribute('style') === originalStyle, 'Feedback overwrote count styles');
    } finally { if (style === null) count.removeAttribute('style'); else count.setAttribute('style', style); count.textContent = text; release?.(); }
  });
  await check('Leaving, canceling, changing context, and unloading restore covered counts', async () => {
    for (const mode of ['leave', 'escape', 'blur', 'hashchange', 'unload']) {
      reset(); const row = $('#build'), count = row.querySelector('.rr-sidebar-ref-count');
      event('dragover', row, begin()); assert(getComputedStyle(count).visibility === 'hidden', 'Count not covered: ' + mode);
      if (mode === 'leave') event('dragleave', row, null, { clientX: 0, clientY: 0, relatedTarget: $('#ordinary-target') });
      if (mode === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (mode === 'blur') window.dispatchEvent(new Event('blur'));
      if (mode === 'hashchange') { fake.api.graph.name = 'Other graph'; window.dispatchEvent(new Event('hashchange')); }
      if (mode === 'unload') runtime.stop();
      assert(getComputedStyle(count).visibility === 'visible' && count.textContent === '99+', 'Count not restored: ' + mode);
    }
  });
  await check('Counts added during feedback are covered and then restored automatically', async () => {
    const row = $('#reading'), count = document.createElement('span');
    count.className = 'rr-sidebar-ref-count'; count.textContent = '42';
    try {
      event('dragover', row, begin()); row.append(count);
      assert(getComputedStyle(count).visibility === 'hidden', 'New count was not covered');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      assert(getComputedStyle(count).visibility === 'visible' && count.textContent === '42', 'New count was not restored');
    } finally { count.remove(); }
  });
  await check('Edited textarea block drags by its bullet with no native dragstart', async () => {
    const editor = $('#block-input-log-outline-edited001'); editor.focus(); editor.setSelectionRange(4, 4);
    const before = structuredClone(fake.records.get('edited001'));
    pointerDrag($('#editing-bullet'), $('#build'));
    await waitFor(() => children('target001').length === 1);
    assert(children('target001')[0][':block/string'] === '{{embed-path: ((edited001)) closed}}', 'Edited UID was not resolved');
    assert(JSON.stringify(fake.records.get('edited001')) === JSON.stringify(before) && editor.value === 'Currently editing this block', 'Editor/source changed');
  });
  await check('Pointer threshold, editor selection, modifiers and ordinary targets cause no capture', async () => {
    const bullet = $('#editing-bullet'), coords = point(bullet);
    pointer('pointerdown', bullet); pointer('pointermove', bullet, { clientX: coords.clientX + 2, clientY: coords.clientY }); pointer('pointerup', bullet, coords);
    pointerDrag($('#block-input-log-outline-edited001'), $('#desk'));
    pointer('pointerdown', bullet, point(bullet), { altKey: true }); pointer('pointermove', $('#desk')); pointer('pointerup', $('#desk'));
    pointerDrag(bullet, $('#ordinary-target'));
    await new Promise(requestAnimationFrame); assert(children('desk-user-one').length === 0, 'Unintended pointer capture');
  });
  await check('Edited native dragstart cancellation still permits pointer fallback', async () => {
    $('#block-input-log-outline-edited001').focus();
    pointer('pointerdown', $('#editing-bullet'));
    $('#block-input-log-outline-edited001').dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    begin('#editing-bullet');
    pointer('pointermove', $('#build')); pointer('pointerup', $('#build'));
    await waitFor(() => children('target001').length === 1);
  });
  await check('Textarea-derived UIDs preserve hyphens and underscores', async () => {
    const editor = $('#block-input-log-outline-edited001'), oldID = editor.id;
    fake.records.set('ed-it_001', { uid: 'ed-it_001', string: editor.value, parent: 'page00001', children: [], edited: 1 });
    fake.records.get('page00001').children.push('ed-it_001'); editor.id = 'block-input-log-outline-ed-it_001';
    try {
      editor.focus(); pointerDrag($('#editing-bullet'), $('#build'));
      await waitFor(() => children('target001').length === 1);
      assert(children('target001')[0][':block/string'] === '{{embed-path: ((ed-it_001)) closed}}', 'UID was truncated');
    } finally { editor.id = oldID; }
  });
  await check('Foreign-origin links are not accepted as Roam destinations', async () => {
    const anchor = $('#build').parentElement, href = anchor.getAttribute('href');
    try {
      for (const value of ['https://example.com/#/app/Test%20graph/page/target001', 'https://roamresearch.com/#/app/Test%20graph/page/target001/extra']) {
        anchor.setAttribute('href', value); event('drop', $('#build'), begin());
        await new Promise(requestAnimationFrame); assert(children('target001').length === 0, 'Untrusted page link caused a write');
      }
    } finally { anchor.setAttribute('href', href); }
  });
  await check('Right-sidebar edited bullets use their own block identity', async () => {
    const sidebar = document.createElement('section'); sidebar.className = 'rm-sidebar-outline';
    sidebar.style.cssText = 'position:fixed;right:20px;top:20px;background:white;z-index:5';
    sidebar.innerHTML = '<div class="roam-block-container" data-block-uid="child0001"><div class="rm-block-main"><span class="rm-bullet" draggable="false">Sidebar bullet</span><textarea id="block-input-sidebar-outline-child0001">Original child block</textarea></div></div>';
    document.body.append(sidebar);
    try {
      sidebar.querySelector('textarea').focus(); pointerDrag(sidebar.querySelector('.rm-bullet'), $('#reading'));
      await waitFor(() => children('target002').length === 1);
      assert(children('target002')[0][':block/string'] === '{{embed-path: ((child0001)) closed}}', 'Sidebar source confused with main editor');
    } finally { sidebar.remove(); }
  });
  await check('Pointer cancellation on modifier changes and selected multi-block gestures prevents capture', async () => {
    const bullet = $('#editing-bullet');
    pointer('pointerdown', bullet); pointer('pointermove', $('#desk'), point($('#desk')), { shiftKey: true }); pointer('pointerup', $('#desk'));
    await new Promise(requestAnimationFrame); assert(children('desk-user-one').length === 0, 'Modifier introduced during drag was ignored');
    reset();
    $('#editing-container').classList.add('block-highlight-blue'); $('#bullet').closest('.roam-block-container').classList.add('block-highlight-blue');
    try {
      pointerDrag($('#editing-bullet'), $('#desk')); await new Promise(requestAnimationFrame);
      assert(children('desk-user-one').length === 0, 'Multi-block selection captured as a single block');
    } finally { document.querySelectorAll('.block-highlight-blue').forEach(node => node.classList.remove('block-highlight-blue')); }
  });
  await check('Native multi-block payload never creates a partial single-block capture', async () => {
    const dt = begin(); dt.setData('roam/block-uid-list-only-parents', 'block0001\nchild0001');
    event('drop', $('#desk'), dt); await waitFor(() => $('#desk').dataset.rrDeskDrop === 'error');
    assert(children('desk-user-one').length === 0, 'Partial multi-selection captured');
  });
  await check('Native and pointer event streams create only one entry', async () => {
    const bullet = $('#bullet'); pointer('pointerdown', bullet); const dt = begin();
    pointer('pointermove', $('#desk')); event('dragover', $('#desk'), dt); event('drop', $('#desk'), dt); pointer('pointerup', $('#desk')); window.dispatchEvent(new Event('dragend'));
    await waitFor(() => children('desk-user-one').length === 1); await new Promise(requestAnimationFrame);
    assert(children('desk-user-one').length === 1, 'Duplicate pointer/native write');
  });
  await check('Escape, pointercancel, blur and unload cancel pointer capture and clean UI', async () => {
    for (const mode of ['escape', 'cancel', 'blur', 'unload']) {
      reset(); pointer('pointerdown', $('#editing-bullet')); pointer('pointermove', $('#desk'));
      if (mode === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (mode === 'cancel') pointer('pointercancel', $('#editing-bullet'));
      if (mode === 'blur') window.dispatchEvent(new Event('blur'));
      if (mode === 'unload') runtime.stop();
      pointer('pointerup', $('#desk')); await new Promise(requestAnimationFrame);
      assert(children('desk-user-one').length === 0, 'Canceled pointer wrote: ' + mode);
      assert(!document.querySelector('.rr-desk-drop-accessory'), 'Canceled highlight remained: ' + mode);
    }
    assert(!document.querySelector('.rr-desk-drop-live,[data-rr-desk-drop-style]'), 'Unload left UI');
  });
  await check('Graph changes reject stale drags and late pending feedback', async () => {
    let dt = begin(); fake.api.graph.name = 'Other graph'; event('drop', $('#desk'), dt); await new Promise(requestAnimationFrame);
    assert(children('desk-user-one').length === 0, 'Stale drag wrote');
    reset(); let release; fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
    event('drop', $('#desk'), begin()); await waitFor(() => release);
    fake.api.graph.name = 'Other graph'; window.dispatchEvent(new Event('hashchange')); release();
    await waitFor(() => children('desk-user-one').length === 1); await new Promise(requestAnimationFrame);
    assert(!$('#desk').hasAttribute('data-rr-desk-drop'), 'Late feedback leaked');
  });
  await check('Pending and error details stay accessible in the destination row', async () => {
    let release; fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
    event('drop', $('#desk'), begin()); await waitFor(() => release);
    assert($('#desk').getAttribute('aria-busy') === 'true' && $('#desk .rr-desk-drop-spinner'), 'Missing pending state');
    assert($('.rr-desk-drop-live').getAttribute('role') === 'status', 'No live announcement');
    release(); await waitFor(() => $('#desk').dataset.rrDeskDrop === 'added'); assert(!$('#desk').hasAttribute('aria-busy'), 'Busy remained');
    reset(); fake.hooks.beforeCreate = () => { throw new Error('Simulated unavailable writer'); };
    event('drop', $('#desk'), begin()); await waitFor(() => $('#desk').dataset.rrDeskDrop === 'error');
    const warning = $('#desk .rr-desk-drop-error'); assert(warning.getAttribute('aria-label').length > 20 && !warning.hasAttribute('title'), 'Missing error details or competing native tooltip');
    warning.focus(); assert(document.activeElement === warning, 'Error is not focusable');
  });
  await check('Repeated loads, unload attributes and late writes are cleaned safely', async () => {
    runtime.start(); runtime.start(); assert(document.querySelectorAll('[data-rr-desk-drop-style]').length === 1, 'Duplicate style');
    const row = $('#desk'); row.setAttribute('data-rr-desk-drop', 'pre-existing'); row.setAttribute('aria-busy', 'false');
    let release; fake.hooks.beforeCreate = () => new Promise(resolve => { release = resolve; });
    event('drop', row, begin()); await waitFor(() => release); runtime.stop();
    assert(row.getAttribute('data-rr-desk-drop') === 'pre-existing' && row.getAttribute('aria-busy') === 'false', 'Attributes not restored');
    row.removeAttribute('data-rr-desk-drop'); row.removeAttribute('aria-busy'); release(); await waitFor(() => children('desk-user-one').length === 1);
    assert(!document.querySelector('.rr-desk-drop-accessory,.rr-desk-drop-live,[data-rr-desk-drop-style]'), 'UI after unload');
  });
  await check('Copy/link permission matrix respects source restrictions', async () => {
    for (const [allowed, expected] of [['all', 'copy'], ['uninitialized', 'copy'], ['copy', 'copy'], ['copyLink', 'copy'], ['copyMove', 'copy'], ['link', 'link'], ['linkMove', 'link'], ['move', null], ['none', null], ['unknown', null]]) {
      reset(); const dt = begin('#bullet', {}, allowed), row = $('#desk');
      assert(event('dragover', row, dt).defaultPrevented === !!expected, 'Wrong acceptance: ' + allowed);
      assert(dt.dropEffect === (expected || 'none'), 'Wrong cursor: ' + allowed);
      assert(event('drop', row, dt).defaultPrevented === !!expected, 'Wrong drop: ' + allowed);
      if (expected) await waitFor(() => row.dataset.rrDeskDrop === 'added');
      else { await new Promise(requestAnimationFrame); assert(children('desk-user-one').length === 0, 'Unsupported write'); }
    }
  });
  await check('Target tint survives important themes and respects reduced motion', async () => {
    const row = $('#desk'), other = $('#depot'), theme = document.createElement('style');
    theme.textContent = '.roam-body .roam-app .roam-sidebar-container .roam-sidebar-content :is(.log-button,.starred-pages .page){background:transparent!important;color:#69757f!important;box-shadow:none!important}';
    document.head.append(theme); const idle = getComputedStyle(row).backgroundColor, otherColor = getComputedStyle(other).backgroundColor;
    try {
      event('dragover', row, begin()); await waitFor(() => getComputedStyle(row).backgroundColor !== idle);
      const css = getComputedStyle(row); assert(css.boxShadow === 'none', 'Frame returned'); assert(getComputedStyle(other).backgroundColor === otherColor, 'Adjacent row recolored');
      assert(matchMedia('(prefers-reduced-motion:reduce)').matches ? css.transitionDuration === '0s' : css.transitionDuration === '0.1s', 'Motion preference ignored');
    } finally { theme.remove(); }
  });
  window.__deskDropTestResults = report; return report;
}
$('#run-tests').addEventListener('click', runTests);
window.__deskDropFixture = { reset, runTests, snapshot: () => fake.snapshot(), runtime: () => runtime, fake: () => fake, begin, event, pointer, point };
reset();
