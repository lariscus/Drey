// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSkillZip } from '../../../../packages/tickets-engine/src/services/skill-zip';
import { buttonOf, choose, cleanFixture, fx, mount, patches, q, resetFixture, settle, stateText, typeInEditor } from './persona-page.harness';

beforeEach(resetFixture);
afterEach(() => {
  vi.useRealTimers();
  cleanFixture();
});

const rows = (): string[] => [...fx.host.querySelectorAll<HTMLElement>('[data-skill]')].map((row) => row.dataset['skill']!);
const calls = (method: string): Record<string, unknown>[] => fx.invoked.filter(([name]) => name === method).map(([, payload]) => payload as Record<string, unknown>);
const switchOf = (name: string): HTMLButtonElement => q<HTMLButtonElement>(`[data-skill="${name}"] .persona-switch`);
const problem = (): string => q('.persona-skill-problem').textContent ?? '';

const library = (): string[] => [...fx.host.querySelectorAll<HTMLElement>('.persona-library [role="option"]')].map((option) => option.dataset['value']!);
const openLibrary = (): void => buttonOf('Add from library').click();

describe('the Skills block over the engine routes (req-237; board 7k v3, req-288)', () => {
  it('lists the skills the persona carries and its own — switch, source line and tokens; the library lists every skill with its source', async () => {
    await mount();
    expect(rows()).toEqual(['tdd', 'go-conventions']);
    expect(q('[data-skill="tdd"]').textContent).toContain('own · tdd');
    expect(q('[data-skill="tdd"]').textContent).toContain('240 tokens');
    expect(q('[data-skill="tdd"] .persona-skill-name').getAttribute('title')).toBe('tdd skill');
    expect(q('[data-skill="go-conventions"]').textContent).toContain('shared · go-conventions');
    expect(switchOf('tdd').getAttribute('aria-checked')).toBe('true');
    expect(fx.host.querySelector('.persona-library')?.hasAttribute('hidden')).toBe(true);
    openLibrary();
    expect(library()).toEqual(['diff-review', 'go-conventions', 'tdd']);
    expect([...fx.host.querySelectorAll('.persona-library [role="option"]')].map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true', 'true']);
    expect(q('.persona-library [data-value="diff-review"]').textContent).toContain('shared');
    expect(calls('personaSkills')).toEqual([{ persona: 'ben' }]);
  });

  it('a library pick switches the skill on at once — no change of the form; the search narrows the list', async () => {
    await mount();
    openLibrary();
    q<HTMLElement>('.persona-library [data-value="diff-review"]').click();
    await settle();
    expect(calls('personaSkillToggle')).toEqual([{ persona: 'ben', skill: 'diff-review', on: true }]);
    expect(rows()).toEqual(['tdd', 'go-conventions', 'diff-review']);
    expect(stateText()).toBe('Saved');
    expect(patches()).toEqual([]);
    const search = q<HTMLInputElement>('.persona-library-search');
    search.value = 'go';
    search.dispatchEvent(new Event('input'));
    expect(library()).toEqual(['go-conventions']);
  });

  it('a switch goes to the engine at once; remove takes a library skill off the persona', async () => {
    await mount();
    switchOf('go-conventions').click();
    await settle();
    expect(calls('personaSkillToggle')).toEqual([{ persona: 'ben', skill: 'go-conventions', on: false }]);
    expect(rows()).toEqual(['tdd']);
    openLibrary();
    q<HTMLElement>('.persona-library [data-value="go-conventions"]').click();
    await settle();
    q<HTMLButtonElement>('[data-skill="go-conventions"] .persona-icon-btn').click();
    await settle();
    expect(calls('personaSkillToggle')[2]).toEqual({ persona: 'ben', skill: 'go-conventions', on: false });
    expect(calls('personaSkillRemove')).toEqual([]);
  });

  it('shows an engine refusal through its catalog text and leaves the rows as they were', async () => {
    await mount();
    fx.skillFail = { code: 'no_skill', error: 'no skill named go-conventions is available to ben' };
    switchOf('go-conventions').click();
    await settle();
    expect(problem()).toBe('That skill is not available.');
    expect(switchOf('go-conventions').getAttribute('aria-checked')).toBe('true');
    fx.skillFail = { code: 'something_new', error: 'The engine says this.' };
    switchOf('go-conventions').click();
    await settle();
    expect(problem()).toBe('The engine says this.');
    fx.skillFail = null;
    switchOf('tdd').click();
    await settle();
    expect(q('.persona-skill-problem').hidden).toBe(true);
  });

  it('a name the record holds that no folder does is a row to switch off', async () => {
    fx.missing = ['ghost'];
    await mount();
    expect(rows()).toEqual(['tdd', 'go-conventions', 'ghost']);
    expect(q('[data-skill="ghost"]').textContent).toContain('not found');
    switchOf('ghost').click();
    await settle();
    expect(calls('personaSkillToggle')).toEqual([{ persona: 'ben', skill: 'ghost', on: false }]);
  });

  it('an own skill is taken off like any other: it stays in the persona\'s folder and in the library as own', async () => {
    await mount();
    q<HTMLElement>('[data-skill="tdd"] .persona-icon-btn').click();
    await settle();
    expect(calls('personaSkillToggle')).toEqual([{ persona: 'ben', skill: 'tdd', on: false }]);
    expect(calls('personaSkillRemove')).toEqual([]);
    expect(rows()).toEqual(['go-conventions']);
    openLibrary();
    expect(q('.persona-library [data-value="tdd"]').textContent).toContain('own');
  });
});

/** A picker's change event: jsdom has no dialog, so the input's files are set by hand. */
async function pick(kind: 'file' | 'folder', files: File[]): Promise<void> {
  const input = q<HTMLInputElement>(`input[data-pick="${kind}"]`);
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
  await settle();
}

const inFolder = (name: string, path: string, data: string): File => {
  const file = new File([data], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};

describe('Upload own skill… (req-237; the library popup\'s last row since req-288): a file, a zip or a folder, up into the persona’s own folder', () => {
  it('offers a skill file or zip and a skill folder; the hidden inputs are what the browser picks with', async () => {
    await mount();
    openLibrary();
    buttonOf('Upload own skill…').click();
    expect([...fx.host.querySelectorAll('.persona-skill-add [role="menuitem"]')].map((item) => item.textContent)).toEqual(['Skill file or zip…', 'Skill folder…']);
    expect(q<HTMLInputElement>('input[data-pick="file"]').accept).toBe('.md,.markdown,.zip');
    expect(q('input[data-pick="folder"]').hasAttribute('webkitdirectory')).toBe(true);
  });

  it('a SKILL.md goes as text without a name (the frontmatter names the folder); another .md is named by its stem', async () => {
    await mount();
    await pick('file', [new File(['---\nname: review\ndescription: d\n---\nBody'], 'SKILL.md')]);
    expect(fx.uploads[0]).toEqual({ scope: 'own', persona: 'ben', format: 'markdown', text: '---\nname: review\ndescription: d\n---\nBody' });
    await pick('file', [new File(['Flat text'], 'lint-rules.md')]);
    expect(fx.uploads[1]).toEqual({ scope: 'own', persona: 'ben', format: 'markdown', text: 'Flat text', name: 'lint-rules' });
    expect(rows()).not.toContain('uploaded'); // off until switched on: it waits in the library as own
    openLibrary();
    expect(library()).toContain('uploaded');
  });

  it('a zip goes up as base64 for the route to read', async () => {
    await mount();
    await pick('file', [new File([new Uint8Array([80, 75, 3, 4])], 'review.zip')]);
    expect(fx.uploads[0]).toEqual({ scope: 'own', persona: 'ben', format: 'zip', zipBase64: 'UEsDBA==' });
  });

  it('a folder is packed with everything beside SKILL.md, history left out, and the engine’s own reader opens it', async () => {
    await mount();
    await pick('folder', [
      inFolder('SKILL.md', 'review/SKILL.md', '---\nname: review\ndescription: d\n---\nBody'),
      inFolder('check.sh', 'review/scripts/check.sh', 'echo ok\n'),
      inFolder('HEAD', 'review/.git/HEAD', 'ref: refs/heads/main'),
    ]);
    const sent = fx.uploads[0] as { format: string; zipBase64: string };
    expect(sent.format).toBe('zip');
    const files = readSkillZip(Buffer.from(sent.zipBase64, 'base64'));
    expect(files.map((file) => file.path)).toEqual(['review/SKILL.md', 'review/scripts/check.sh']);
    expect(new TextDecoder().decode(files[1]!.data)).toBe('echo ok\n');
  });

  it('refuses a pick the engine would refuse before anything goes up, with the same words', async () => {
    await mount();
    await pick('file', [new File(['text'], 'notes.txt')]);
    expect(problem()).toBe('SKILL.md needs a name, a description and some text.');
    await pick('file', [new File(['x'.repeat(256 * 1024 + 1)], 'big.md')]);
    expect(problem()).toBe('That skill is too large.');
    await pick('folder', [inFolder('HEAD', 'only/.git/HEAD', 'ref')]);
    expect(problem()).toBe('SKILL.md needs a name, a description and some text.');
    expect(fx.uploads).toEqual([]);
  });

  it('shows what the engine refused an upload with', async () => {
    await mount();
    fx.skillFail = { code: 'exists', error: 'a skill named review already exists' };
    await pick('file', [new File(['---\nname: review\ndescription: d\n---\nBody'], 'SKILL.md')]);
    expect(problem()).toBe('A skill with that name already exists.');
  });
});

describe('the start-of-run figure and Preview full prompt (req-238)', () => {
  it('the head counts the brief at the start of a run; typing moves it by what the instructions gain', async () => {
    await mount();
    expect(q('.persona-tokens').textContent).toBe('≈ 2,490 tokens at start');
    typeInEditor('x'.repeat(350));
    expect(q('.persona-tokens').textContent).toBe('≈ 2,584 tokens at start'); // 2,490 - 6 (saved text) + 100 (350 characters at 3.5 per token)
  });

  it('asks for the persona’s first step and its pinned model, and again when the pin changes (req-288)', async () => {
    await mount();
    expect(calls('personaPromptPreview')).toEqual([{ persona: 'ben', step: 'build' }]);
    q<HTMLButtonElement>('[data-field="pinned-model"]').click();
    q<HTMLElement>('.persona-listbox [data-value="claude-code/opus"]').click();
    await settle();
    expect(calls('personaPromptPreview')[1]).toEqual({ persona: 'ben', step: 'build', model: 'claude-code/opus' });
  });

  it('opens the brief read-only in the host’s Markdown view with the parts marked, and closes again', async () => {
    await mount();
    expect(fx.host.querySelector('.persona-ed-preview')).toBeNull();
    buttonOf('Preview full prompt').click();
    await settle();
    const view = fx.views.find((entry) => entry.mode === 'view');
    expect(view).toMatchObject({ text: 'The whole brief', readOnly: true });
    expect([...fx.host.querySelectorAll('.persona-preview-parts:not(.persona-preview-skills) .persona-part')].map((part) => part.textContent)).toEqual(['Instructions · 6', 'Skills · 550', 'Memory · 90', 'Rest · 1,844']);
    expect([...fx.host.querySelectorAll('.persona-part-skill')].map((part) => part.textContent)).toEqual(['Tdd · 240', 'Go conventions · 310']);
    expect(q('.persona-ed-preview').textContent).toContain('≈ 2,490 tokens at start');
    expect(buttonOf('Preview full prompt').getAttribute('aria-pressed')).toBe('true');
    buttonOf('Preview full prompt').click();
    expect(fx.host.querySelector('.persona-ed-preview')).toBeNull();
    expect(view?.disposed).toBe(true);
  });

  it('a skill switch counts the brief again, and an open preview follows it', async () => {
    await mount();
    buttonOf('Preview full prompt').click();
    await settle();
    const before = calls('personaPromptPreview').length;
    openLibrary();
    q<HTMLElement>('.persona-library [data-value="diff-review"]').click();
    await settle();
    expect(calls('personaPromptPreview').length).toBeGreaterThan(before);
    expect([...fx.host.querySelectorAll('.persona-part-skill')].map((part) => part.textContent)).toEqual(['Tdd · 240', 'Go conventions · 310', 'Diff review · 400']);
  });

  it('says why when the engine cannot assemble the brief, and falls back to the instructions alone, still marked ≈', async () => {
    fx.previewFail = true;
    await mount();
    expect(q('.persona-tokens').textContent).toBe('≈ 6 tokens');
    buttonOf('Preview full prompt').click();
    await settle();
    expect(fx.host.querySelector('.persona-ed-preview')).toBeNull();
    expect(fx.host.textContent).toContain('That persona does not exist.');
  });
});

describe('the head’s commit age (req-239) and the Model block’s free count (req-288)', () => {
  it('reads Saved · committed with the relative time of the folder’s last commit; Changed while the form is dirty', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T10:00:00+01:00'));
    fx.view = { committedAt: '2026-11-07T10:00:00+01:00' };
    await mount();
    expect(stateText()).toBe('Saved · committed 2 days ago');
    choose(q<HTMLSelectElement>('[data-field="role"]'), 'Reviewer');
    expect(stateText()).toBe('Changed · not saved');
  });

  it('says plain Saved where git knows no commit', async () => {
    await mount();
    expect(stateText()).toBe('Saved');
  });

  it('counts the models of the class and those a slot could serve now', async () => {
    await mount();
    expect(q('.persona-model-counts').textContent).toBe('1 heavy model · 1 free now');
  });
});
