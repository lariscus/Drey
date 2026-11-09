import { describe, expect, it } from 'vitest';
import { PersonaRights, type PersonaSource } from './persona-rights';
import { StaleWriteGuard } from './stale-writes';

/** req-167, R5: reads everywhere, writes where the persona's `allowed: write-vaults` says. */
const source: PersonaSource = {
  writeVaultsOf: async (id) => (id === 'ben' ? ['work'] : id === 'pia' ? [] : id === 'broken' ? Promise.reject(new Error('board down')) : null),
};

describe('PersonaRights (req-167)', () => {
  it('grants the vaults the persona names', async () => {
    expect(await new PersonaRights(source).grantFor({ persona: 'ben', readOnly: false })).toEqual({ who: 'ben', vaults: ['work'] });
  });

  it('a persona without the entry, an unknown one or an unreadable board writes nothing', async () => {
    const rights = new PersonaRights(source);
    expect((await rights.grantFor({ persona: 'pia', readOnly: false })).vaults).toEqual([]);
    expect((await rights.grantFor({ persona: 'nobody', readOnly: false })).vaults).toEqual([]);
    expect((await rights.grantFor({ persona: 'broken', readOnly: false })).vaults).toEqual([]);
  });

  it('a read-only run (a review) and a run without a persona write nothing', async () => {
    const rights = new PersonaRights(source);
    expect(await rights.grantFor({ persona: 'ben', readOnly: true })).toEqual({ who: 'ben', vaults: [] });
    expect(await rights.grantFor({ persona: null, readOnly: false })).toEqual({ who: 'this run', vaults: [] });
  });
});

describe('StaleWriteGuard (req-167, ADR-0060)', () => {
  it('refuses only a file the worker read and that changed or went since', () => {
    const guard = new StaleWriteGuard();
    expect(guard.refusal('notes', 'a.md', 7)).toBeNull();
    guard.saw('notes', 'a.md', 7);
    expect(guard.refusal('notes', 'a.md', 7)).toBeNull();
    expect(guard.refusal('notes', 'a.md', 8)).toMatch(/^Error: a\.md changed on disk since you read it/);
    expect(guard.refusal('notes', 'a.md', null)).toMatch(/^Error: a\.md was deleted since you read it/);
    expect(guard.refusal('work', 'a.md', 8)).toBeNull();
  });
});
