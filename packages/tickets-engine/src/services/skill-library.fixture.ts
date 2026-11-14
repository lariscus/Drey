import { vi } from 'vitest';
import { parsePersonaFile, type Persona } from '../core/persona';
import { FakeGithub } from './github-client.fake';
import type { EngineVault } from './host';
import { MemorySkillFileSystem } from './skill-file-system.fake';
import { SkillLibraryService } from './skill-library-service';
import { SkillService, type SkillsBoard } from './skill-service';
import { SkillSourceFetcher } from './skill-source-fetcher';
import { SkillUpdateChecks } from './skill-update-checks';
import { SkillWriteQueue } from './skill-write-queue';

/** The library's specs share one world: a memory vault, personas, a fake GitHub with the acme repository at two tags and a branch. */

export const VAULT: EngineVault = { id: 'v', name: 'tickets', path: '/vault', exists: true, active: true };
export const SHARED = 'tickets/_meta/skills';
export const SOURCES = 'tickets/_meta/skill-sources.md';
export const C14 = '1'.repeat(40);
export const C15 = '2'.repeat(40);
export const MAIN = '3'.repeat(40);

export const skillText = (name: string, body = `Do ${name}.`): string => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;

export function acmeRepo(): Parameters<FakeGithub['set']>[1] {
  return {
    refs: { 'v1.4': C14, 'v1.5': C15, main: MAIN },
    tags: ['v1.3', 'v1.4', 'v1.5'],
    commits: {
      [C14]: { 'README.md': '# acme', 'playwright-e2e/SKILL.md': skillText('playwright-e2e'), 'playwright-e2e/scripts/run.sh': 'npx playwright test', 'angular-standalone/SKILL.md': skillText('angular-standalone'), 'old-one/SKILL.md': skillText('old-one') },
      [C15]: { 'playwright-e2e/SKILL.md': skillText('playwright-e2e', 'Do it better.'), 'angular-standalone/SKILL.md': skillText('angular-standalone'), 'new-one/SKILL.md': skillText('new-one'), 'broken/SKILL.md': 'no frontmatter' },
      [MAIN]: { 'skills/e2e/SKILL.md': skillText('e2e') },
    },
  };
}

const PERSONA = (title: string): string => `---\ntitle: ${title}\nrole: builder\nworker: claude-code\nmodels:\n  default: opus\n  pool: [opus]\n---\n`;

export function libraryWorld(files: Record<string, string> = {}, selections: Record<string, readonly string[]> = { ben: [], ralf: [] }) {
  const fs = new MemorySkillFileSystem(files);
  const chosen = new Map(Object.entries(selections));
  const board: SkillsBoard = {
    detect: async () => VAULT,
    loadPersona: async (_vault, id): Promise<Persona | null> => (chosen.has(id) ? { ...parsePersonaFile(id, PERSONA(id[0]!.toUpperCase() + id.slice(1))), skills: chosen.get(id)! } : null),
    listPersonaIds: async () => [...chosen.keys()],
    personaPatch: vi.fn(async () => ({ ok: true as const })),
  };
  const github = new FakeGithub();
  github.set('acme/skills', acmeRepo());
  const commitTree = vi.fn(async (_root: string, _paths: readonly string[], _message: string) => undefined);
  const host = { announceChanges: vi.fn(), log: vi.fn() };
  const git = { locate: async () => ({ root: '/vault', prefix: '' }), commitTree };
  const queue = new SkillWriteQueue();
  const checks = new SkillUpdateChecks(github, () => new Date('2026-11-13T09:12:00Z'));
  const now = () => new Date('2026-11-13T09:12:00Z');
  const library = new SkillLibraryService({ board, host, git, queue, checks, fetcher: new SkillSourceFetcher(github), fsFor: () => fs, now });
  const skills = new SkillService({ board, host, git, queue, checks, fsFor: () => fs });
  return { fs, github, commitTree, library, skills, checks };
}
