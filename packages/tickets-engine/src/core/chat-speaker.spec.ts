import { describe, expect, it } from 'vitest';
import { parseChainItems } from './chain-list';
import { shapeSpeakerOf } from './chat-speaker';
import { parsePersonaFile, type Persona } from './persona';

/**
 * req-272: who speaks in the Shape chat — picked from the
 * chain, never from a name. The crew here renames Paul to Paula and gives
 * the interactive entry to Ralf in one case.
 */

const persona = (id: string, front: string): Persona => parsePersonaFile(id, `---\n${front}\n---\n`);
const CREW: readonly Persona[] = [
  persona('paula', 'title: Paula\nrole: planner'),
  persona('ben', 'title: Ben\nrole: builder'),
  persona('ralf', 'title: Ralf\nrole: reviewer'),
  persona('you', 'title: You\nkind: human'),
  persona('pia', 'title: Pia\nkind: mission'),
];

function chain(...items: string[]) {
  const parsed = parseChainItems(items);
  if (!parsed.ok) {
    throw new Error(parsed.bad);
  }
  return parsed.entries;
}

describe('the shape speaker', () => {
  it("is the persona of the ticket's own interactive entry — a renamed Paul speaks as Paula", () => {
    expect(shapeSpeakerOf(chain('paula:shape', 'paula', 'ben', 'you'), [], CREW)?.title).toBe('Paula');
  });

  it('follows the chain, not the planner role: giving shaping to Ralf changes who speaks', () => {
    expect(shapeSpeakerOf(chain('ralf:shape', 'paula', 'ben'), chain('paula:shape'), CREW)?.id).toBe('ralf');
  });

  it('falls back to the standard flow for a ticket without a chain', () => {
    expect(shapeSpeakerOf([], chain('ben:shape', 'ben', 'ralf'), CREW)?.id).toBe('ben');
  });

  it('falls back to the standard flow when the chain names no interactive entry', () => {
    expect(shapeSpeakerOf(chain('ben', 'ralf'), chain('paula:shape', 'paula'), CREW)?.id).toBe('paula');
  });

  it('is nobody when the entry names a persona the crew no longer has, or one that is no agent', () => {
    expect(shapeSpeakerOf(chain('gone:shape', 'ben'), [], CREW)).toBeNull();
    expect(shapeSpeakerOf(chain('you:shape', 'ben'), [], CREW)).toBeNull();
    expect(shapeSpeakerOf(chain('ben'), [], CREW)).toBeNull();
  });
});
