import { describe, expect, it } from 'vitest';
import { crewSettingsBlockOf, crewSettingsLineOf } from './mission-crew-settings';
import { humanPersona, parsePersonaFile, PERSONAS_DIR } from '../core/persona/persona';

/**
 * The `## Crew settings` block (req-315): per persona one line of the
 * fields a patchPersona card may set, as they stand — never the prompt
 * texts (the owner's ruling: Pia reads one when she needs it).
 */

const BEN = parsePersonaFile('ben', [
  '---',
  'title: Ben',
  'role: builder',
  'class: standard',
  "model: \"kimi/k2\"",
  "summary: \"Builds what the plan says\"",
  "color: '#aabbcc'",
  'skills: [review]',
  'budget: 5',
  'parallel: 2',
  'leaving: [commit]',
  'allowed:',
  '  network: true',
  '---',
  '',
].join('\n'));

describe('crewSettingsLineOf', () => {
  it('an agent line carries the fields a patch may set, with their values', () => {
    const line = crewSettingsLineOf(BEN);
    expect(line).toContain('- ben (Ben) — agent, role builder');
    expect(line).toContain('class: standard');
    expect(line).toContain('model: kimi/k2');
    expect(line).toContain('budget: $5');
    expect(line).toContain('max in parallel: 2');
    expect(line).toContain('read-only: off');
    expect(line).toContain('leaving: commit');
    expect(line).toContain('skills: review');
    expect(line).toContain('network on');
    expect(line).toContain('summary: Builds what the plan says');
    // The prompt text is deliberately absent.
    expect(line).not.toContain('## Who');
  });

  it('the owner line names their short field set and marks the rest inert', () => {
    const line = crewSettingsLineOf(humanPersona('Henrik'));
    expect(line).toContain('- you (Henrik) — the owner, human');
    expect(line).toContain('leaving: commit');
    expect(line).toContain('inert');
  });

  it('the mission line names her chat model and skills, and nothing run-related', () => {
    const pia = parsePersonaFile('pia', [
      '---',
      'title: Pia',
      'kind: mission',
      'role: custom',
      'model: "glm-5"',
      '---',
      '',
    ].join('\n'));
    const line = crewSettingsLineOf(pia);
    expect(line).toContain('- pia (Pia) — Mission Control, kind mission');
    expect(line).toContain('chat model: glm-5');
    expect(line).toContain('inert');
  });
});

describe('crewSettingsBlockOf', () => {
  it('the block carries the rules and one line per persona', () => {
    const block = crewSettingsBlockOf([BEN, humanPersona('You')]);
    expect(block).toContain('## Crew settings');
    expect(block).toContain('patchPersona');
    expect(block).toContain('persona_read first');
    expect(block).toContain('- ben (Ben)');
    expect(block).toContain('- you (You)');
  });

  it('is null on a board without personas', () => {
    expect(crewSettingsBlockOf([])).toBeNull();
  });

  it('documents the persona folder the paths name', () => {
    // The block talks paths only through mission.md; this pins the folder the pattern shares.
    expect(PERSONAS_DIR).toBe('tickets/_meta/personas');
  });
});
