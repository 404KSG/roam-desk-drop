import { isSafeUid } from './desk-capture.js';
import { DeskDropError } from './roam-adapter.js';

const lines = value => typeof value === 'string' ? [...new Set(value.split(/\r?\n/).map(v => v.trim()).filter(Boolean))] : [];
export const hasRoamPayload = transfer => Array.from(transfer?.types ?? []).some(type => ['roam/block-uid-list-only-parents', 'roam/block-uid-list'].includes(type));
export const hasModifier = event => Boolean(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);

export function readDropPayload(transfer, origin, expectedSourceUid) {
  if (!hasRoamPayload(transfer) || typeof transfer.getData !== 'function') throw new DeskDropError('INVALID_PAYLOAD', 'Only native block drags from Roam are accepted.');
  const uids = lines(transfer.getData('roam/block-uid-list-only-parents') || transfer.getData('roam/block-uid-list'));
  if (uids.length !== 1) throw new DeskDropError('SINGLE_BLOCK_ONLY', 'This version accepts one top-level block at a time. Drag blocks individually.');
  if (!isSafeUid(uids[0])) throw new DeskDropError('INVALID_UID', 'Could not safely identify the dragged block.');
  if (expectedSourceUid && expectedSourceUid !== uids[0]) throw new DeskDropError('SOURCE_CHANGED', 'The drag source does not match its payload. Clear the selection and try again.');
  const uris = lines(transfer.getData('roam/roam-uri-list'));
  if (!uris.length || uris.length > 1000) throw new DeskDropError('INVALID_PAYLOAD', 'Could not confirm the source graph. Nothing was added to Desk.');
  const parsed = uris.map(uri => {
    try {
      const url = new URL(uri);
      const trusted = (url.protocol === 'roam:' && !url.hostname) || (url.protocol === 'https:' && ['roamresearch.com', 'www.roamresearch.com'].includes(url.hostname));
      const match = url.hash.match(/^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)\/?(?:\?.*)?$/);
      if (!trusted || !match) throw new Error('Unsupported URI');
      return { type: match[1] === 'app' ? 'hosted' : 'offline', graph: decodeURIComponent(match[2]), uid: decodeURIComponent(match[3]) };
    } catch {
      throw new DeskDropError('INVALID_PAYLOAD', 'Could not recognize the native Roam link. Nothing was added to Desk.');
    }
  });
  if (parsed.some(item => item.graph !== origin?.graphName || item.type !== origin?.graphType)) {
    throw new DeskDropError('CROSS_GRAPH', 'Cross-graph drops are not supported in this version.');
  }
  if (!parsed.some(item => item.uid === uids[0])) throw new DeskDropError('INVALID_PAYLOAD', 'The drag link does not match the block UID.');
  return uids;
}
