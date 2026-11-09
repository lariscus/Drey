import { describe, expect, it } from 'vitest';
import { parsePersonaPatch } from './persona-patch-body';

describe('parsePersonaPatch (req-171: summary, budget, allowed)', () => {
  it('carries the one line, the budget and the allowed keys beside the older ones', () => {
    expect(parsePersonaPatch({ summary: 'Builds.', budget: 7.5, allowed: { network: true, runCommands: null }, title: 'Ben' })).toEqual({
      ok: true,
      value: { title: 'Ben', summary: 'Builds.', budget: 7.5, allowed: { network: true, runCommands: null } },
    });
    expect(parsePersonaPatch({ budget: null })).toEqual({ ok: true, value: { budget: null } });
  });

  it('refuses a key of the wrong shape, naming it', () => {
    expect(parsePersonaPatch({ summary: 5 })).toEqual({ ok: false, error: 'summary is a string' });
    expect(parsePersonaPatch({ budget: '5' })).toEqual({ ok: false, error: 'budget is a number of dollars or null' });
    expect(parsePersonaPatch({ allowed: [] })).toEqual({ ok: false, error: 'allowed is an object' });
    expect(parsePersonaPatch({ pool: 'sonnet' })).toEqual({ ok: false, error: 'pool is a list of names' });
  });

  it('trims the names of a list and refuses a body with none of the writable keys', () => {
    expect(parsePersonaPatch({ skills: [' tdd '] })).toEqual({ ok: true, value: { skills: ['tdd'] } });
    expect(parsePersonaPatch({ kind: 'human' })).toMatchObject({ ok: false });
    expect(parsePersonaPatch(null)).toEqual({ ok: false, error: 'bad persona patch payload' });
  });
});
