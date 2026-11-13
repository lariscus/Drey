import { describe, expect, it } from 'vitest';
import { parseChainItems } from './chain-list';
import { flowSpeakerOf, shapeSpeakerOf } from './chat-speaker';
import { parsePersonaFile, type Persona } from './persona';

/**
 * req-272: who speaks in the Shape and the Flow chat — picked from the
 * chain, never from a name. The crew here renames Paul to Paula and gives
 * the interactive entry to Ralf in one case.
 */

const persona = (id: string, front: string): Persona => parsePersonaFile(id, `---\n${front}\n---\n`);
const CREW: readonly Persona[] = [
  persona('paula', 'title: Paula\nrole: planner'),
  persona('ben', 'title: Ben\nrole: builder'),
  persona('ralf', 'title: Ralf\nrole: reviewer'),
  persona('quill', 'title: Quill\nrole: custom\ngate: structural'),
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

describe('the flow speaker', () => {
  it("is the persona of the ticket's plan entry — the first ordinary entry whose persona hands over a plan", () => {
    expect(flowSpeakerOf(chain('ralf:shape', 'quill', 'ben'), [], CREW)?.id).toBe('quill');
  });

  it('counts the planner by its settings, not by its role label: a role of custom with a structural gate plans', () => {
    expect(flowSpeakerOf(chain('ben', 'quill'), [], CREW)?.id).toBe('quill');
    expect(flowSpeakerOf(chain('ben', 'ralf'), [], CREW)).toBeNull();
  });

  it('is the shape persona when the chain has no plan entry', () => {
    expect(flowSpeakerOf(chain('ben:shape', 'ralf'), [], CREW)?.id).toBe('ben');
  });

  it('reads the standard flow for a ticket without a chain', () => {
    expect(flowSpeakerOf([], chain('paula:shape', 'paula', 'ben'), CREW)?.id).toBe('paula');
  });

  it('is nobody when neither exists', () => {
    expect(flowSpeakerOf(chain('ben', 'ralf', 'you'), [], CREW)).toBeNull();
    expect(flowSpeakerOf([], [], CREW)).toBeNull();
  });
});
