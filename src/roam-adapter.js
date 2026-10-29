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
const PAGE = '[:block/uid :node/title {:block/children [:block/uid :block/string]}]';

export function createRoamDeskAdapter({ getAPI }) {
  function api() {
    const value = getAPI?.();
    if (!value?.data?.pull || !value?.data?.block?.create || !value?.user?.uid || !value?.util?.generateUID) {
      throw new DeskDropError('UNSUPPORTED_API', 'This Roam version does not expose the required public APIs.');
    }
    return value;
  }

  function getContext() {
    const value = api();
    const context = { graphName: value.graph?.name, graphType: value.graph?.type, userUid: value.user.uid() };
    if (!context.graphName || !context.graphType || !context.userUid) {
      throw new DeskDropError('NO_CONTEXT', 'Sign in and open a Roam graph to use Desk Drop.');
    }
    return Object.freeze(context);
  }

  function assertContext(context) {
    if (!sameContext(getContext(), context)) throw new DeskDropError('CONTEXT_CHANGED', 'The graph or user changed. Operation stopped; check the original graph if you just dropped a block.');
  }

  function pageView(entity, uid) {
    if (!entity || field(entity, 'block/uid') !== uid) return null;
    const title = field(entity, 'node/title');
    return {
      uid,
      title: typeof title === 'string' ? title : undefined,
      entries: (field(entity, 'block/children') ?? []).map(entry => ({ uid: field(entry, 'block/uid'), string: field(entry, 'block/string') })),
    };
  }

  async function pullPage(uid) {
    return pageView(await api().data.pull(PAGE, [':block/uid', uid]), uid);
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
    if (typeof uid !== 'string' || !uid) throw new DeskDropError('DESK_UNBOUND', 'Open native Desk once before dropping a block.');
    const page = await pullPage(uid);
    assertContext(context);
    if (!page?.title) throw new DeskDropError('DESK_MISSING', 'The bound Desk page is missing or invalid. Recover it through native Desk first.');
    return { kind: 'desk', ...page };
  }

  async function resolveDaily(context, acceptedAt, assertActive) {
    const check = () => { assertActive(); assertContext(context); };
    check();
    const value = api();
    const today = new Date(acceptedAt);
    const uid = value.util?.dateToPageUid?.(today);
    const title = value.util?.dateToPageTitle?.(today);
    if (typeof value.util?.dateToPageUid !== 'function' || typeof value.util?.dateToPageTitle !== 'function' || typeof value.data?.page?.create !== 'function' || typeof uid !== 'string' || !uid || typeof title !== 'string' || !title.trim()) {
      throw new DeskDropError('UNSUPPORTED_API', 'This Roam version cannot resolve or create today\u2019s Daily Notes page.');
    }
    let page = await pullPage(uid);
    check();
    if (page?.title) return { kind: 'daily', ...page };
    if (page) throw new DeskDropError('DNP_CONFLICT', 'Today\u2019s Daily Notes UID already belongs to a block. Nothing was added.');
    const titled = await value.data.pull(PAGE, [':node/title', title]);
    check();
    const titledUid = field(titled, 'block/uid');
    if (titledUid && titledUid !== uid) throw new DeskDropError('DNP_CONFLICT', 'Today’s Daily Notes title already belongs to another page. Nothing was added.');
    try { await value.data.page.create({ page: { title, uid } }); }
    catch (error) {
      if (error instanceof DeskDropError) throw error;
    }
    check();
    page = await pullPage(uid);
    check();
    if (page?.title !== title) throw new DeskDropError('DNP_UNCONFIRMED', 'Could not confirm today\u2019s Daily Notes page. Nothing was added.');
    return { kind: 'daily', ...page };
  }

  async function resolvePinnedPage(context, destination) {
    assertContext(context);
    let uid = destination.uid;
    if (!uid && typeof destination.title === 'string' && destination.title.trim()) {
      const titled = await api().data.pull(PAGE, [':node/title', destination.title.trim()]);
      assertContext(context);
      uid = field(titled, 'block/uid');
    }
    if (typeof uid !== 'string' || !uid) throw new DeskDropError('DESTINATION_MISSING', 'The starred page is missing. Nothing was added.');
    const page = await pullPage(uid);
    assertContext(context);
    if (!page) throw new DeskDropError('DESTINATION_MISSING', 'The starred page is missing. Nothing was added.');
    if (!page.title) throw new DeskDropError('DESTINATION_NOT_PAGE', 'Only a pinned page can receive this block. Nothing was added.');
    return { kind: 'page', ...page };
  }

  return {
    getContext, assertContext, readBlock, resolveDesk, resolveDaily, resolvePinnedPage,
    isDeskPage: async (uid) => {
      if (typeof api().data.q !== 'function') throw new DeskDropError('UNSUPPORTED_API', 'This Roam version lacks the query API required for safety checks.');
      return (await api().data.q('[:find ?u . :in $ ?pageUid :where [?u :user/desk-page ?pageUid]]', uid)) != null;
    },
    generateUID: () => api().util.generateUID(),
    createEntry: ({ parentUid, uid, string }) => api().data.block.create({
      location: { 'parent-uid': parentUid, order: 'first' },
      block: { uid, string },
    }),
  };
}
