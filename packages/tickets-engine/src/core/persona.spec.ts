import { describe, expect, it } from 'vitest';
import { EMPTY_PERSONA_SETTINGS } from './persona-settings';
import { entryWorkOf } from './chain-entry-work';
import { inPipelineOrder, isAgentPersona, isHumanPersona, isMissionPersona, MISSION_PERSONA_ID, parsePersonaFile, personaFileText, personaMigrationFor, personaRef, resolvePersona, splitPoolEntry } from './persona';

const PIA = `---
title: Pia
role: planner
worker: claude-code
models:
  default: opus
  pool: [opus, sonnet, glm-5.2]
  router: off
color: '#a78bfa'
skills: [repo-recherche, fragen-formulieren]
---
Pia plant. Ton: knapp, fragt lieber einmal mehr.
`;

describe('inPipelineOrder (fidelity ruling O12)', () => {
  it('reads plan to test whatever the ids sort to, custom roles after, the human last', () => {
    const list = [
      { id: 'ben', role: 'builder', kind: 'agent' },
      { id: 'you', role: 'custom', kind: 'human' },
      { id: 'tessa', role: 'tester', kind: 'agent' },
      { id: 'zed', role: 'custom', kind: 'agent' },
      { id: 'anna', role: 'custom', kind: 'agent' },
      { id: 'paul', role: 'planner', kind: 'agent' },
      { id: 'ralf', role: 'reviewer', kind: 'agent' },
    ] as const;
    expect(inPipelineOrder(list).map((persona) => persona.id)).toEqual(['paul', 'ben', 'ralf', 'tessa', 'anna', 'zed', 'you']);
  });

  it('req-269: puts Mission Control\'s persona first', () => {
    const list = [
      { id: 'ben', role: 'builder', kind: 'agent' },
      { id: 'you', role: 'custom', kind: 'human' },
      { id: 'pia', role: 'custom', kind: 'mission' },
    ] as const;
    expect(inPipelineOrder(list).map((persona) => persona.id)).toEqual(['pia', 'ben', 'you']);
  });
});

describe('kind: mission — Mission Control\'s persona (req-269)', () => {
  const PIA = "---\ntitle: Pia\nkind: mission\nrole: custom\nsummary: \"Mission Control.\"\ncolor: '#d9cff5'\nskills: []\n---\n";

  it('reads kind mission, and the three kind tests say which persona is what', () => {
    const pia = parsePersonaFile('pia', PIA);
    expect(pia.kind).toBe('mission');
    expect([isMissionPersona(pia), isAgentPersona(pia), isHumanPersona(pia)]).toEqual([true, false, false]);
    expect(isAgentPersona(parsePersonaFile('ben', '---\ntitle: Ben\n---\n'))).toBe(true);
    expect(parsePersonaFile('x', '---\ntitle: X\nkind: robot\n---\n').kind).toBe('agent');
    expect(MISSION_PERSONA_ID).toBe('pia');
  });

  it('writes kind mission and no worker or models, and reads back what it wrote', () => {
    const text = personaFileText(parsePersonaFile('pia', PIA));
    expect(text).toBe(PIA);
    expect(parsePersonaFile('pia', text)).toMatchObject({ kind: 'mission', title: 'Pia', summary: 'Mission Control.' });
  });
});

describe('entryWorkOf — what happens at a chain entry (req-269)', () => {
  it('a run for an agent, a Mission Control turn for the mission persona, the owner for the human, missing for none', () => {
    expect(entryWorkOf({ kind: 'agent' })).toBe('run');
    expect(entryWorkOf({ kind: 'mission' })).toBe('mission-turn');
    expect(entryWorkOf({ kind: 'human' })).toBe('owner');
    expect(entryWorkOf(null)).toBe('missing');
    expect(entryWorkOf(undefined)).toBe('missing');
  });
});

describe('parsePersonaFile', () => {
  it('reads the frontmatter with the concept defaults', () => {
    expect(parsePersonaFile('pia', PIA)).toEqual({
      id: 'pia',
      kind: 'agent',
      title: 'Pia',
      role: 'planner',
      worker: 'claude-code',
      models: { default: 'opus', pool: ['opus', 'sonnet', 'glm-5.2'] },
      color: '#a78bfa',
      summary: '',
      skills: ['repo-recherche', 'fragen-formulieren'],
      budget: null,
      allowed: { spendAboveAllowance: false },
      settings: EMPTY_PERSONA_SETTINGS,
    });
  });

  it('tolerates a sparse file and degrades unknown values', () => {
    const persona = parsePersonaFile('ben', `---\nrole: wizard\nmodels:\n  router: chaos\n---\n`);
    expect(persona.role).toBe('custom');
    expect(persona.worker).toBe('opencode');
    expect(persona.models.default).toBe('opus');
    expect(persona.models.pool).toEqual(['opus']);
    expect(persona.models).not.toHaveProperty('router'); // req-170: an old router: key is ignored
    expect(persona.budget).toBeNull();
    expect(persona.allowed).toEqual({ spendAboveAllowance: false });
  });

  it('rejects malformed ids', () => {
    expect(() => personaRef('Bad Id!')).toThrow('persona id');
  });

  it('round-trips through personaFileText', () => {
    const persona = parsePersonaFile('pia', PIA);
    expect(parsePersonaFile('pia', personaFileText(persona))).toEqual(persona);
  });

  it("personaFileText keeps the owner's prose below the fence when the patch passes it (U4)", () => {
    const persona = parsePersonaFile('pia', PIA);
    const withBody = personaFileText(persona, 'Pia plans carefully; no dependency bumps without asking.');
    expect(withBody).toContain('Pia plans carefully; no dependency bumps without asking.');
    expect(withBody).not.toContain(`Who ${persona.title} is: role, tone, limits`);
    // the frontmatter round-trips byte-for-byte above the prose
    expect(withBody.split('---\n')[1]).toBe(personaFileText(persona).split('---\n')[1]);
    expect(parsePersonaFile('pia', withBody)).toEqual(persona);
    // R11, req-171: a fresh file is the frontmatter alone - the prose lives in prompt.md
    expect(personaFileText(persona).endsWith('---\n')).toBe(true);
    expect(personaFileText(persona)).not.toContain('Who ');
  });

  it('reads and writes the one line for the crew list, quoted so a colon cannot break the fence (req-144)', () => {
    const persona = { ...parsePersonaFile('pia', PIA), summary: 'Plans: one part at a time, "test first".' };
    const text = personaFileText(persona);
    expect(text).toContain('summary: "Plans: one part at a time, \\"test first\\"."');
    expect(parsePersonaFile('pia', text).summary).toBe('Plans: one part at a time, "test first".');
    expect(personaFileText({ ...persona, summary: '  ' })).not.toContain('summary');
    expect(parsePersonaFile('pia', PIA).summary).toBe('');
  });

  it('round-trips run-commands and network in allowed (req-171)', () => {
    const open = { ...parsePersonaFile('ben', PIA), allowed: { spendAboveAllowance: false, runCommands: 'bypass' as const, network: true } };
    expect(personaFileText(open)).toContain('allowed:\n  run-commands: bypass\n  network: true');
    expect(parsePersonaFile('ben', personaFileText(open))).toEqual(open);
    const odd = parsePersonaFile('ben', PIA.replace('fragen-formulieren]\n---', 'fragen-formulieren]\nallowed:\n  run-commands: root\n  network: maybe\n---'));
    expect(odd.allowed).toEqual({ spendAboveAllowance: false });
  });
});

describe('budget — the daily spend limit (concept §4.3)', () => {
  it('reads the USD-per-day number', () => {
    const persona = parsePersonaFile('pia', `---\ntitle: Pia\nbudget: 25\n---\n`);
    expect(persona.budget).toBe(25);
  });

  it('tolerates a numeric string and rejects junk, fractions allowed', () => {
    expect(parsePersonaFile('pia', `---\nbudget: '12.5'\n---\n`).budget).toBe(12.5);
    expect(parsePersonaFile('pia', `---\nbudget: much\n---\n`).budget).toBeNull();
    expect(parsePersonaFile('pia', `---\nbudget: -3\n---\n`).budget).toBeNull();
    expect(parsePersonaFile('pia', `---\n---\n`).budget).toBeNull();
  });

  it('round-trips a set budget through personaFileText and omits a null one', () => {
    const rich = parsePersonaFile('pia', `---\ntitle: Pia\nbudget: 25\n---\n`);
    expect(personaFileText(rich)).toContain('budget: 25');
    expect(parsePersonaFile('pia', personaFileText(rich))).toEqual(rich);
    const poor = parsePersonaFile('pia', `---\ntitle: Pia\n---\n`);
    expect(personaFileText(poor)).not.toContain('budget');
    expect(parsePersonaFile('pia', personaFileText(poor))).toEqual(poor);
  });
});

describe('resolvePersona', () => {
  it('runs the three-level ladder: ticket > phase > default', () => {
    expect(resolvePersona({ ticketPersona: 'tessa', phasePersona: 'pia', defaultPersona: 'ben' })).toEqual({
      persona: 'tessa',
      source: 'ticket',
    });
    expect(resolvePersona({ ticketPersona: null, phasePersona: 'pia', defaultPersona: 'ben' })).toEqual({
      persona: 'pia',
      source: 'phase',
    });
    expect(resolvePersona({ ticketPersona: '', phasePersona: null, defaultPersona: 'ben' })).toEqual({
      persona: 'ben',
      source: 'default',
    });
    expect(resolvePersona({ ticketPersona: null, phasePersona: null, defaultPersona: null })).toEqual({
      persona: null,
      source: 'none',
    });
  });
});

describe('allowed: and the pool entries (req-170)', () => {
  it('reads and writes allowed: spend-above-allowance; a file without it stays without it', () => {
    const generous = parsePersonaFile('ben', `---\ntitle: Ben\nallowed:\n  spend-above-allowance: true\n---\n`);
    expect(generous.allowed).toEqual({ spendAboveAllowance: true });
    expect(personaFileText(generous)).toContain('allowed:\n  spend-above-allowance: true');
    expect(parsePersonaFile('ben', personaFileText(generous))).toEqual(generous);
    expect(personaFileText(parsePersonaFile('pia', PIA))).not.toContain('allowed:');
  });

  it('reads and writes allowed: write-vaults (req-167, R5); one id reads as a list, duplicates drop', () => {
    const writer = parsePersonaFile('ben', `---\ntitle: Ben\nallowed:\n  write-vaults: [work, notes, work]\n---\n`);
    expect(writer.allowed).toEqual({ spendAboveAllowance: false, writeVaults: ['work', 'notes'] });
    expect(personaFileText(writer)).toContain('allowed:\n  write-vaults: [work, notes]');
    expect(parsePersonaFile('ben', personaFileText(writer))).toEqual(writer);
    expect(parsePersonaFile('ben', `---\nallowed:\n  write-vaults: work\n---\n`).allowed.writeVaults).toEqual(['work']);
    expect(parsePersonaFile('ben', `---\nallowed:\n  write-vaults: []\n---\n`).allowed.writeVaults).toBeUndefined();
  });

  it('a pool entry is <model> or <provider>/<model>; a slash after anything else is part of the id', () => {
    expect(splitPoolEntry('kimi/k2')).toEqual({ provider: 'kimi', model: 'k2' });
    expect(splitPoolEntry('zai/glm-5.3')).toEqual({ provider: null, model: 'zai/glm-5.3' });
    expect(splitPoolEntry(' opus ')).toEqual({ provider: null, model: 'opus' });
  });
});

describe('personaMigrationFor', () => {
  it('builds a persona candidate from legacy column keys', () => {
    expect(personaMigrationFor({ phaseId: 'build', worker: 'claude-code', model: 'sonnet', prompt: 'build-default' })).toEqual({
      id: 'build-default',
      title: 'build default',
      worker: 'claude-code',
      model: 'sonnet',
      promptRef: 'build-default',
    });
  });

  it('slugifies odd prompt refs and falls back to the phase id', () => {
    expect(personaMigrationFor({ phaseId: 'qa', worker: null, model: 'glm', prompt: 'QA — Default!!' })!.id).toBe('qa-default');
    expect(personaMigrationFor({ phaseId: 'qa', worker: null, model: null, prompt: null })).toBeNull();
  });
});
