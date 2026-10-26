export class DeskDropError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DeskDropError';
    this.code = code;
  }
}

export const sameContext = (a, b) => Boolean(a && b && a.graphName === b.graphName && a.graphType === b.graphType && a.userUid === b.userUid);

const field = (entity, key) => entity?.[`:${key}`] ?? entity?.[key] ?? entity?.[key.split('/').at(-1)];
const uids = values => (values ?? []).map(value => field(value, 'block/uid')).filter(Boolean);
const BLOCK = '[:block/uid :node/title :block/string :edit/time {:block/page [:block/uid]} {:block/_children [:block/uid]} {:block/children [:block/uid]} {:block/_refs [:block/uid]}]';
const DESK = '[:block/uid :node/title {:block/children [:block/uid :block/string]}]';

export function createRoamDeskAdapter({ getAPI }) {
  function api() {
    const value = getAPI?.();
    if (!value?.data?.pull || !value?.data?.block?.create || !value?.user?.uid || !value?.util?.generateUID) {
      throw new DeskDropError('UNSUPPORTED_API', '当前 Roam 版本缺少需要的公开接口。');
    }
    return value;
  }

  function getContext() {
    const value = api();
    const context = { graphName: value.graph?.name, graphType: value.graph?.type, userUid: value.user.uid() };
    if (!context.graphName || !context.graphType || !context.userUid) {
      throw new DeskDropError('NO_CONTEXT', '请在已登录的 Roam 图谱中使用。');
    }
    return Object.freeze(context);
  }

  function assertContext(context) {
    if (!sameContext(getContext(), context)) throw new DeskDropError('CONTEXT_CHANGED', '图谱或用户已改变，操作已停止；如刚松手，请回原图谱核对结果。');
  }

  async function readBlock(uid) {
    const entity = await api().data.pull(BLOCK, [':block/uid', uid]);
    if (!entity || !field(entity, 'block/uid')) return null;
    return {
      uid: field(entity, 'block/uid'), title: field(entity, 'node/title'),
      string: field(entity, 'block/string'), edited: field(entity, 'edit/time'),
      pageUid: field(field(entity, 'block/page'), 'block/uid'),
      parentUids: uids(field(entity, 'block/_children')),
      childUids: uids(field(entity, 'block/children')),
      referrerUids: uids(field(entity, 'block/_refs')),
    };
  }

  async function resolveDesk(context) {
    assertContext(context);
    const user = await api().data.pull('[:user/desk-page]', [':user/uid', context.userUid]);
    assertContext(context);
    const uid = field(user, 'user/desk-page');
    if (typeof uid !== 'string' || !uid) {
      throw new DeskDropError('DESK_UNBOUND', '请先打开一次原生 Desk，再尝试拖入。');
    }
    const page = await api().data.pull(DESK, [':block/uid', uid]);
    assertContext(context);
    if (field(page, 'block/uid') !== uid || typeof field(page, 'node/title') !== 'string') {
      throw new DeskDropError('DESK_MISSING', 'Desk 绑定的页面已失效，请先通过原生 Desk 恢复。');
    }
    return {
      uid,
      entries: (field(page, 'block/children') ?? []).map(entry => ({ uid: field(entry, 'block/uid'), string: field(entry, 'block/string') })),
    };
  }

  return {
    getContext, assertContext, readBlock, resolveDesk,
    isDeskPage: async (uid) => {
      if (typeof api().data.q !== 'function') throw new DeskDropError('UNSUPPORTED_API', '当前 Roam 缺少安全校验所需的查询接口。');
      return (await api().data.q('[:find ?u . :in $ ?pageUid :where [?u :user/desk-page ?pageUid]]', uid)) != null;
    },
    generateUID: () => api().util.generateUID(),
    deleteEntry: (uid) => {
      if (typeof api().data.block.delete !== 'function') throw new DeskDropError('UNSUPPORTED_API', '当前 Roam 缺少安全移除入口的接口。');
      return api().data.block.delete({ block: { uid } });
    },
    createEntry: ({ deskUid, uid, string }) => api().data.block.create({
      location: { 'parent-uid': deskUid, order: 'first' },
      block: { uid, string },
    }),
  };
}
