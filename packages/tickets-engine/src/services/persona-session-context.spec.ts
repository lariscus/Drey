import { describe, expect, it } from 'vitest';
import { humanPersona, type Persona } from '../core/persona/persona';
import { ONE_ON_ONE_VAULT_TOOLS, type OneOnOneSeat, type OneOnOneToolSeam } from '../fleet/session/one-on-one-toolset';
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

describe('PersonaSessionContext owner section (req-315)', () => {
  const you = humanPersona('Henrik');
  const hostWithPrompt = {
    read: async (_v: string, p: string) => (p === 'tickets/_meta/personas/you/prompt.md' ? 'Answer in German.' : null),
  } as unknown as EngineHost;
  const mission = { id: 'pia', title: 'Pia', kind: 'mission', role: 'custom', skills: [] } as unknown as Persona;
  const ben = { id: 'ben', title: 'Ben', role: 'builder', skills: [] } as unknown as Persona;

  function contextWith(personas: () => Promise<readonly Persona[]>, host: EngineHost = hostWithPrompt): PersonaSessionContext {
    return new PersonaSessionContext({ host, runs: async () => [], personas });
  }

  it('the mission persona\'s brief carries the owner\'s instructions; an agent\'s does not', async () => {
    const brief = await contextWith(async () => [mission, you]).brief(VAULT, mission, []);
    expect(brief).toContain('## The owner');
    expect(brief).toContain('Henrik is the owner');
    expect(brief).toContain('Answer in German.');
    const agents = await contextWith(async () => [ben, you]).brief(VAULT, ben, []);
    expect(agents).not.toContain('## The owner');
  });

  it('is absent when the board cannot list the crew or the owner wrote nothing', async () => {
    expect(await contextWith(async () => [mission, you], host).brief(VAULT, mission, [])).not.toContain('## The owner');
    const empty = new PersonaSessionContext({ host: hostWithPrompt, runs: async () => [], personas: async () => [mission] });
    expect(await empty.brief(VAULT, mission, [])).not.toContain('## The owner');
  });
});
