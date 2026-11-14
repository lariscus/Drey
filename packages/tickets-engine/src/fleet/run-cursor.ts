import type { ChainEntry } from '../contracts/chain';
import { parseChainItems, renderChainEntries } from '../core/chain-list';
import type { RunCursor } from './protocol';

/**
 * A chain run's cursor as the runner reads it (req-257): the chain's entries
 * the request carries, or — an older sender without them — placeholders of
 * the chain's length (a send-back still checks its position; its line names
 * no persona).
 */
export function cursorChain(cursor: RunCursor): ChainEntry[] {
  const parsed = cursor.entries === undefined ? null : parseChainItems([...cursor.entries]);
  if (parsed !== null && parsed.ok && parsed.entries.length === cursor.length) {
    return [...parsed.entries];
  }
  return Array.from({ length: cursor.length }, () => ({ persona: '?', mode: null, notify: false }));
}

/** The request's cursor of a chain ticket: position, length, the entries, the send-back used, the crew a plan may name, and the red-gate loop (req-78). */
export function runCursorOf(input: {
  readonly chain: readonly ChainEntry[];
  readonly at: number | undefined;
  readonly sentBack?: { readonly from: number; readonly to: number } | undefined;
  readonly crew?: RunCursor['crew'];
  readonly redLoop?: Pick<RunCursor, 'returnTo' | 'redBacks' | 'maxRed' | 'redBack'>;
}): RunCursor {
  const length = input.chain.length;
  const loop = input.redLoop ?? {};
  return {
    at: Math.min(Math.max(input.at ?? 1, 1), length),
    length,
    entries: renderChainEntries(input.chain),
    ...(input.sentBack !== undefined ? { sentBack: input.sentBack } : {}),
    ...(input.crew !== undefined ? { crew: input.crew } : {}),
    ...(loop.returnTo !== undefined ? { returnTo: loop.returnTo } : {}),
    ...(loop.redBacks !== undefined && loop.redBacks > 0 ? { redBacks: loop.redBacks } : {}),
    ...(loop.maxRed !== undefined ? { maxRed: loop.maxRed } : {}),
    ...(loop.redBack !== undefined ? { redBack: loop.redBack } : {}),
  };
}
