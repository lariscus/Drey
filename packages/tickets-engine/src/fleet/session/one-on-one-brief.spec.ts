import { describe, expect, it } from 'vitest';
import { composeOneOnOneBrief, type OneOnOneBriefInput } from './one-on-one-brief';

/**
 * The 1:1 brief (req-168) and, since req-315, its `## The owner` section:
 * Mission Control's persona's brief carries the owner's own instructions;
 * no other persona's does, and a board whose owner wrote none carries none.
 */

function input(patch: Partial<OneOnOneBriefInput> = {}): OneOnOneBriefInput {
  return {
    id: 'pia',
    title: 'Pia',
    role: 'Mission Control persona',
    prompt: '# Who Pia is',
    skills: [],
    memory: null,
    runs: [],
    conversation: [],
    tools: [],
    workingDirectory: 'C:/t',
    ...patch,
  };
}

describe('the 1:1 brief\'s owner section (req-315)', () => {
  it('carries the owner\'s instructions after the persona\'s own instructions', () => {
    const brief = composeOneOnOneBrief(input({ owner: { title: 'Henrik', prompt: 'Answer in German.' } }));
    const instructions = brief.indexOf('## Your instructions');
    const owner = brief.indexOf('## The owner');
    expect(owner).toBeGreaterThan(instructions);
    expect(brief).toContain('Henrik is the owner');
    expect(brief).toContain('Answer in German.');
  });

  it('is left out when the caller passed none or the owner wrote nothing', () => {
    expect(composeOneOnOneBrief(input())).not.toContain('## The owner');
    expect(composeOneOnOneBrief(input({ owner: { title: 'Henrik', prompt: '   ' } }))).not.toContain('## The owner');
  });
});
