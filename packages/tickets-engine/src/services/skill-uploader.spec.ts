import { describe, expect, it } from 'vitest';
import { parseSkillMarkdown } from '../core/skills/skill';
import { MemorySkillFileSystem } from './skill-file-system.fake';
import { SkillUploader } from './skill-uploader';
import { buildZip } from './skill-zip.fake';

const HOME = 'tickets/_meta/skills';
const SKILL = '---\nname: review\ndescription: Reviews a diff\n---\n\nLook at the diff.\n';
const b64 = (zip: Buffer): string => zip.toString('base64');

function setup(files: Record<string, string> = {}): { fs: MemorySkillFileSystem; uploader: SkillUploader } {
  const fs = new MemorySkillFileSystem(files);
  return { fs, uploader: new SkillUploader(fs) };
}

describe('SkillUploader — a SKILL.md text', () => {
  it('writes <home>/<name>/SKILL.md, the name from the frontmatter', async () => {
    const { fs, uploader } = setup();
    const outcome = await uploader.upload(HOME, { scope: 'shared', format: 'markdown', text: SKILL });
    expect(outcome).toEqual({ ok: true, name: 'review', changed: [`${HOME}/review/SKILL.md`], deleted: [], replaced: false });
    expect(await fs.readText(`${HOME}/review/SKILL.md`)).toBe(SKILL);
  });

  it('an explicit name wins; a text with no frontmatter gets a generated one (it is a legacy flat file)', async () => {
    const { fs, uploader } = setup();
    await uploader.upload(HOME, { scope: 'shared', format: 'markdown', name: 'notes', text: '# House rules\n\nBe kind.' });
    expect(parseSkillMarkdown((await fs.readText(`${HOME}/notes/SKILL.md`))!)).toMatchObject({ name: 'notes', description: 'House rules', body: '# House rules\n\nBe kind.' });
  });

  it('normalizes Windows line ends so the stored file reads like the others', async () => {
    const { fs, uploader } = setup();
    await uploader.upload(HOME, { scope: 'shared', format: 'markdown', text: SKILL.replaceAll('\n', '\r\n') });
    expect(await fs.readText(`${HOME}/review/SKILL.md`)).toBe(SKILL);
  });

  it('refuses a name that is not a folder name, a broken frontmatter, a missing text, a body-less file, an oversized one', async () => {
    const { fs, uploader } = setup();
    const up = (over: object) => uploader.upload(HOME, { scope: 'shared', format: 'markdown', text: SKILL, ...over });
    expect(await up({ name: '../evil' })).toMatchObject({ ok: false, code: 'bad_name' });
    expect(await up({ text: '---\nname: [broken\n---\nbody' })).toMatchObject({ ok: false, code: 'bad_skill_file' });
    expect(await up({ text: undefined })).toMatchObject({ ok: false, code: 'bad_skill_file' });
    expect(await up({ text: '---\nname: a\ndescription: d\n---\n' })).toMatchObject({ ok: false, code: 'bad_skill_file' });
    expect(await up({ text: `---\nname: a\ndescription: d\n---\n${'x'.repeat(300_000)}` })).toMatchObject({ ok: false, code: 'too_large' });
    expect(fs.store.size).toBe(0);
  });

  it('refuses an overwrite unless asked, then replaces the folder and reports what went', async () => {
    const { fs, uploader } = setup({ [`${HOME}/review/SKILL.md`]: 'old', [`${HOME}/review/old.txt`]: 'stale' });
    expect(await uploader.upload(HOME, { scope: 'shared', format: 'markdown', text: SKILL })).toMatchObject({ ok: false, code: 'exists' });
    expect(await fs.readText(`${HOME}/review/SKILL.md`)).toBe('old');
    const outcome = await uploader.upload(HOME, { scope: 'shared', format: 'markdown', text: SKILL, overwrite: true });
    expect(outcome).toEqual({ ok: true, name: 'review', changed: [`${HOME}/review/SKILL.md`], deleted: [`${HOME}/review/old.txt`], replaced: true });
    expect([...fs.store.keys()]).toEqual([`${HOME}/review/SKILL.md`]);
  });

  it('a legacy flat file of the name counts as existing, and is replaced by an overwrite', async () => {
    const { fs, uploader } = setup({ [`${HOME}/review.md`]: 'flat' });
    expect(await uploader.upload(HOME, { scope: 'shared', format: 'markdown', text: SKILL })).toMatchObject({ ok: false, code: 'exists' });
    const outcome = await uploader.upload(HOME, { scope: 'shared', format: 'markdown', text: SKILL, overwrite: true });
    expect(outcome).toMatchObject({ ok: true, deleted: [`${HOME}/review.md`] });
    expect([...fs.store.keys()]).toEqual([`${HOME}/review/SKILL.md`]);
  });
});

describe('SkillUploader — a zipped skill folder', () => {
  it('writes every file of the folder, scripts untouched byte for byte', async () => {
    const { fs, uploader } = setup();
    const script = Uint8Array.from([0, 1, 2, 250, 251, 252]);
    const zip = buildZip([
      { name: 'review/SKILL.md', data: SKILL },
      { name: 'review/scripts/run.bin', data: script },
      { name: 'review/references/a.md', data: '# Ref' },
    ]);
    const outcome = await uploader.upload(HOME, { scope: 'shared', format: 'zip', zipBase64: b64(zip) });
    expect(outcome).toMatchObject({ ok: true, name: 'review', replaced: false });
    expect(outcome.ok && outcome.changed).toEqual([`${HOME}/review/SKILL.md`, `${HOME}/review/scripts/run.bin`, `${HOME}/review/references/a.md`]);
    expect([...(fs.store.get(`${HOME}/review/scripts/run.bin`) as Uint8Array)]).toEqual([...script]);
    expect(await fs.readText(`${HOME}/review/references/a.md`)).toBe('# Ref');
  });

  it('keeps the SKILL.md of a zip as it is, Windows line ends included', async () => {
    const { fs, uploader } = setup();
    const crlf = SKILL.replaceAll('\n', '\r\n');
    await uploader.upload(HOME, { scope: 'shared', format: 'zip', zipBase64: b64(buildZip([{ name: 'SKILL.md', data: crlf }])), name: 'review' });
    expect(await fs.readText(`${HOME}/review/SKILL.md`)).toBe(crlf);
  });

  it('refuses a path escape, a missing SKILL.md, bad base64, a bad archive — and writes nothing', async () => {
    const { fs, uploader } = setup();
    const up = (zipBase64: string | undefined) => uploader.upload(HOME, { scope: 'shared', format: 'zip', zipBase64 });
    expect(await up(b64(buildZip([{ name: 'review/SKILL.md', data: SKILL }, { name: 'review/../../escape.txt', data: 'x' }])))).toMatchObject({ ok: false, code: 'path_escape' });
    expect(await up(b64(buildZip([{ name: 'review/readme.md', data: 'x' }])))).toMatchObject({ ok: false, code: 'bad_archive' });
    expect(await up('***not base64***')).toMatchObject({ ok: false, code: 'bad_archive' });
    expect(await up(undefined)).toMatchObject({ ok: false, code: 'bad_archive' });
    expect(await up(Buffer.from('plain text, not a zip').toString('base64'))).toMatchObject({ ok: false, code: 'bad_archive' });
    expect(await up(b64(buildZip([{ name: 'SKILL.md', data: 'no frontmatter' }])))).toMatchObject({ ok: false, code: 'bad_skill_file' });
    expect(fs.store.size).toBe(0);
  });

  it('refuses a zip over an existing skill without overwrite', async () => {
    const { uploader } = setup({ [`${HOME}/review/SKILL.md`]: 'old' });
    const zip = b64(buildZip([{ name: 'review/SKILL.md', data: SKILL }]));
    expect(await uploader.upload(HOME, { scope: 'shared', format: 'zip', zipBase64: zip })).toMatchObject({ ok: false, code: 'exists' });
  });

  it('refuses a zip bigger than the cap before decoding it', async () => {
    const { uploader } = setup();
    expect(await uploader.upload(HOME, { scope: 'shared', format: 'zip', zipBase64: 'A'.repeat(12_000_000) })).toMatchObject({ ok: false, code: 'too_large' });
  });
});
