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
let views: { opts: MarkdownViewOptions; text: string }[] = [];
let host: HTMLElement;
let dispose: () => void;

function fakeApi(): DreyPluginApi {
  const snapshot = { projects: [DREY, LARISCUS], columns: [{ tickets: [{ meta: { project: 'drey' } }, { meta: { project: 'drey' } }, { meta: {} }] }] };
  const replies: Record<string, unknown> = {
    board: snapshot,
    reposListing: { file: null, repos: [{ name: 'drey' }, { name: 'lariscus' }, { name: 'smoke' }], error: null },
    projectSave: { ok: true, id: 'drey' },
  };
  return {
    i18n,
    backend: {
      invoke: (method: string, payload?: unknown) => (invoked.push([method, payload]), Promise.resolve(replies[method] ?? { ok: true })),
      on: () => () => undefined,
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

beforeEach(async () => {
  invoked = [];
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
    const add = [...host.querySelectorAll<HTMLButtonElement>('.prj-add')].find((b) => b.textContent === 'Add repository')!;
    add.click();
    const select = host.querySelector<HTMLSelectElement>('.prj-picker-list')!;
    expect([...select.options].map((o) => o.text)).toEqual(['lariscus', 'smoke', 'From folder…']);
    select.value = 'smoke';
    host.querySelector<HTMLButtonElement>('.prj-picker-actions button')!.click();
    await settle();
    expect(saves()[0]!.project.repos).toEqual(['drey', 'smoke']);
  });

  it('creates a new project named after the others', async () => {
    host.querySelector<HTMLButtonElement>('.prj-list-head button')!.click();
    await settle();
    expect(saves()[0]).toEqual({ project: { name: 'New project', color: '#bfe3cd', repos: [], folders: [], vaults: {}, purpose: '' } });
  });
});
