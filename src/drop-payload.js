import { isSafeUid } from './desk-capture.js';
import { DeskDropError } from './roam-adapter.js';

const lines = value => typeof value === 'string' ? [...new Set(value.split(/\r?\n/).map(v => v.trim()).filter(Boolean))] : [];
export const hasRoamPayload = transfer => Array.from(transfer?.types ?? []).some(type => ['roam/block-uid-list-only-parents', 'roam/block-uid-list'].includes(type));
export const hasModifier = event => Boolean(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);

export function readDropPayload(transfer, origin, expectedSourceUid) {
  if (!hasRoamPayload(transfer) || typeof transfer.getData !== 'function') throw new DeskDropError('INVALID_PAYLOAD', '只接受 Roam 内部 Block 的原生拖拽。');
  const uids = lines(transfer.getData('roam/block-uid-list-only-parents') || transfer.getData('roam/block-uid-list'));
  if (uids.length !== 1) throw new DeskDropError('SINGLE_BLOCK_ONLY', '第一版只支持一个顶层 Block，请逐块拖入。');
  if (!isSafeUid(uids[0])) throw new DeskDropError('INVALID_UID', '无法安全识别拖动的 Block。');
  if (expectedSourceUid && expectedSourceUid !== uids[0]) throw new DeskDropError('SOURCE_CHANGED', '拖拽来源与载荷不一致，请取消选择后重试。');
  const uris = lines(transfer.getData('roam/roam-uri-list'));
  if (!uris.length || uris.length > 1000) throw new DeskDropError('INVALID_PAYLOAD', '无法确认来源图谱，未加入 Desk。');
  const parsed = uris.map(uri => {
    try {
      const url = new URL(uri);
      const trusted = (url.protocol === 'roam:' && !url.hostname) || (url.protocol === 'https:' && ['roamresearch.com', 'www.roamresearch.com'].includes(url.hostname));
      const match = url.hash.match(/^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)\/?(?:\?.*)?$/);
      if (!trusted || !match) throw new Error('Unsupported URI');
      return { type: match[1] === 'app' ? 'hosted' : 'offline', graph: decodeURIComponent(match[2]), uid: decodeURIComponent(match[3]) };
    } catch {
      throw new DeskDropError('INVALID_PAYLOAD', '无法识别原生 Roam 链接，未加入 Desk。');
    }
  });
  if (parsed.some(item => item.graph !== origin?.graphName || item.type !== origin?.graphType)) {
    throw new DeskDropError('CROSS_GRAPH', '第一版不接受跨图谱拖拽。');
  }
  if (!parsed.some(item => item.uid === uids[0])) throw new DeskDropError('INVALID_PAYLOAD', '拖拽链接与 Block UID 不一致。');
  return uids;
}
