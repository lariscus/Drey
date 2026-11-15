import { isSeq, parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';

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
