import { describe, expect, it } from 'vitest';
import { MissionOwnerBlock, ownerBlockOf } from './mission-owner-block';
import { humanPersona, parsePersonaFile } from '../core/persona/persona';
import type { EngineHost, EngineVault } from './host';

/**
 * `## The owner` (req-315): the human persona's `prompt.md` — found by
 * `kind: human`, never by name; read fresh; absent when it is empty,
 * missing, or the board has no owner persona.
 */

const VAULT: EngineVault = { id: 'vault', name: 'v', path: 'C:/v', exists: true, active: true };

function boardOf(personas: ReturnType<typeof parsePersonaFile>[]) {
  return {
    detect: async () => VAULT,
    listPersonas: async () => personas,
  };
}

function hostOf(files: Record<string, string>): Pick<EngineHost, 'read'> {
  return {
    read: async (_vault: string, p: string) => {
      const hit = files[p];
      if (hit === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return hit;
    },
  };
}

const YOU = humanPersona('Henrik');
const PAUL = parsePersonaFile('paul', '---\ntitle: Paul\nrole: planner\n---\n');

describe('MissionOwnerBlock', () => {
  it('carries the owner prompt under their own title', async () => {
    const block = new MissionOwnerBlock(boardOf([PAUL, YOU]), hostOf({ 'tickets/_meta/personas/you/prompt.md': 'Answer briefly.\n' }));
    await expect(block.text()).resolves.toBe('## The owner\n\nHenrik is the owner — this is their persona\'s own instructions for how you deal with them; honor it in every answer:\n\nAnswer briefly.');
  });

  it('finds the owner persona by kind, not by title', async () => {
    const renamed = { ...humanPersona('Henrik') } as ReturnType<typeof humanPersona>;
    const block = new MissionOwnerBlock(boardOf([PAUL, renamed]), hostOf({ 'tickets/_meta/personas/you/prompt.md': 'Short answers.' }));
    await expect(block.text()).resolves.toContain('Short answers.');
  });

  it('is null when the owner wrote no instructions, the file is missing or the board has no owner', async () => {
    expect(await new MissionOwnerBlock(boardOf([PAUL, YOU]), hostOf({})).text()).toBeNull();
    expect(await new MissionOwnerBlock(boardOf([PAUL, YOU]), hostOf({ 'tickets/_meta/personas/you/prompt.md': '   \n' })).text()).toBeNull();
    expect(await new MissionOwnerBlock(boardOf([PAUL]), hostOf({})).text()).toBeNull();
  });

  it('is null without a tickets repository', async () => {
    const board = { detect: async () => null, listPersonas: async () => [YOU] };
    expect(await new MissionOwnerBlock(board, hostOf({ 'tickets/_meta/personas/you/prompt.md': 'x' })).text()).toBeNull();
  });

  it('folds CRLF before it composes', async () => {
    const block = new MissionOwnerBlock(boardOf([YOU]), hostOf({ 'tickets/_meta/personas/you/prompt.md': 'a\r\nb\r\n' }));
    await expect(block.text()).resolves.toContain('a\nb');
  });

  it('ownerBlockOf keeps the shape one place knows', () => {
    expect(ownerBlockOf('You', 'Be brief.').split('\n')[0]).toBe('## The owner');
  });
});
