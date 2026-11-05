const pageUid = date => `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${date.getFullYear()}`;
const pageTitle = date => {
  const day = date.getDate();
  const suffix = day >= 11 && day <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return `${date.toLocaleString('en-US', { month: 'long' })} ${day}${suffix}, ${date.getFullYear()}`;
};

export function createFakeRoam() {
  const records = new Map([
    ['desk-user-one', { uid: 'desk-user-one', title: 'Worksurface (renamed)', children: [] }],
    ['target001', { uid: 'target001', title: 'Build', children: [] }],
    ['target002', { uid: 'target002', title: 'Reading List: Inbox', children: [] }],
    ['page00001', { uid: 'page00001', title: 'Source page', children: ['block0001'] }],
    ['block0001', { uid: 'block0001', string: 'Original content', parent: 'page00001', children: ['child0001'], edited: 1 }],
    ['child0001', { uid: 'child0001', string: 'Original child block', parent: 'block0001', children: [], edited: 1 }],
  ]);
  const users = new Map([['user-one', { desk: 'desk-user-one' }]]);
  let currentUser = 'user-one', nextId = 0, clock = 10;
  const hooks = {};
  const shallow = (uid) => {
    const r = records.get(uid);
    if (!r) return null;
    return { ':block/uid': uid, ...(r.title !== undefined ? { ':node/title': r.title } : {}), ...(r.string !== undefined ? { ':block/string': r.string } : {}) };
  };
  function pullBlock(uid) {
    const r = records.get(uid);
    if (!r) return null;
    let page = r;
    while (page.parent) page = records.get(page.parent);
    const refs = [...records.values()].filter(x => typeof x.string === 'string' && x.string.includes(`((${uid}))`));
    return {
      ...shallow(uid),
      ':block/order': r.parent ? records.get(r.parent).children.indexOf(uid) : undefined,
      ':edit/time': r.edited,
      ':block/children': r.children.map(shallow),
      ':block/_children': r.parent ? [{ ':block/uid': r.parent }] : [],
      ':block/page': { ':block/uid': page.uid },
      ':block/_refs': refs.map(x => ({ ':block/uid': x.uid })),
    };
  }
  const api = {
    graph: { name: 'Test graph', type: 'hosted' },
    user: { uid: () => currentUser },
    util: { generateUID: () => `new${String(++nextId).padStart(6, '0')}`, dateToPageUid: pageUid, dateToPageTitle: pageTitle },
    data: {
      pull(selector, lookup) {
        hooks.onPull?.(selector, lookup);
        if (lookup[0] === ':user/uid') {
          const u = users.get(lookup[1]);
          return u ? { ':user/uid': lookup[1], ...(u.desk ? { ':user/desk-page': u.desk } : {}) } : null;
        }
        if (lookup[0] === ':node/title') {
          const record = [...records.values()].find(r => r.title === lookup[1]);
          return record ? pullBlock(record.uid) : null;
        }
        if (lookup[0] !== ':block/uid') throw new Error('Unexpected lookup');
        return pullBlock(lookup[1]);
      },
      q(query, uid) {
        if (!query.includes(':user/desk-page')) throw new Error('Unexpected query');
        return [...users.values()].some(u => u.desk === uid) ? 1 : null;
      },
      page: {
        async create({ page }) {
          await hooks.beforePageCreate?.(page);
          if ([...records.values()].some(record => record.title === page.title) || records.has(page.uid)) throw new Error('Page already exists');
          records.set(page.uid, { uid: page.uid, title: page.title, children: [] });
          await hooks.afterPageCreate?.(page);
        },
      },
      block: {
        async create({ location, block }) {
          await hooks.beforeCreate?.({ location, block });
          if (!records.has(location['parent-uid'])) throw new Error('Parent missing');
          if (records.has(block.uid)) throw new Error('Duplicate uid');
          const parent = records.get(location['parent-uid']);
          const index = location.order === 'first' ? 0 : location.order === 'last' ? parent.children.length : location.order;
          records.set(block.uid, { uid: block.uid, string: block.string, parent: parent.uid, children: [], edited: ++clock });
          parent.children.splice(index, 0, block.uid);
          await hooks.afterCreate?.({ location, block });
        },
        async delete({ block }) {
          await hooks.beforeDelete?.(block.uid);
          const r = records.get(block.uid);
          if (!r) return;
          for (const other of records.values()) {
            if (other.string?.includes(`((${block.uid}))`)) other.string = other.string.replaceAll(`((${block.uid}))`, r.string);
          }
          for (const child of [...r.children]) await api.data.block.delete({ block: { uid: child } });
          if (r.parent) records.get(r.parent).children = records.get(r.parent).children.filter(u => u !== r.uid);
          records.delete(r.uid);
        },
        async update({ block }) {
          const r = records.get(block.uid);
          if (!r) throw new Error('Missing block');
          Object.assign(r, block, { edited: ++clock });
        },
      },
    },
  };
  return {
    api, hooks, records, users,
    setUser: uid => { currentUser = uid; },
    snapshot: () => structuredClone([...records.values()]),
    block: uid => api.data.pull('[*]', [':block/uid', uid]),
    desk: () => api.data.pull('[*]', [':block/uid', users.get(currentUser)?.desk]),
  };
}
