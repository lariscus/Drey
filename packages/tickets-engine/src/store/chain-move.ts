import { isSeq, parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { cursorForColumn } from '../core/chain-placement';
import { EDGE_STAGES } from '../core/lifecycle-stages';
import { parseTicketChainFields } from '../core/ticket-chain-fields';
import type { TicketDetail } from '../ports/ticket-store';
import { setDocumentField } from './document-fields';
import type { HolderPlacement } from './store-board';

/**
 * An owner's column move of a chain ticket on a lifecycle store (req-257): the column of an `active`
 * ticket is its holder's, so moving it into a working column moves the CURSOR to the position that
 * stands there — the first at or after the current one (handing it on), else the nearest earlier one
 * (back). Edge columns (Inbox, Prioritized, Done) keep the cursor. Returns the legacy text with `at:`
 * set; unchanged for a chainless ticket, an edge column, or a column no position stands in.
 */
export function withCursorForMove(legacyText: string, record: TicketDetail, target: string, placement: HolderPlacement): string {
  if (EDGE_STAGES.includes(target) || target === placement.columns.terminal) {
    return legacyText;
  }
  const fields = parseTicketChainFields({ chain: record.extensions['x-chain'], at: record.extensions['x-at'] }, [], false);
  if (fields.chain === undefined) {
    return legacyText;
  }
  const cursor = cursorForColumn({ chain: fields.chain, at: fields.at, target }, placement.lookup, placement.columns);
  if (cursor === null || cursor === (fields.at ?? 1)) {
    return legacyText;
  }
  return setDocumentField(legacyText, 'at', String(cursor)) ?? legacyText;
}

/**
 * req-270: the legacy text with the whole chain and the cursor replaced — a persona board move that hands
 * the entry at the cursor to another persona (`start`, `hand`). The chain is written as one flow list so
 * the store's `x-chain` keeps its `;` line; every other key, its order and the body stay.
 */
export function withChainAndCursor(legacyText: string, chain: readonly string[], at: number): string {
  const { yamlText, body, hadFence } = splitFrontmatter(legacyText);
  if (!hadFence || yamlText === null) {
    return legacyText;
  }
  const doc = parseDocument(yamlText);
  doc.setIn(['chain'], doc.createNode([...chain]));
  const node = doc.getIn(['chain']);
  if (isSeq(node)) {
    node.flow = true;
  }
  doc.setIn(['at'], at);
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${body}`;
}
