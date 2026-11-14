import { describe, expect, it } from 'vitest';
import type { Persona } from '../core/persona';
import { ONE_ON_ONE_VAULT_TOOLS, type OneOnOneSeat, type OneOnOneToolSeam } from '../fleet/one-on-one-toolset';
import type { EngineHost, EngineVault } from './host';
import { PersonaSessionContext } from './persona-session-context';

/**
 * req-217: the brief of a 1:1 names the tools the seam says are attached to
 * this persona's harness — and none for an `api` persona (the chat bridge
 * carries no tools) or when no seam is wired.
 */
const VAULT: EngineVault = { id: 'tickets', path: 'T:/tickets' } as EngineVault;
const persona = (worker: string): Persona => ({ id: 'ben', title: 'Ben', role: 'builder', worker, skills: [], models: { default: '', pool: [] } }) as unknown as Persona;
const host = { read: async () => null } as unknown as EngineHost;

function context(tools?: OneOnOneToolSeam): PersonaSessionContext {
  return new PersonaSessionContext({ host, runs: async () => [], ...(tools === undefined ? {} : { tools }) });
}

describe('PersonaSessionContext tools (req-217)', () => {
  it('asks the seam with the persona and its harness and names exactly the answer', async () => {
    const asked: OneOnOneSeat[] = [];
    const seam: OneOnOneToolSeam = {
      attached: (seat) => {
        asked.push(seat);
        return ONE_ON_ONE_VAULT_TOOLS;
      },
    };
    const brief = await context(seam).brief(VAULT, persona('claude-code'), [], 'claude-code');
    expect(asked).toEqual([{ persona: 'ben', provider: 'claude-code' }]);
    expect(brief).toContain("## Tools\n\nRead the owner's notes (the vault) with: vault_list, vault_search, vault_read. They only read.");
  });

  it('a session with no harness known is asked about with none, so the brief names no tool', async () => {
    const asked: OneOnOneSeat[] = [];
    const seam: OneOnOneToolSeam = { attached: (seat) => (asked.push(seat), seat.provider === null ? [] : ONE_ON_ONE_VAULT_TOOLS) };
    const brief = await context(seam).brief(VAULT, persona('api'), []);
    expect(asked).toEqual([{ persona: 'ben', provider: null }]);
    expect(brief).not.toContain('## Tools');
  });

  it('names no tool without a seam', async () => {
    expect(await context().brief(VAULT, persona('opencode'), [])).not.toContain('## Tools');
  });
});
