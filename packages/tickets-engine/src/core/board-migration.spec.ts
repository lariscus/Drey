import { describe, expect, it } from 'vitest';
import { builderOf, crewMigrationOf, defaultsMigrationOf, flowOrderOf, pipelineMigrationOf } from './board-migration';
import { parsePersonaFile, type Persona } from './persona';
import { LIFECYCLE_PIPELINE_PROSE, PIPELINE_PROSE, STANDARD_FLOW_LINE } from './pipeline-states';
import { parsePipeline } from './ticket-board';

const persona = (id: string, extra = '', kind = 'agent'): Persona => parsePersonaFile(id, `---\ntitle: ${id === 'you' ? 'You' : id}\nkind: ${kind}\nrole: custom\nworker: opencode\n${extra}---\n`);

const CREW = [persona('pia', '', 'mission'), persona('paul'), persona('ben'), persona('ralf'), persona('tessa'), persona('you', '', 'human'), persona('build-default'), persona('commit-default')];

/** The pipeline "Initialize board" wrote before req-307 (the shipped phase board). */
const SHIPPED_PHASE_PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual, persona: you }
  - { id: shaping, title: Shaping, handover: manual, persona: you }
  - { id: prioritized, title: Prioritized, handover: manual, persona: you }
  - { id: building, title: Building, wip: 3, claim: true, handover: agent build-default }
  - { id: ready, title: Ready to try, handover: manual, persona: you }
  - { id: done, title: Done, handover: none }
flow: ${STANDARD_FLOW_LINE}
---
${PIPELINE_PROSE}`;

/** The owner's live pipeline as concept §0 read it (2026-11-11): Building names build-default twice. */
const LIVE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual, persona: you }
  - { id: shaping, title: Shaping, handover: manual, persona: you }
  - { id: prioritized, title: Prioritized, handover: manual, persona: you }
  - { id: building, title: Building, wip: 3, claim: true, handover: agent build-default, persona: build-default, token-budget: 40000000, min-class: B, max-turns: 80, audit: on }
  - { id: ready, title: Ready to try, handover: manual, persona: you }
  - { id: done, title: Done, handover: none }
---
The owner's own words stay.
`;

describe('step 3: the pipeline keeps the lifecycle columns', () => {
  it('drops the working and checkpoint columns, writes the standard flow, keeps the token budget and moves the run keys to the builder', () => {
    const out = pipelineMigrationOf(LIVE, CREW)!;
    expect(out.plan).toEqual({
      step: 'pipeline',
      removed: ['Shaping', 'Building', 'Ready to try'],
      flow: STANDARD_FLOW_LINE,
      moved: { persona: 'ben', keys: ['min-class', 'max-turns'] },
      tokenBudget: 40000000,
      dropped: ['audit: on'],
    });
    expect(out.patch).toEqual({ maxTurns: 80 });
    expect(out.floor).toBe('standard'); // req-288: the column's floor raises the builder's class
    const parsed = parsePipeline(out.text);
    expect(parsed.phases.map((p) => [p.id, p.persona])).toEqual([['inbox', null], ['prioritized', null], ['done', null]]);
    expect(parsed.flow?.map((e) => e.persona)).toEqual(['paul', 'ben', 'ralf', 'tessa', 'you']);
    expect(out.text).toContain('token-budget: 40000000');
    expect(out.text).not.toContain('build-default');
    expect(out.text.endsWith("---\nThe owner's own words stay.\n")).toBe(true);
  });

  it("replaces only the shipped phase-board prose, and leaves a builder's own setting alone", () => {
    const out = pipelineMigrationOf(SHIPPED_PHASE_PIPELINE, [persona('ben', 'class: heavy\n'), persona('paul')])!;
    expect(out.text.endsWith(`---\n${LIFECYCLE_PIPELINE_PROSE}`)).toBe(true);
    expect(out.plan.flow).toBeNull(); // the shipped pipeline has a flow already
    expect(out.plan.moved).toBeNull();
  });

  it('offers nothing once only the lifecycle columns and a flow are left', () => {
    const out = pipelineMigrationOf(LIVE, CREW)!;
    expect(pipelineMigrationOf(out.text, CREW)).toBeNull();
  });
});

describe('step 4: the crew order and the leaving actions', () => {
  it('writes Mission Control first and You last, without the legacy defaults, and adds sync-main and commit', () => {
    expect(crewMigrationOf('---\nseeded-crew: [paul, ben, ralf, tessa]\n---\n', CREW, 'ben', flowOrderOf(STANDARD_FLOW_LINE))).toEqual({
      step: 'crew',
      order: ['pia', 'paul', 'ben', 'ralf', 'tessa', 'you'],
      leaving: [
        { persona: 'ben', action: 'sync-main' },
        { persona: 'you', action: 'commit' },
      ],
    });
  });

  it('keeps an order the file has, and offers nothing when all is in place', () => {
    const done = [persona('ben', 'leaving: [sync-main]\n'), persona('you', 'leaving: [commit]\n', 'human')];
    expect(crewMigrationOf('---\norder: [ben, you]\n---\n', done, 'ben')).toBeNull();
    expect(crewMigrationOf('---\norder: [ben, you]\n---\n', CREW, 'ben')?.order).toBeNull();
  });
});

describe('step 5: the legacy default personas', () => {
  it('lists the ones left and says whose prompt differs from the builder’s', () => {
    const prompts = new Map([['ben', 'Build it.\n'], ['build-default', 'Build it, carefully.'], ['commit-default', '']]);
    expect(defaultsMigrationOf(CREW, prompts, 'ben')).toEqual({
      step: 'defaults',
      personas: [
        { id: 'build-default', title: 'build-default', promptDiffers: true },
        { id: 'commit-default', title: 'commit-default', promptDiffers: false },
      ],
      comparedWith: 'ben',
    });
    expect(defaultsMigrationOf([persona('ben')], prompts, 'ben')).toBeNull();
  });
});

describe('the builder of a flow', () => {
  it('is the first persona after the shape persona’s entries, when the crew has it as an agent', () => {
    expect(builderOf(STANDARD_FLOW_LINE, CREW)).toBe('ben');
    expect(builderOf('plan:shape; plan; build; you', [persona('build')])).toBe('build');
    expect(builderOf(STANDARD_FLOW_LINE, [persona('paul')])).toBeNull();
  });
});
