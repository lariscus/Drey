import { describe, expect, it } from 'vitest';
import { SessionProjectRule } from './session-project-rule';

/** req-283: a free session's project — the one picked, else the one project whose repository's checkout holds its folder. */
const PROJECTS = [
  { id: 'drey', repos: ['drey', 'shared'] },
  { id: 'lariscus', repos: ['lariscus', 'shared'] },
];
const REPOS = [
  { name: 'drey', path: 'E:\\projects\\Drey' },
  { name: 'lariscus', path: 'E:/projects/lariscus/' },
  { name: 'shared', path: 'E:\\projects\\shared' },
  { name: 'remote-only', path: null },
];
const rule = new SessionProjectRule();
const pick = (directory: string, picked?: string) => rule.pick({ directory, picked, projects: PROJECTS, repos: REPOS });

describe('SessionProjectRule', () => {
  it('takes the project picked, whatever the folder', () => {
    expect(pick('E:\\projects\\drey', 'lariscus')).toEqual({ ok: true, project: 'lariscus' });
  });

  it('refuses a picked project the board does not know', () => {
    expect(pick('E:\\projects\\drey', 'gone')).toEqual({ ok: false, error: 'project "gone" not found' });
  });

  it("without a pick, the folder's: its checkout or a folder inside it, slashes and case as Windows compares them", () => {
    expect(pick('e:/projects/drey')).toEqual({ ok: true, project: 'drey' });
    expect(pick('E:\\projects\\lariscus\\src')).toEqual({ ok: true, project: 'lariscus' });
  });

  it('none when no project names such a repository, when two do, or for a look-alike folder', () => {
    expect(pick('E:\\T')).toEqual({ ok: true, project: null });
    expect(pick('E:\\projects\\shared')).toEqual({ ok: true, project: null });
    expect(pick('E:\\projects\\drey-old')).toEqual({ ok: true, project: null });
  });
});
