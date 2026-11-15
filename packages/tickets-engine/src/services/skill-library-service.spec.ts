import { describe, expect, it } from 'vitest';
import { parseSkillSources } from '../core/skills/skill-sources-file';
import { GithubError } from './github-client';
import { C14, C15, libraryWorld, MAIN, SHARED, SOURCES, skillText } from './skill-library.fixture';

const sourcesOf = async (world: ReturnType<typeof libraryWorld>) => parseSkillSources(await world.fs.readText(SOURCES)).sources;

describe('SkillLibraryService — fetch', () => {
  it('writes every skill folder of the source as Agent Skills folders, records the source, one commit of exactly those files', async () => {
    const world = libraryWorld();
    const reply = await world.library.skillSourceFetch({ repo: 'https://github.com/acme/skills', path: '', ref: 'v1.4' });
    expect(reply).toMatchObject({ ok: true, source: 'github.com/acme/skills', skipped: [], warning: null });
    expect(await world.fs.readText(`${SHARED}/playwright-e2e/scripts/run.sh`)).toBe('npx playwright test');
    expect(await world.fs.readText(`${SHARED}/angular-standalone/SKILL.md`)).toBe(skillText('angular-standalone'));
    expect(await world.fs.readText(`${SHARED}/README.md`)).toBeNull();
    expect(await sourcesOf(world)).toEqual([{ repo: 'github.com/acme/skills', path: '', ref: 'v1.4', commit: C14, fetched: '2026-11-13T09:12:00.000Z', skills: ['angular-standalone', 'old-one', 'playwright-e2e'] }]);
    expect(world.commitTree).toHaveBeenCalledOnce();
    const [, paths, message] = world.commitTree.mock.calls[0]!;
    expect([...paths].sort()).toEqual([SOURCES, `${SHARED}/angular-standalone/SKILL.md`, `${SHARED}/old-one/SKILL.md`, `${SHARED}/playwright-e2e/SKILL.md`, `${SHARED}/playwright-e2e/scripts/run.sh`]);
    expect(message).toBe('skills: github.com/acme/skills fetched at v1.4 (3 skills)');
    // the fetch looked for newer tags at once: v1.5 is there
    expect(reply.ok && reply.library.sources[0]).toMatchObject({ id: 'github.com/acme/skills', updateAvailable: 'v1.5', checked: '2026-11-13T09:12:00.000Z' });
    expect(reply.ok && reply.library.skills.map((s) => [s.name, s.source?.repo ?? 'shared', s.updateAvailable])).toEqual([
      ['angular-standalone', 'github.com/acme/skills', 'v1.5'],
      ['old-one', 'github.com/acme/skills', 'v1.5'],
      ['playwright-e2e', 'github.com/acme/skills', 'v1.5'],
    ]);
  });

  it('takes the skills under a path only', async () => {
    const world = libraryWorld();
    const reply = await world.library.skillSourceFetch({ repo: 'acme/skills', path: 'skills', ref: 'main' });
    expect(reply.ok && reply.library.sources[0]).toMatchObject({ id: 'github.com/acme/skills/skills', path: 'skills', ref: 'main', commit: MAIN, skills: ['e2e'], updateAvailable: null });
  });

  it('refuses a bad repository, a source it has, a name the pool already holds, and passes GitHub\'s failure on', async () => {
    const world = libraryWorld({ [`${SHARED}/old-one/SKILL.md`]: skillText('old-one') });
    expect(await world.library.skillSourceFetch({ repo: 'gitlab.com/x/y', ref: 'main' })).toMatchObject({ ok: false, code: 'bad_source' });
    expect(await world.library.skillSourceFetch({ repo: 'acme/skills', ref: 'a b' })).toMatchObject({ ok: false, code: 'bad_source' });
    expect(await world.library.skillSourceFetch({ repo: 'acme/skills', ref: 'v1.4' })).toMatchObject({ ok: false, code: 'exists', error: expect.stringContaining('old-one') });
    expect(await world.library.skillSourceFetch({ repo: 'acme/nothing', ref: 'main' })).toMatchObject({ ok: false, code: 'not_found' });
    world.github.failNext = new GithubError('rate_limited', 'limit');
    expect(await world.library.skillSourceFetch({ repo: 'acme/skills', path: 'skills', ref: 'main' })).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(await world.library.skillSourceFetch({ repo: 'acme/skills', path: 'nowhere', ref: 'main' })).toMatchObject({ ok: false, code: 'no_skill' });
    expect(world.commitTree).not.toHaveBeenCalled();
    await world.library.skillSourceFetch({ repo: 'acme/skills', path: 'skills', ref: 'main' });
    expect(await world.library.skillSourceFetch({ repo: 'github.com/acme/skills', path: '/skills/', ref: 'main' })).toMatchObject({ ok: false, code: 'exists' });
  });
});

describe('SkillLibraryService — update, remove, delete', () => {
  it('updates to the newer tag: changed folders rewritten, vanished ones removed, a broken one skipped, one commit', async () => {
    const world = libraryWorld();
    await world.library.skillSourceFetch({ repo: 'acme/skills', ref: 'v1.4' });
    const reply = await world.library.skillSourceUpdate({ source: 'github.com/acme/skills', to: 'v1.5' });
    expect(reply).toMatchObject({ ok: true, skipped: [{ folder: 'broken', code: 'bad_skill_file' }] });
    expect(await world.fs.readText(`${SHARED}/playwright-e2e/SKILL.md`)).toContain('Do it better.');
    expect(await world.fs.readText(`${SHARED}/playwright-e2e/scripts/run.sh`)).toBeNull();
    expect(await world.fs.readText(`${SHARED}/old-one/SKILL.md`)).toBeNull();
    expect(await world.fs.readText(`${SHARED}/new-one/SKILL.md`)).not.toBeNull();
    expect(await sourcesOf(world)).toMatchObject([{ ref: 'v1.5', commit: C15, skills: ['angular-standalone', 'new-one', 'playwright-e2e'] }]);
    expect(world.commitTree).toHaveBeenCalledTimes(2);
    const [, paths, message] = world.commitTree.mock.calls[1]!;
    expect(paths).toEqual(expect.arrayContaining([`${SHARED}/old-one/SKILL.md`, `${SHARED}/playwright-e2e/scripts/run.sh`, `${SHARED}/new-one/SKILL.md`, SOURCES]));
    expect(message).toBe('skills: github.com/acme/skills updated at v1.5 (3 skills)');
    expect(reply.ok && reply.library.sources[0]!.updateAvailable).toBeNull();
    expect(await world.library.skillSourceUpdate({ source: 'github.com/nope/x' })).toMatchObject({ ok: false, code: 'no_source' });
  });

  it('removes a source with its folders and its record entry, one commit', async () => {
    const world = libraryWorld({ [`${SHARED}/mine/SKILL.md`]: skillText('mine') });
    await world.library.skillSourceFetch({ repo: 'acme/skills', ref: 'v1.4' });
    const reply = await world.library.skillSourceRemove({ source: 'github.com/acme/skills' });
    expect(reply.ok && reply.library).toMatchObject({ sources: [], skills: [{ name: 'mine', source: null }] });
    expect(await sourcesOf(world)).toEqual([]);
    expect(world.commitTree.mock.calls[1]![2]).toBe('skills: source github.com/acme/skills removed (3 skills)');
  });

  it('deletes a shared skill (and its name from its source) or a persona\'s own skill', async () => {
    const world = libraryWorld({ 'tickets/_meta/personas/ben/skills/notes/SKILL.md': skillText('notes') });
    await world.library.skillSourceFetch({ repo: 'acme/skills', ref: 'v1.4' });
    const shared = await world.library.skillDelete({ name: 'old-one' });
    expect(shared.ok && shared.library.skills.map((s) => s.name)).toEqual(['angular-standalone', 'notes', 'playwright-e2e']);
    expect((await sourcesOf(world))[0]!.skills).toEqual(['angular-standalone', 'playwright-e2e']);
    expect(world.commitTree.mock.calls[1]![1]).toEqual([SOURCES, `${SHARED}/old-one/SKILL.md`]);
    const own = await world.library.skillDelete({ name: 'notes', persona: 'ben' });
    expect(own.ok && own.library.skills.map((s) => s.name)).toEqual(['angular-standalone', 'playwright-e2e']);
    expect(world.commitTree.mock.calls[2]![2]).toBe('skills: notes deleted of ben');
    expect(await world.library.skillDelete({ name: 'ghost' })).toMatchObject({ ok: false, code: 'no_skill' });
    expect(await world.library.skillDelete({ name: '../x' })).toMatchObject({ ok: false, code: 'bad_name' });
    expect(await world.library.skillDelete({ name: 'notes', persona: 'nobody' })).toMatchObject({ ok: false, code: 'no_persona' });
  });
});

describe('SkillLibraryService — listing', () => {
  it('lists shared and own skills with who uses them; an own skill hides the shared one of its name', async () => {
    const world = libraryWorld(
      { [`${SHARED}/review/SKILL.md`]: skillText('review'), [`${SHARED}/go/SKILL.md`]: skillText('go'), 'tickets/_meta/personas/ralf/skills/review/SKILL.md': skillText('review') },
      { ben: ['review', 'go'], ralf: ['review'] },
    );
    const reply = await world.library.skillLibrary();
    expect(reply.ok && reply.library.skills.map((s) => [s.name, s.origin, s.persona, s.usedBy.map((u) => u.title)])).toEqual([
      ['go', 'shared', null, ['Ben']],
      ['review', 'shared', null, ['Ben']],
      ['review', 'own', 'ralf', ['Ralf']],
    ]);
    expect(reply.ok && reply.library.skills[0]).toMatchObject({ tokens: expect.any(Number), size: skillText('go').length, usedBy: [{ id: 'ben', title: 'Ben', color: expect.any(String) }] });
    expect(world.github.calls).toEqual([]);
  });

  it('looks for newer refs only when asked, at most once in five minutes per source and ref', async () => {
    const world = libraryWorld();
    await world.library.skillSourceFetch({ repo: 'acme/skills', path: 'skills', ref: 'main' });
    const calls = world.github.calls.length;
    await world.library.skillLibrary();
    expect(world.github.calls.length).toBe(calls);
    await world.library.skillLibrary({ check: true });
    expect(world.github.calls.length).toBe(calls);
  });
});

describe('SkillService and the library', () => {
  it('shows a fetched skill\'s source and the newer ref on a persona\'s listing; an upload over it makes it the owner\'s', async () => {
    const world = libraryWorld();
    await world.library.skillSourceFetch({ repo: 'acme/skills', ref: 'v1.4' });
    const listed = await world.skills.personaSkills('ben');
    expect(listed.ok && listed.list.skills.find((s) => s.name === 'playwright-e2e')).toMatchObject({ source: { repo: 'github.com/acme/skills', path: '', ref: 'v1.4', commit: C14 }, updateAvailable: 'v1.5' });
    await world.skills.skillUpload({ scope: 'shared', format: 'markdown', name: 'playwright-e2e', text: skillText('playwright-e2e', 'Mine now.'), overwrite: true });
    expect((await sourcesOf(world))[0]!.skills).toEqual(['angular-standalone', 'old-one']);
    expect(world.commitTree.mock.calls.at(-1)![1]).toContain(SOURCES);
    const after = await world.skills.sharedSkills();
    expect(after.ok && after.list.skills.find((s) => s.name === 'playwright-e2e')).toMatchObject({ source: null, updateAvailable: null });
  });
});
