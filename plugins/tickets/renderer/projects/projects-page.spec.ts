// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { DreyPluginApi, MarkdownViewOptions } from '../../../../shared/plugin-api/renderer';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { createProjectsSettingsPage } from './projects-page';

const DREY: ProjectRecord = { id: 'drey', name: 'Drey', color: '#8ecbef', repos: ['drey'], folders: ['E:\\specs\\drey-shared'], vaults: { 'Drey notes': 'write', 'Lariscus notes': 'read' }, purpose: 'A note app.' };
const LARISCUS: ProjectRecord = { id: 'lariscus', name: 'Lariscus', color: '#f2cfae', repos: [], folders: [], vaults: {}, purpose: '' };

let invoked: [string, unknown][] = [];
let replies: Record<string, unknown> = {};
let listeners: Record<string, ((data: unknown) => void)[]> = {};
let views: { opts: MarkdownViewOptions; text: string }[] = [];
let host: HTMLElement;
let dispose: () => void;

function fakeApi(): DreyPluginApi {
  const snapshot = { projects: [DREY, LARISCUS], columns: [{ tickets: [{ meta: { project: 'drey' } }, { meta: { project: 'drey' } }, { meta: {} }] }] };
  replies = {
    board: snapshot,
    reposListing: { file: null, repos: [{ name: 'drey' }, { name: 'lariscus' }, { name: 'smoke' }], error: null },
    projectSave: { ok: true, id: 'drey' },
    pickFolder: { ok: true, path: 'E:/picked' },
  };
  return {
    i18n,
    backend: {
      invoke: (method: string, payload?: unknown) => (invoked.push([method, payload]), Promise.resolve(replies[method] ?? { ok: true })),
      on: (event: string, listener: (data: unknown) => void) => {
        (listeners[event] ??= []).push(listener);
        return () => {
          listeners[event] = (listeners[event] ?? []).filter((l) => l !== listener);
        };
      },
    },
    vault: { listVaults: () => Promise.resolve([{ name: 'Drey notes' }, { name: 'Work notes' }, { name: 'Private' }]) },
    ui: {
      icon: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      createMarkdownView: (opts: MarkdownViewOptions) => {
        const view = { opts, text: opts.content ?? '' };
        views.push(view);
        const element = document.createElement('div');
        return { element, setContent: (t: string) => (view.text = t), getContent: () => view.text, setReadOnly: () => undefined, setMode: () => undefined, format: () => undefined, focus: () => undefined, dispose: () => undefined };
      },
    },
  } as unknown as DreyPluginApi;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const saves = () => invoked.filter(([m]) => m === 'projectSave').map(([, p]) => p as { id?: string; project: Omit<ProjectRecord, 'id'> });
const calls = (method: string) => invoked.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
const addButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.prj-add')].find((b) => b.textContent === label)!;
const confirmButton = () => host.querySelector<HTMLButtonElement>('.prj-picker-actions button')!;
const cancelButton = () => host.querySelector<HTMLButtonElement>('.prj-picker-actions button:last-child')!;
const typeUrl = (value: string) => {
  const url = host.querySelector<HTMLInputElement>('.prj-url')!;
  url.value = value;
  url.dispatchEvent(new Event('input'));
};
const pickerError = () => host.querySelector('.prj-picker-error')?.textContent;

beforeEach(async () => {
  invoked = [];
  listeners = {};
  views = [];
  host = document.createElement('div');
  document.body.append(host);
  const page = createProjectsSettingsPage(fakeApi());
  expect(page.bare).toBe(true);
  dispose = page.mount(host);
  await settle();
  await settle();
});

afterEach(() => {
  dispose();
  host.remove();
});

describe('Settings → Projects (req-284, board 7m)', () => {
  it('lists the projects with their open tickets and shows the first', () => {
    const items = [...host.querySelectorAll('.prj-item')].map((i) => i.textContent);
    expect(items).toEqual(['Drey2 tickets', 'Lariscus0 tickets']);
    expect(host.querySelector('.prj-title')?.textContent).toBe('Drey');
    expect(host.querySelector('.prj-item[aria-current="true"]')?.textContent).toContain('Drey');
  });

  it('commits a new name when the field is left', async () => {
    const input = host.querySelector<HTMLInputElement>('.prj-input')!;
    input.value = 'Drey app';
    input.dispatchEvent(new Event('change'));
    await settle();
    const { id: _id, ...draft } = DREY;
    expect(saves()).toEqual([{ id: 'drey', project: { ...draft, name: 'Drey app' } }]);
  });

  it('commits a colour preset on the click', async () => {
    host.querySelector<HTMLButtonElement>('.prj-swatch[aria-label="Green"]')!.click();
    await settle();
    expect(saves()[0]!.project.color).toBe('#bfe3cd');
  });

  it('shows the registered vaults and a named vault this device lacks as not on this device', () => {
    const rows = [...host.querySelectorAll('.prj-vault')];
    expect(rows.map((r) => r.querySelector('.prj-vault-name')!.textContent)).toEqual(['Drey notes', 'Work notes', 'Private', 'Lariscus notes']);
    const away = rows[3]!;
    expect(away.classList.contains('prj-vault-away')).toBe(true);
    expect(away.textContent).toContain('not on this device');
    expect([...away.querySelectorAll('button')].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(rows[0]!.querySelector('[aria-checked="true"]')?.textContent).toBe('Write');
  });

  it('commits a vault access on the click', async () => {
    const work = [...host.querySelectorAll('.prj-vault')][1]!;
    [...work.querySelectorAll<HTMLButtonElement>('.prj-seg-btn')].find((b) => b.textContent === 'Read')!.click();
    await settle();
    expect(saves()[0]!.project.vaults).toEqual({ 'Drey notes': 'write', 'Lariscus notes': 'read', 'Work notes': 'read' });
  });

  it('commits the purpose when the editor loses focus, and only when it changed', async () => {
    const frame = host.querySelector<HTMLElement>('.prj-ed')!;
    frame.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(saves()).toHaveLength(0);
    views[0]!.text = 'A note app with a crew.';
    frame.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle();
    expect(saves()[0]!.project.purpose).toBe('A note app with a crew.');
  });

  it('offers the other repositories of repos.md and From folder… in the picker, and lists a picked one', async () => {
    addButton('Add repository').click();
    const select = host.querySelector<HTMLSelectElement>('.prj-picker-list')!;
    expect([...select.options].map((o) => o.text)).toEqual(['lariscus', 'smoke', 'From folder…']);
    select.value = 'smoke';
    confirmButton().click();
    await settle();
    expect(saves()[0]!.project.repos).toEqual(['drey', 'smoke']);
  });

  it('creates a new project named after the others', async () => {
    host.querySelector<HTMLButtonElement>('.prj-list-head button')!.click();
    await settle();
    expect(saves()[0]).toEqual({ project: { name: 'New project', color: '#bfe3cd', repos: [], folders: [], vaults: {}, purpose: '' } });
  });
});

describe('Settings → Projects: folders and repositories that work (req-304)', () => {
  it('Add folder opens the folder picker and hands the folder to the engine, which tells a repository from a plain folder', async () => {
    replies['projectAddFolder'] = { ok: true, id: 'drey', kind: 'folder', name: 'E:/picked' };
    addButton('Add folder').click();
    await settle();
    await settle();
    expect(calls('pickFolder')).toEqual([{ title: 'Choose a folder for the project' }]);
    expect(calls('projectAddFolder')).toEqual([{ id: 'drey', folder: 'E:/picked', repoOnly: false }]);
    expect(host.querySelector('.prj-status')?.textContent).toBe('Saved · committed just now');
    expect(calls('board').length).toBeGreaterThan(1);
  });

  it('does nothing when the folder picker is cancelled', async () => {
    replies['pickFolder'] = { ok: true };
    addButton('Add folder').click();
    await settle();
    expect(calls('projectAddFolder')).toEqual([]);
  });

  it('shows a refusal of the engine on the status line', async () => {
    replies['projectAddFolder'] = { ok: false, code: 'not_a_folder', error: 'E:/picked is not a folder' };
    addButton('Add folder').click();
    await settle();
    await settle();
    expect(host.querySelector('.prj-status')?.textContent).toBe('Not saved: That folder does not exist');
  });

  it('From folder… uses the same picker and asks for a repository; a plain folder says so in the picker', async () => {
    replies['projectAddFolder'] = { ok: false, code: 'not_a_repository', error: 'x' };
    addButton('Add repository').click();
    const select = host.querySelector<HTMLSelectElement>('.prj-picker-list')!;
    select.value = select.options[select.options.length - 1]!.value;
    confirmButton().click();
    await settle();
    await settle();
    expect(calls('pickFolder')).toEqual([{ title: 'Choose a git repository' }]);
    expect(calls('projectAddFolder')).toEqual([{ id: 'drey', folder: 'E:/picked', repoOnly: true }]);
    expect(pickerError()).toBe('No git repository in that folder');
    expect(host.querySelector<HTMLElement>('.prj-picker')!.hidden).toBe(false);
  });

  it('a Git URL asks where to clone, clones, lists the checkout and closes the picker', async () => {
    replies['projectCloneRepo'] = { ok: true, id: 'drey', kind: 'repository', name: 'tool', path: 'E:/picked/tool' };
    addButton('Add repository').click();
    typeUrl('https://example.com/owner/tool.git');
    confirmButton().click();
    await settle();
    await settle();
    expect(calls('pickFolder')).toEqual([{ title: 'Clone tool into…' }]);
    expect(calls('projectCloneRepo')).toEqual([{ id: 'drey', url: 'https://example.com/owner/tool.git', parent: 'E:/picked' }]);
    expect(host.querySelector<HTMLElement>('.prj-picker')!.hidden).toBe(true);
  });

  it('follows the clone’s progress and takes a cancel', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    replies['projectCloneRepo'] = new Promise((resolve) => (answer = resolve));
    addButton('Add repository').click();
    typeUrl('git@example.com:owner/tool.git');
    confirmButton().click();
    await settle();
    await settle();
    listeners['repo-clone-progress']![0]!({ phase: 'Receiving objects', percent: 45 });
    expect(host.querySelector('.prj-picker-progress')?.textContent).toBe('Cloning tool — Receiving objects 45%');
    expect(host.querySelector<HTMLInputElement>('.prj-url')!.disabled).toBe(true);
    cancelButton().click();
    await settle();
    expect(calls('projectCloneCancel')).toHaveLength(1);
    answer({ ok: false, code: 'cancelled', error: '' });
    await settle();
    await settle();
    expect(pickerError()).toBe('');
    expect(host.querySelector<HTMLInputElement>('.prj-url')!.disabled).toBe(false);
    expect(listeners['repo-clone-progress']).toEqual([]);
  });

  it.each([
    ['auth', 'x', "Git was refused access. Sign in with git's credential manager or add an ssh key, then try again."],
    ['offline', 'x', 'The server could not be reached. Check the connection and the address.'],
    ['exists', 'E:/picked/tool', 'E:/picked/tool already exists and is not empty. Pick another folder.'],
    ['git', 'disk full', 'Git failed: disk full'],
  ])('names a failed clone (%s) in the picker, which stays open', async (code, error, text) => {
    replies['projectCloneRepo'] = { ok: false, code, error };
    addButton('Add repository').click();
    typeUrl('https://example.com/owner/tool.git');
    confirmButton().click();
    await settle();
    await settle();
    expect(pickerError()).toBe(text);
    expect(host.querySelector<HTMLElement>('.prj-picker')!.hidden).toBe(false);
  });

  it('refuses a URL that is not a git URL, or carries credentials, before asking for a folder', async () => {
    addButton('Add repository').click();
    typeUrl('not a url');
    confirmButton().click();
    await settle();
    expect(pickerError()).toBe('That is not an https or ssh git URL.');
    typeUrl('https://me:pw@example.com/a.git');
    confirmButton().click();
    await settle();
    expect(pickerError()).toContain('Drey never stores credentials');
    expect(calls('pickFolder')).toEqual([]);
  });
});
