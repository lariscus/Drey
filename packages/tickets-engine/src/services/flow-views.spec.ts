import { describe, expect, it } from 'vitest';
import { parsePersonaFile } from '../core/persona';
import { flowDraftText, flowPersonasOf } from './flow-views';

/** req-269: Mission Control's persona in the flow pickers and in the crew Paul reads before he drafts a flow. */

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

  it('tells Paul that an entry of hers is a Mission Control turn, not a session', () => {
    const text = flowDraftText({ ticket: 'T-0001', title: 'A', plan: '', standard: ['paul', 'you'], steps: [], saved: ['paul', 'you'], personas: flowPersonasOf([PIA, BEN, YOU]) });
    expect(text).toContain('- pia (Pia, Mission Control: a turn of hers, no session)');
    expect(text).toContain('- ben (Ben)');
    expect(text).toContain('- you (You, the owner)');
  });
});
