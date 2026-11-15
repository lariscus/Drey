import { describe, expect, it } from 'vitest';
import { readSkillZip } from '../../../../packages/tickets-engine/src/services/skill-zip';
import { validateSkillBundle } from '../../../../packages/tickets-engine/src/core/skills/skill-bundle';
import { MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_SKILL_TEXT_BYTES } from '../../../../packages/tickets-engine/src/core/skills/skill-limits';
import { bytesToBase64, uploadPlanOf, zipStored, type PickedFile } from './skill-upload-model';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const picked = (path: string, data: string | Uint8Array, size?: number): PickedFile => {
  const bytes = typeof data === 'string' ? encode(data) : data;
  return { path, size: size ?? bytes.length, bytes: async () => bytes };
};
const SKILL = '---\nname: review\ndescription: Reviews a diff\n---\n\nLook at the diff.\n';

describe('the stored zip a folder is packed into (req-237)', () => {
  it('is read back by the engine’s own zip reader, names and bytes intact, UTF-8 names included', () => {
    const zip = zipStored([
      { path: 'review/SKILL.md', data: encode(SKILL) },
      { path: 'review/references/größe.txt', data: encode('Maß') },
      { path: 'review/empty.txt', data: new Uint8Array(0) },
    ]);
    const files = readSkillZip(Buffer.from(zip));
    expect(files.map((file) => file.path)).toEqual(['review/SKILL.md', 'review/references/größe.txt', 'review/empty.txt']);
    expect(new TextDecoder().decode(files[0]!.data)).toBe(SKILL);
    expect(new TextDecoder().decode(files[1]!.data)).toBe('Maß');
    expect(files[2]!.data.length).toBe(0);
  });

  it('passes the engine’s validation as a skill folder', () => {
    const files = readSkillZip(Buffer.from(zipStored([{ path: 'review/SKILL.md', data: encode(SKILL) }, { path: 'review/run.sh', data: encode('echo') }])));
    expect(validateSkillBundle(files, null)).toMatchObject({ ok: true, name: 'review' });
  });

  it('writes base64 the other side decodes, for a buffer larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 251);
    expect(new Uint8Array(Buffer.from(bytesToBase64(bytes), 'base64'))).toEqual(bytes);
  });
});

describe('what a pick becomes (req-237)', () => {
  it('a SKILL.md goes as its text with no name; any other .md is named by its stem', async () => {
    expect(await uploadPlanOf('file', [picked('SKILL.md', SKILL)])).toEqual({ ok: true, command: { format: 'markdown', text: SKILL } });
    expect(await uploadPlanOf('file', [picked('skill.MD', SKILL)])).toEqual({ ok: true, command: { format: 'markdown', text: SKILL } });
    expect(await uploadPlanOf('file', [picked('lint-rules.markdown', 'x')])).toEqual({ ok: true, command: { format: 'markdown', text: 'x', name: 'lint-rules' } });
  });

  it('a zip goes up as base64', async () => {
    expect(await uploadPlanOf('file', [picked('review.zip', new Uint8Array([80, 75, 3, 4]))])).toEqual({ ok: true, command: { format: 'zip', zipBase64: 'UEsDBA==' } });
  });

  it('a folder goes as one zip of everything but its history', async () => {
    const plan = await uploadPlanOf('folder', [picked('review/SKILL.md', SKILL), picked('review/scripts/run.sh', 'echo'), picked('review/.git/config', '[core]')]);
    expect(plan.ok && plan.command.format).toBe('zip');
    const files = readSkillZip(Buffer.from(plan.ok ? plan.command.zipBase64! : '', 'base64'));
    expect(files.map((file) => file.path)).toEqual(['review/SKILL.md', 'review/scripts/run.sh']);
  });

  it('refuses with the engine’s code what the engine would refuse: no file, a second file, other text, too many, too large', async () => {
    expect(await uploadPlanOf('file', [])).toEqual({ ok: false, code: 'bad_skill_file' });
    expect(await uploadPlanOf('file', [picked('a.md', 'x'), picked('b.md', 'y')])).toEqual({ ok: false, code: 'bad_skill_file' });
    expect(await uploadPlanOf('file', [picked('notes.txt', 'x')])).toEqual({ ok: false, code: 'bad_skill_file' });
    expect(await uploadPlanOf('file', [picked('big.md', 'x', MAX_SKILL_TEXT_BYTES + 1)])).toEqual({ ok: false, code: 'too_large' });
    expect(await uploadPlanOf('file', [picked('big.zip', 'x', MAX_SKILL_BYTES + 1)])).toEqual({ ok: false, code: 'too_large' });
    expect(await uploadPlanOf('folder', [picked('only/.git/HEAD', 'ref')])).toEqual({ ok: false, code: 'bad_skill_file' });
    const many = Array.from({ length: MAX_SKILL_FILES + 1 }, (_, i) => picked(`s/f${i}.txt`, 'x'));
    expect(await uploadPlanOf('folder', many)).toEqual({ ok: false, code: 'too_large' });
    expect(await uploadPlanOf('folder', [picked('s/SKILL.md', 'x', MAX_SKILL_BYTES + 1)])).toEqual({ ok: false, code: 'too_large' });
  });
});
