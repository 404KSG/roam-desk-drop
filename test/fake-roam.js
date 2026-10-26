export function createFakeRoam() {
  const records = new Map([
    ['desk-user-one', { uid: 'desk-user-one', title: '工作台（已改名）', children: [] }],
    ['page00001', { uid: 'page00001', title: 'Daily Notes', children: ['block0001'] }],
    ['block0001', { uid: 'block0001', string: '原始内容', parent: 'page00001', children: ['child0001'], edited: 1 }],
    ['child0001', { uid: 'child0001', string: '原子块', parent: 'block0001', children: [], edited: 1 }],
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
    util: { generateUID: () => `new${String(++nextId).padStart(6, '0')}` },
    data: {
      pull(selector, lookup) {
        hooks.onPull?.(selector, lookup);
        if (lookup[0] === ':user/uid') {
          const u = users.get(lookup[1]);
          return u ? { ':user/uid': lookup[1], ...(u.desk ? { ':user/desk-page': u.desk } : {}) } : null;
        }
        if (lookup[0] !== ':block/uid') throw new Error('Unexpected lookup');
        return pullBlock(lookup[1]);
      },
      q(query, uid) {
        if (!query.includes(':user/desk-page')) throw new Error('Unexpected query');
        return [...users.values()].some(u => u.desk === uid) ? 1 : null;
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
