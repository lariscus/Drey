// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { createSkillsLibrarySection } from './skills-library-section';
import { library } from './skills-library.fixture';

function setup(answers: Record<string, unknown> = {}) {
  const invoke = vi.fn((method: string): Promise<unknown> => {
    if (method in answers) {
      return Promise.resolve(answers[method]);
    }
    return Promise.resolve(method === 'personas' ? [] : { ok: true, library, skipped: [], warning: null });
  });
  const api = { i18n, backend: { invoke } } as unknown as DreyPluginApi;
  const section = createSkillsLibrarySection(api);
  document.body.replaceChildren(section.root);
  return { section, invoke };
}

const calls = (invoke: ReturnType<typeof vi.fn>, method: string): unknown[] => invoke.mock.calls.filter(([name]) => name === method).map(([, payload]) => payload);
const byLabel = <T extends Element>(root: ParentNode, label: string): T => root.querySelector<T>(`[aria-label="${label}"]`)!;
const texts = (root: ParentNode, selector: string): string[] => [...root.querySelectorAll(selector)].map((node) => node.textContent ?? '');
const button = (root: ParentNode, label: string): HTMLButtonElement => [...root.querySelectorAll('button')].find((node) => node.textContent === label)!;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

describe('Settings → Skills library page', () => {
  it('draws the title with Upload and Add from GitHub, Sources and Skills; the first look asks for newer refs, later ones do not', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    expect(section.root.querySelector('[data-settings-section="skills"] h3')?.textContent).toBe('Skills library');
    expect(texts(section.root, '.skl-titlerow button')).toEqual(['Upload skill…', 'Skill file or zip…', 'Skill folder…', 'Add from GitHub']);
    expect(texts(section.root, 'h2')).toEqual(['Sources', 'Skills']);
    await section.refresh();
    expect(calls(invoke, 'skillLibrary')).toEqual([{ check: true }, { check: false }]);
  });

  it('lists each source with its ref, count, last fetch, Update to the newer ref and remove', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const rows = section.root.querySelectorAll('.skl-source');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/^github\.com\/acme\/skillsref v1\.42 skillsLast fetched today .+Update to v1\.5$/);
    expect(rows[1]!.textContent).toContain('ref main1 skillLast fetched');
    expect(rows[1]!.textContent).not.toContain('Update');
    button(rows[0]!, 'Update to v1.5').click();
    await settle();
    expect(calls(invoke, 'skillSourceUpdate')).toEqual([{ source: 'github.com/acme/skills', to: 'v1.5' }]);
  });

  it('asks in the row before a source goes, and Keep leaves it', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    byLabel<HTMLButtonElement>(section.root.querySelectorAll('.skl-source')[0]!, 'Remove source').click();
    const ask = section.root.querySelector('.skl-confirm')!;
    expect(ask.textContent).toContain('Remove github.com/acme/skills and its 2 skills?');
    button(ask, 'Keep').click();
    expect(section.root.querySelectorAll('.skl-source')).toHaveLength(2);
    byLabel<HTMLButtonElement>(section.root.querySelectorAll('.skl-source')[0]!, 'Remove source').click();
    button(section.root.querySelector('.skl-confirm')!, 'Remove').click();
    await settle();
    expect(calls(invoke, 'skillSourceRemove')).toEqual([{ source: 'github.com/acme/skills' }]);
  });

  it('lists the skills with title, source, Used by and size, and filters by group and search', async () => {
    const { section } = setup();
    await section.refresh();
    const names = (): string[] => texts(section.root, '.skl-skill-name');
    expect(names()).toEqual(['Adr writing', 'Angular standalone', 'Commit messages', 'Go conventions', 'Playwright e2e', 'Release notes', 'Security review', 'Test first']);
    const playwright = section.root.querySelector('[data-skill="playwright-e2e"]')!;
    expect(playwright.querySelector('.skl-skill-source')?.textContent).toBe('github.com/acme/skills');
    expect([...playwright.querySelectorAll('.skl-user')].map((node) => node.getAttribute('title'))).toEqual(['Ben', 'Tessa']);
    expect(playwright.textContent).toContain('1.2k tokens');
    expect(section.root.querySelector('[data-skill="paul/release-notes"]')?.textContent).toContain('own—340 tokens');
    button(section.root, 'GitHub').click();
    expect(names()).toEqual(['Angular standalone', 'Playwright e2e', 'Security review']);
    button(section.root, 'Own').click();
    expect(names()).toEqual(['Release notes']);
    button(section.root, 'Shared').click();
    expect(names()).toEqual(['Adr writing', 'Commit messages', 'Go conventions', 'Test first']);
    button(section.root, 'All').click();
    const search = byLabel<HTMLInputElement>(section.root, 'Search skills');
    search.value = 'anthropics';
    search.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['Security review']);
    search.value = 'nothing like it';
    search.dispatchEvent(new Event('input'));
    expect(section.root.querySelector('.skl-empty')?.textContent).toBe('No skill matches');
  });

  it('deletes a skill from its menu after the row says how many personas use it', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const row = section.root.querySelector('[data-skill="commit-messages"]')!;
    byLabel<HTMLButtonElement>(row, 'Skill actions: Commit messages').click();
    button(row, 'Delete skill').click();
    expect(section.root.querySelector('.skl-confirm')?.textContent).toContain('Delete Commit messages? 4 personas use it.');
    button(section.root.querySelector('.skl-confirm')!, 'Delete').click();
    await settle();
    expect(calls(invoke, 'skillDelete')).toEqual([{ name: 'commit-messages' }]);
    const own = section.root.querySelector('[data-skill="paul/release-notes"]')!;
    byLabel<HTMLButtonElement>(own, 'Skill actions: Release notes').click();
    button(own, 'Delete skill').click();
    expect(section.root.querySelector('.skl-confirm')?.textContent).toContain('No persona uses it.');
    button(section.root.querySelector('.skl-confirm')!, 'Delete').click();
    await settle();
    expect(calls(invoke, 'skillDelete')).toEqual([{ name: 'commit-messages' }, { name: 'release-notes', persona: 'paul' }]);
  });

  it('opens the Add from GitHub row, fetches what was typed, and closes on success', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const box = section.root.querySelector<HTMLElement>('.skl-addbox')!;
    expect(box.hidden).toBe(true);
    button(section.root, 'Add from GitHub').click();
    expect(box.hidden).toBe(false);
    const fetch = button(box, 'Fetch');
    const repo = byLabel<HTMLInputElement>(box, 'Repository');
    repo.value = 'github.com/microsoft/playwright-skills';
    repo.dispatchEvent(new Event('input'));
    const path = byLabel<HTMLInputElement>(box, 'Path');
    path.value = 'skills/e2e';
    path.dispatchEvent(new Event('input'));
    expect(byLabel<HTMLInputElement>(box, 'Ref').value).toBe('main');
    expect(fetch.disabled).toBe(false);
    fetch.click();
    await settle();
    expect(calls(invoke, 'skillSourceFetch')).toEqual([{ repo: 'github.com/microsoft/playwright-skills', path: 'skills/e2e', ref: 'main' }]);
    expect(box.hidden).toBe(true);
  });

  it('keeps the row open and says the refusal in the catalog\'s words, and what a fetch skipped', async () => {
    const refused = setup({ skillSourceFetch: { ok: false, code: 'not_found', error: 'x' } });
    await refused.section.refresh();
    button(refused.section.root, 'Add from GitHub').click();
    const box = refused.section.root.querySelector<HTMLElement>('.skl-addbox')!;
    const repo = byLabel<HTMLInputElement>(box, 'Repository');
    repo.value = 'acme/private';
    repo.dispatchEvent(new Event('input'));
    button(box, 'Fetch').click();
    await settle();
    expect(box.hidden).toBe(false);
    expect(refused.section.root.querySelector('.skl-note')?.textContent).toBe('GitHub has no such repository, folder or ref. A private repository is not supported yet.');

    const skipped = setup({ skillSourceUpdate: { ok: true, library, skipped: [{ folder: 'broken', code: 'bad_skill_file', error: '' }], warning: null } });
    await skipped.section.refresh();
    button(skipped.section.root, 'Update to v1.5').click();
    await settle();
    expect(skipped.section.root.querySelector('.skl-note')?.textContent).toBe('One skill folder was skipped: broken.');
  });

  it('says when Drey Service does not answer', async () => {
    const { section } = setup({ skillLibrary: null });
    await section.refresh();
    expect(section.root.querySelector('.skl-note')?.textContent).toBe('Drey Service is not answering.');
  });
});
