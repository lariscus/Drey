import { describe, expect, it } from 'vitest';
import {
  chainCursor,
  chainItemsOf,
  chainLifeOf,
  chainSteps,
  lockedCount,
  parseChainEntry,
  parseChainItems,
  parseSendBack,
  renderChainEntry,
  renderChainLine,
  renderSendBack,
} from './chain-list';

describe('the chain entry grammar', () => {
  it('reads a persona, a mode and the notify rule', () => {
    expect(parseChainEntry('ben')).toEqual({ persona: 'ben', mode: null, notify: false });
    expect(parseChainEntry('paul:shape')).toEqual({ persona: 'paul', mode: 'shape', notify: false });
    expect(parseChainEntry(' ralf(notify) ')).toEqual({ persona: 'ralf', mode: null, notify: true });
    expect(parseChainEntry('paul:shape (notify)')).toEqual({ persona: 'paul', mode: 'shape', notify: true });
  });

  it('round-trips canonically', () => {
    for (const raw of ['ben', 'paul:shape', 'ralf(notify)', 'paul:shape(notify)', 'build-default']) {
      expect(renderChainEntry(parseChainEntry(raw)!)).toBe(raw);
    }
  });

  it('refuses everything outside the grammar — the old delta included', () => {
    for (const raw of ['', 'Ben', 'insert security(ralf) after review', 'skip verify', 'paul:plan', 'ben(ralf)', 'ben notify']) {
      expect(parseChainEntry(raw)).toBeNull();
    }
  });
});

describe('a whole chain', () => {
  it('reads a list or one ;-separated line', () => {
    expect(chainItemsOf(['paul:shape', ' ben '])).toEqual(['paul:shape', 'ben']);
    expect(chainItemsOf('paul:shape; paul;ben; ;you')).toEqual(['paul:shape', 'paul', 'ben', 'you']);
    expect(chainItemsOf(undefined)).toEqual([]);
  });

  it('fails as a whole on one unreadable entry', () => {
    expect(parseChainItems(['paul', 'skip verify', 'you'])).toEqual({ ok: false, bad: 'skip verify' });
    const ok = parseChainItems(['paul:shape', 'paul', 'ben', 'you']);
    expect(ok.ok).toBe(true);
    expect(ok.ok && renderChainLine(ok.entries)).toBe('paul:shape; paul; ben; you');
  });
});

describe('the send-back mark', () => {
  it('reads from>to and refuses a forward or zero position', () => {
    expect(parseSendBack('5>3')).toEqual({ from: 5, to: 3 });
    expect(parseSendBack(' 5 > 1 ')).toEqual({ from: 5, to: 1 });
    expect(parseSendBack('3>5')).toBeNull();
    expect(parseSendBack('3>0')).toBeNull();
    expect(parseSendBack('back')).toBeNull();
    expect(renderSendBack({ from: 5, to: 3 })).toBe('5>3');
  });
});

describe('the cursor and the states', () => {
  const entries = parseChainItems(['paul:shape', 'paul', 'ben', 'you']);
  const list = entries.ok ? entries.entries : [];

  it('folds past, current and future around the cursor', () => {
    expect(chainSteps(list, 3).map((s) => `${s.position}${s.state[0]}`)).toEqual(['1p', '2p', '3c', '4f']);
    expect(chainSteps(list, null).every((s) => s.state === 'future')).toBe(true);
    expect(chainSteps(list, 5).every((s) => s.state === 'past')).toBe(true);
  });

  it('has no cursor while queued, sits past the end when done, and reads at otherwise', () => {
    const ids = ['inbox', 'shaping', 'prioritized', 'building', 'ready', 'done'];
    expect(chainLifeOf('inbox', ids)).toBe('queued');
    expect(chainLifeOf('prioritized', ids)).toBe('queued');
    expect(chainLifeOf('building', ids)).toBe('active');
    expect(chainLifeOf('done', ids)).toBe('done');
    expect(chainCursor(list, 3, 'queued')).toBeNull();
    expect(chainCursor(list, 3, 'active')).toBe(3);
    expect(chainCursor(list, undefined, 'active')).toBe(1);
    expect(chainCursor(list, 9, 'active')).toBe(4);
    expect(chainCursor(list, 2, 'done')).toBe(5);
  });

  it('locks every past position and the current one', () => {
    expect(lockedCount(null, 4)).toBe(0);
    expect(lockedCount(2, 4)).toBe(2);
    expect(lockedCount(5, 4)).toBe(4);
  });
});
