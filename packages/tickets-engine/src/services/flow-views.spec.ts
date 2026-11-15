import { describe, expect, it } from 'vitest';
import { parsePersonaFile } from '../core/persona/persona';
import { flowPersonasOf } from './flow-views';

/** req-269: Mission Control's persona in the flow pickers. */

const BEN = parsePersonaFile('ben', '---\ntitle: Ben\nrole: builder\nworker: claude-code\nmodels:\n  default: sonnet\n---\n');
const PIA = parsePersonaFile('pia', '---\ntitle: Pia\nkind: mission\nrole: custom\n---\n');
const YOU = parsePersonaFile('you', '---\ntitle: You\nkind: human\n---\n');

describe('flow views with Mission Control\'s persona (req-269)', () => {
  it('lists her with her kind and no model', () => {
    expect(flowPersonasOf([PIA, BEN, YOU]).map((p) => [p.id, p.kind, p.model])).toEqual([
      ['pia', 'mission', ''],
      ['ben', 'agent', 'sonnet'],
      ['you', 'human', ''],
    ]);
  });
});
