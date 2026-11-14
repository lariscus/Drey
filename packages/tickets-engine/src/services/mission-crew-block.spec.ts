import { describe, expect, it } from 'vitest';
import { humanPersona, type Persona } from '../core/persona';
import { MissionCrewBlock, missionCrewBlockOf, ownerNameOf } from './mission-crew-block';

function agent(id: string, title: string, summary = ''): Persona {
  return { ...humanPersona(title, id), kind: 'agent', role: 'custom', summary };
}

const PIA: Persona = { ...humanPersona('Pia', 'pia'), kind: 'mission' };
const CREW: readonly Persona[] = [agent('paul', 'Paul', 'plans and shapes'), agent('ben', 'Ben', 'builds'), PIA, humanPersona('Henrik')];

describe('the crew block of a mission turn (req-306)', () => {
  it("names the owner by the human persona's title and maps their words to the persona id", () => {
    const text = missionCrewBlockOf(CREW, null)!;
    expect(text).toContain('## Crew');
    expect(text).toContain('- paul (Paul): plans and shapes');
    expect(text).toContain('- pia (Pia): Mission Control');
    expect(text).toContain('- you (Henrik): the owner, Henrik');
    expect(text).toContain('"Henrik", "me", "I", "my"');
  });

  it("falls back to the git user while the owner has not set a name, and to no name without one", () => {
    const unnamed = [agent('paul', 'Paul'), humanPersona('You')];
    expect(ownerNameOf(unnamed, 'Henrik Puls')).toBe('Henrik Puls');
    expect(ownerNameOf(unnamed, '  ')).toBeNull();
    expect(missionCrewBlockOf(unnamed, null)).toContain('- you (You): the owner');
    expect(missionCrewBlockOf(unnamed, null)).toContain('"me", "I", "my"');
    expect(missionCrewBlockOf(unnamed, 'Henrik Puls')).toContain('- you (Henrik Puls): the owner, Henrik Puls');
  });

  it('lists You even when the board has no human persona file yet; no persona at all = no block', () => {
    expect(missionCrewBlockOf([agent('paul', 'Paul')], null)).toContain('- you (You): the owner');
    expect(missionCrewBlockOf([], null)).toBeNull();
  });

  it('reads the crew on every call and asks for the git user only when the persona holds no name', async () => {
    let asked = 0;
    const named = new MissionCrewBlock(async () => CREW, async () => { asked += 1; return 'git'; });
    expect(await named.text()).toContain('- you (Henrik)');
    expect(asked).toBe(0);
    const bare = new MissionCrewBlock(async () => [humanPersona('You')], async () => { asked += 1; return 'Git Name'; });
    expect(await bare.text()).toContain('- you (Git Name)');
    expect(asked).toBe(1);
    expect(await new MissionCrewBlock(async () => { throw new Error('gone'); }, async () => null).text()).toBeNull();
  });
});
