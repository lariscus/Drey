import { describe, expect, it } from 'vitest';
import { parsePersonaFile } from '../core/persona/persona';
import { crewRosterOf } from './crew-roster';

const persona = (id: string, front: string) => parsePersonaFile(id, `---\n${front}\n---\n`);

describe('the shape roster (req-272)', () => {
  it("lists the agents in the given order with their own one-liner, else their role", () => {
    const roster = crewRosterOf([
      persona('ralf', 'title: Ralf\nrole: reviewer\nsummary: Reviews the diff against the plan.'),
      persona('pia', 'title: Pia\nkind: mission'),
      persona('ben', 'title: Ben\nrole: builder'),
      persona('you', 'title: You\nkind: human'),
    ]);
    expect(roster).toBe('- ralf (Ralf): Reviews the diff against the plan.\n- ben (Ben): builder');
  });

  it('is empty for an empty crew', () => {
    expect(crewRosterOf([])).toBe('');
  });
});
