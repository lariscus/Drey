import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { DreyApi, PlainFolderEntry, PlainFolderListRequest, VaultStatus } from '../../../../shared/ipc-api';
import type { WorkspaceScopeOption } from '../../../../shared/plugin-api/renderer';
import { EditorService } from '../../services/editor.service';
import { WorkspaceScopeService } from '../../views';
import { FilesPanel } from './files-panel';
import { FilesScopeState } from './files-scope';

const VAULTS: VaultStatus[] = [
  { id: 'v1', name: 'Drey notes', path: 'C:/drey', exists: true, active: true },
  { id: 'v2', name: 'Private', path: 'C:/private', exists: true, active: false },
  { id: 'v3', name: 'Work notes', path: 'C:/work', exists: true, active: false },
];

const SHARED = 'D:\\repos\\drey-shared';

function option(sources: WorkspaceScopeOption['sources']): WorkspaceScopeOption {
  return { id: 'drey', label: 'Drey', color: '#8ecbef', sources };
}

const DREY = option({
  vaults: [
    { name: 'Work notes', readOnly: true },
    { name: 'Drey notes', readOnly: false },
    { name: 'Not on this device', readOnly: false },
  ],
  folders: [SHARED],
});

/** The scope filter's active choice, set per test. */
let active: WritableSignal<WorkspaceScopeOption | null>;
let listed: PlainFolderListRequest[];
let fixture: ComponentFixture<FilesPanel>;

function installApi(listing: (request: PlainFolderListRequest) => Promise<PlainFolderEntry[]>): void {
  listed = [];
  window.dreyApi = {
    getActiveVault: () => Promise.resolve('C:/drey'),
    getActiveVaultId: () => Promise.resolve('v1'),
    listVaults: () => Promise.resolve(VAULTS),
    listVaultFiles: () => Promise.resolve([]),
    listPlainFolder: (request: PlainFolderListRequest) => {
      listed.push(request);
      return listing(request);
    },
  } as Partial<DreyApi> as DreyApi;
}

function sharedListing(request: PlainFolderListRequest): Promise<PlainFolderEntry[]> {
  return Promise.resolve(
    request.rel === ''
      ? [
          { name: 'specs', type: 'directory' },
          { name: 'schema.md', type: 'file' },
        ]
      : [{ name: 'glossary.md', type: 'file' }],
  );
}

async function render(scope: WorkspaceScopeOption | null): Promise<HTMLElement> {
  active = signal(scope);
  await TestBed.configureTestingModule({
    imports: [FilesPanel],
    providers: [{ provide: WorkspaceScopeService, useValue: { active } }],
  }).compileComponents();
  fixture = TestBed.createComponent(FilesPanel);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.vault-row')).not.toBeNull();
  });
  await settle();
  return fixture.nativeElement as HTMLElement;
}

/** Waits for every plain-folder listing, then renders. */
async function settle(): Promise<void> {
  await fixture.debugElement.injector.get(FilesScopeState).idle();
  fixture.detectChanges();
}

function vaultNames(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.vault-row:not(.folder-head) .node-name')].map((el) => el.textContent!.trim());
}

afterEach(() => {
  fixture?.nativeElement.remove();
  delete (window as { dreyApi?: unknown }).dreyApi;
});

describe('FilesPanel under the project filter (req-285)', () => {
  it('All: every vault, no summary, no read tag, no folder section', async () => {
    installApi(sharedListing);
    const host = await render(null);
    expect(vaultNames(host)).toEqual(['Drey notes', 'Private', 'Work notes']);
    expect(host.querySelector('.scope-summary')).toBeNull();
    expect(host.querySelector('.read-tag')).toBeNull();
    expect(host.querySelector('.folder-head')).toBeNull();
    expect(host.querySelector('.tree-scroll.scoped')).toBeNull();
    expect(listed).toEqual([]);
  });

  it('a choice without sources leaves Files unchanged', async () => {
    installApi(sharedListing);
    const host = await render(option(null));
    expect(vaultNames(host)).toEqual(['Drey notes', 'Private', 'Work notes']);
    expect(host.querySelector('.scope-summary')).toBeNull();
    expect(host.querySelector('.read-tag')).toBeNull();
    expect(listed).toEqual([]);
  });

  it('shows only the named vaults, in registry order, with a read tag on the read-only one', async () => {
    installApi(sharedListing);
    const host = await render(DREY);
    expect(vaultNames(host)).toEqual(['Drey notes', 'Work notes']);
    const heads = [...host.querySelectorAll<HTMLElement>('.vault-row:not(.folder-head)')];
    expect(heads[0].querySelector('.read-tag')).toBeNull();
    const tag = heads[1].querySelector('.read-tag');
    expect(tag?.textContent?.trim()).toBe('read');
    expect(tag?.getAttribute('title')).toBe('Read only for this project');
    expect(host.querySelector('.tree-scroll.scoped')).not.toBeNull();
  });

  it('draws the summary line: the label, then the vaults and folders shown', async () => {
    installApi(sharedListing);
    const host = await render(DREY);
    expect(host.querySelector('.scope-summary')?.textContent?.trim()).toBe('Drey · 2 vaults, 1 folder');
  });

  it('follows a change of the choice', async () => {
    installApi(sharedListing);
    const host = await render(DREY);
    active.set(null);
    fixture.detectChanges();
    expect(vaultNames(host)).toEqual(['Drey notes', 'Private', 'Work notes']);
    expect(host.querySelector('.scope-summary')).toBeNull();
  });

  it('lists a plain folder read-only: header with read tag, rows, lazy sub-folders, files open externally', async () => {
    installApi(sharedListing);
    const host = await render(DREY);
    const head = host.querySelector<HTMLElement>('.folder-head')!;
    expect(head.querySelector('.node-name')?.textContent?.trim()).toBe('drey-shared');
    expect(head.querySelector('.read-tag')?.textContent?.trim()).toBe('read');
    expect(listed).toEqual([{ root: SHARED, rel: '' }]);

    const rowNames = (): string[] =>
      [...host.querySelectorAll('.folder-head ~ .node:not(.section-head) .node-name')].map((el) =>
        el.textContent!.trim(),
      );
    expect(rowNames()).toEqual(['specs', 'schema.md']);
    // Nothing that writes: rows are not draggable.
    expect(host.querySelector('.folder-head ~ .node[draggable="true"]')).toBeNull();

    host.querySelector<HTMLElement>('.folder-head ~ .node.folder')!.click();
    await settle();
    expect(listed).toEqual([
      { root: SHARED, rel: '' },
      { root: SHARED, rel: 'specs' },
    ]);
    expect(rowNames()).toEqual(['specs', 'glossary.md', 'schema.md']);

    const open = vi.spyOn(TestBed.inject(EditorService), 'openExternalFile').mockResolvedValue();
    const glossary = [...host.querySelectorAll<HTMLElement>('.folder-head ~ .node.file')].find(
      (el) => el.textContent?.trim() === 'glossary.md',
    )!;
    expect(glossary.getAttribute('title')).toBe('D:\\repos\\drey-shared\\specs\\glossary.md');
    glossary.click();
    expect(open).toHaveBeenCalledWith('D:\\repos\\drey-shared\\specs\\glossary.md');
  });

  it('offers only Open and Reveal in a plain folder row menu', async () => {
    installApi(sharedListing);
    const host = await render(DREY);
    const file = host.querySelector<HTMLElement>('.folder-head ~ .node.file')!;
    file.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    fixture.detectChanges();
    const items = [...host.querySelectorAll('.ctx-menu button')].map((b) => b.textContent!.trim());
    expect(items).toEqual(['Open', 'Reveal in File Explorer']);
  });

  it('shows a muted note for a folder that does not exist', async () => {
    installApi(() => Promise.reject(new Error('ENOENT')));
    const host = await render(DREY);
    expect(host.querySelector('.folder-missing')?.textContent?.trim()).toBe('Folder not found');
    expect(host.querySelector('.folder-head ~ .node:not(.section-head)')).toBeNull();
  });
});
