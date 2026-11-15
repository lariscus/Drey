import { describe, expect, it, vi } from 'vitest';
import { parsePersonaFile, type Persona } from '../core/persona/persona';
import type { EngineVault } from './host';
import { MemorySkillFileSystem } from './skill-file-system.fake';
import { SkillService, type SkillsBoard } from './skill-service';
import { buildZip } from './skill-zip.fake';

const VAULT: EngineVault = { id: 'v', name: 'tickets', path: '/vault', exists: true, active: true };
const SHARED = 'tickets/_meta/skills';
const SKILL = '---\nname: review\ndescription: Reviews a diff\n---\n\nLook at the diff.\n';

function setup(files: Record<string, string> = {}, options: { vault?: boolean } = {}) {
  const fs = new MemorySkillFileSystem(files);
  const selections = new Map<string, readonly string[]>([['ben', []]]);
  const personaPatch = vi.fn(async (input: { id: string; skills: readonly string[] }) => {
    selections.set(input.id, input.skills);
    return { ok: true as const };
  });
  const board: SkillsBoard = {
    detect: async () => (options.vault === false ? null : VAULT),
    loadPersona: async (_vault, id): Promise<Persona | null> =>
      selections.has(id) ? { ...parsePersonaFile(id, '---\ntitle: Ben\nrole: builder\nworker: claude-code\nmodels:\n  default: opus\n  pool: [opus]\n---\n'), skills: selections.get(id)! } : null,
    listPersonaIds: async () => [...selections.keys()],
    personaPatch,
  };
  const commitTree = vi.fn(async () => undefined);
  const announceChanges = vi.fn();
  const log = vi.fn();
  const service = new SkillService({ board, host: { announceChanges, log }, git: { locate: async () => ({ root: '/vault', prefix: '' }), commitTree }, fsFor: () => fs });
  return { fs, service, personaPatch, commitTree, announceChanges, log, selections };
}

const names = (reply: { ok: boolean; list?: { skills: readonly { name: string }[] } }): string[] => reply.list?.skills.map((s) => s.name) ?? [];

describe('SkillService — listing', () => {
  it('lists the shared pool and a persona\'s skills with the switch; the first call migrates the flat files', async () => {
    const { service, commitTree, fs } = setup({ [`${SHARED}/flat.md`]: '# Flat\n\nbody', [`${SHARED}/review/SKILL.md`]: SKILL });
    const pool = await service.sharedSkills();
    expect(names(pool)).toEqual(['flat', 'review']);
    expect(pool.ok && pool.list.skills.every((s) => !s.legacy && !s.on)).toBe(true);
    expect(await fs.readText(`${SHARED}/flat/SKILL.md`)).toContain('name: flat');
    expect(commitTree).toHaveBeenCalledOnce();
    await service.personaSkills('ben');
    expect(commitTree).toHaveBeenCalledOnce();
  });

  it('answers with a code for a missing vault, an unknown persona, a bad id', async () => {
    expect(await setup({}, { vault: false }).service.personaSkills('ben')).toMatchObject({ ok: false, code: 'no_vault' });
    expect(await setup().service.personaSkills('nobody')).toMatchObject({ ok: false, code: 'no_persona' });
    expect(await setup().service.personaSkills('../x')).toMatchObject({ ok: false, code: 'no_persona' });
  });
});

describe('SkillService — toggle', () => {
  it('switches a skill on and off through one persona patch each, and reports the cost of the selection', async () => {
    const { service, personaPatch } = setup({ [`${SHARED}/review/SKILL.md`]: SKILL });
    const on = await service.personaSkillToggle({ persona: 'ben', skill: 'review', on: true });
    expect(personaPatch).toHaveBeenLastCalledWith({ id: 'ben', skills: ['review'] });
    expect(on.ok && on.list.skills[0]).toMatchObject({ name: 'review', on: true });
    expect(on.ok && on.list.selectedTokens).toBeGreaterThan(0);
    const off = await service.personaSkillToggle({ persona: 'ben', skill: 'review', on: false });
    expect(personaPatch).toHaveBeenLastCalledWith({ id: 'ben', skills: [] });
    expect(off.ok && off.list.skills[0]).toMatchObject({ on: false });
    expect(off.ok && off.list.selectedTokens).toBe(0);
  });

  it('refuses to switch on a skill that does not exist, and a name that is not a folder name', async () => {
    const { service, personaPatch } = setup();
    expect(await service.personaSkillToggle({ persona: 'ben', skill: 'ghost', on: true })).toMatchObject({ ok: false, code: 'no_skill' });
    expect(await service.personaSkillToggle({ persona: 'ben', skill: '../x', on: true })).toMatchObject({ ok: false, code: 'bad_name' });
    expect(personaPatch).not.toHaveBeenCalled();
  });

  it('may switch off a name whose folder is gone (it dangled in the list)', async () => {
    const { service, selections } = setup();
    selections.set('ben', ['ghost']);
    const reply = await service.personaSkillToggle({ persona: 'ben', skill: 'ghost', on: false });
    expect(reply.ok && reply.list.missing).toEqual([]);
  });

  it('turns a failed patch into an internal failure', async () => {
    const { service, personaPatch } = setup({ [`${SHARED}/review/SKILL.md`]: SKILL });
    personaPatch.mockResolvedValueOnce({ ok: false } as never);
    expect(await service.personaSkillToggle({ persona: 'ben', skill: 'review', on: true })).toMatchObject({ ok: false, code: 'internal' });
  });
});

describe('SkillService — upload', () => {
  it('uploads a SKILL.md into the shared pool: one commit of exactly its files, the change round announced', async () => {
    const { service, commitTree, announceChanges } = setup();
    const reply = await service.skillUpload({ scope: 'shared', format: 'markdown', text: SKILL });
    expect(reply).toMatchObject({ ok: true, name: 'review', origin: 'shared', files: 1, replaced: false });
    expect(names(reply as never)).toEqual(['review']);
    expect(commitTree).toHaveBeenCalledWith('/vault', [`${SHARED}/review/SKILL.md`], 'skills: review added in the shared pool');
    expect(announceChanges).toHaveBeenCalledWith('v', [`${SHARED}/review/SKILL.md`], []);
  });

  it('uploads a zipped folder into a persona\'s own home, which then overrides the shared skill', async () => {
    const { service, fs } = setup({ [`${SHARED}/review/SKILL.md`]: SKILL });
    const zip = buildZip([{ name: 'review/SKILL.md', data: SKILL.replace('Look', 'Own look') }, { name: 'review/scripts/run.sh', data: '#!/bin/sh' }]);
    const reply = await service.skillUpload({ scope: 'own', persona: 'ben', format: 'zip', zipBase64: zip.toString('base64') });
    expect(reply).toMatchObject({ ok: true, origin: 'own', files: 2 });
    expect(await fs.readText('tickets/_meta/personas/ben/skills/review/scripts/run.sh')).toBe('#!/bin/sh');
    const listed = reply.ok ? reply.list.skills.find((s) => s.name === 'review') : undefined;
    expect(listed).toMatchObject({ origin: 'own', overridesShared: true, files: 1 });
  });

  it('refuses an overwrite unless asked, then commits the replacement with what went', async () => {
    const { service, commitTree } = setup({ [`${SHARED}/review/SKILL.md`]: SKILL, [`${SHARED}/review/old.txt`]: 'x' });
    expect(await service.skillUpload({ scope: 'shared', format: 'markdown', text: SKILL })).toMatchObject({ ok: false, code: 'exists' });
    expect(commitTree).not.toHaveBeenCalled();
    expect(await service.skillUpload({ scope: 'shared', format: 'markdown', text: SKILL, overwrite: true })).toMatchObject({ ok: true, replaced: true });
    expect(commitTree).toHaveBeenCalledWith('/vault', [`${SHARED}/review/SKILL.md`, `${SHARED}/review/old.txt`], 'skills: review replaced in the shared pool');
  });

  it('refuses a bad scope, an own upload without a persona, and an unknown persona', async () => {
    const { service } = setup();
    expect(await service.skillUpload({ scope: 'all' as never, format: 'markdown', text: SKILL })).toMatchObject({ ok: false, code: 'bad_scope' });
    expect(await service.skillUpload({ scope: 'own', format: 'markdown', text: SKILL })).toMatchObject({ ok: false, code: 'no_persona' });
    expect(await service.skillUpload({ scope: 'own', persona: 'nobody', format: 'markdown', text: SKILL })).toMatchObject({ ok: false, code: 'no_persona' });
  });

  it('serializes uploads: two at once both land', async () => {
    const { service, fs } = setup();
    const other = SKILL.replaceAll('review', 'other');
    await Promise.all([service.skillUpload({ scope: 'shared', format: 'markdown', text: SKILL }), service.skillUpload({ scope: 'shared', format: 'markdown', text: other })]);
    expect([...fs.store.keys()].sort()).toEqual([`${SHARED}/other/SKILL.md`, `${SHARED}/review/SKILL.md`]);
  });
});

describe('SkillService — delete an own skill', () => {
  const own = 'tickets/_meta/personas/ben/skills';

  it('removes the folder with its files in one commit that records the removals', async () => {
    const { service, fs, commitTree, announceChanges } = setup({ [`${own}/mine/SKILL.md`]: SKILL, [`${own}/mine/scripts/run.sh`]: 'x', [`${SHARED}/other/SKILL.md`]: SKILL });
    const reply = await service.personaSkillRemove({ persona: 'ben', name: 'mine' });
    expect(names(reply as never)).toEqual(['other']);
    expect([...fs.store.keys()]).toEqual([`${SHARED}/other/SKILL.md`]);
    expect(commitTree).toHaveBeenCalledWith('/vault', [`${own}/mine/SKILL.md`, `${own}/mine/scripts/run.sh`], 'skills: ben own skill mine removed');
    expect(announceChanges).toHaveBeenCalledWith('v', [], [`${own}/mine/SKILL.md`, `${own}/mine/scripts/run.sh`]);
  });

  it('never deletes a shared skill from here; an unknown one is not found', async () => {
    const { service, fs } = setup({ [`${SHARED}/review/SKILL.md`]: SKILL });
    expect(await service.personaSkillRemove({ persona: 'ben', name: 'review' })).toMatchObject({ ok: false, code: 'not_own' });
    expect(await service.personaSkillRemove({ persona: 'ben', name: 'ghost' })).toMatchObject({ ok: false, code: 'no_skill' });
    expect(await service.personaSkillRemove({ persona: 'ben', name: '../x' })).toMatchObject({ ok: false, code: 'bad_name' });
    expect(fs.store.size).toBe(1);
  });
});

describe('SkillService — prompt preview', () => {
  it('returns the brief, its count and the per-skill counts; step defaults to build', async () => {
    const { service, selections } = setup({ [`${SHARED}/review/SKILL.md`]: SKILL });
    selections.set('ben', ['review']);
    const reply = await service.personaPromptPreview({ persona: 'ben' });
    expect(reply).toMatchObject({ ok: true, persona: 'ben', step: 'build', tokenizer: { id: 'claude-estimate', exact: false } });
    expect(reply.ok && reply.text).toContain('### review\n\nLook at the diff.');
    expect(reply.ok && reply.skills.map((s) => s.name)).toEqual(['review']);
    expect(reply.ok && reply.tokens).toBeGreaterThan(0);
  });

  it('refuses a step that is not a phase id and an unknown persona', async () => {
    const { service } = setup();
    expect(await service.personaPromptPreview({ persona: 'ben', step: '../x' })).toMatchObject({ ok: false, code: 'bad_name' });
    expect(await service.personaPromptPreview({ persona: 'nobody' })).toMatchObject({ ok: false, code: 'no_persona' });
  });

  it('logs a selected skill without text and goes on', async () => {
    const { service, selections, log } = setup();
    selections.set('ben', ['ghost']);
    expect(await service.personaPromptPreview({ persona: 'ben' })).toMatchObject({ ok: true });
    expect(log).toHaveBeenCalledWith('persona ben: no text for skill ghost', 'warn');
  });
});
