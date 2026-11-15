import { TestBed } from '@angular/core/testing';
import type { DreyApi } from '../../../shared/ipc-api';
import type { WorkspaceScopeOption } from '../../../shared/plugin-api/renderer';
import { ViewService } from './view.service';
import { WorkspaceScopeService } from './workspace-scope.service';

const DREY: WorkspaceScopeOption = { id: 'drey', label: 'Drey', color: '#8ecbef', sources: { vaults: [{ name: 'Drey notes', readOnly: false }], folders: [] } };
const LARISCUS: WorkspaceScopeOption = { id: 'lariscus', label: 'Lariscus', color: '#f2cfae', sources: { vaults: [], folders: [] } };
const CONTRIB = { label: 'Project filter', allLabel: 'All projects' };

describe('WorkspaceScopeService (SDK 1.59, req-285)', () => {
  let views: ViewService;
  let scope: WorkspaceScopeService;

  beforeEach(() => {
    localStorage.clear();
    window.dreyApi = { readVaultFile: () => Promise.resolve({ content: '', modifiedMs: 1 }) } as unknown as DreyApi;
    views = TestBed.inject(ViewService);
    scope = TestBed.inject(WorkspaceScopeService);
  });

  afterEach(() => {
    delete (window as { dreyApi?: unknown }).dreyApi;
    localStorage.clear();
  });

  it('has no filter and no choice until a plugin registers one', () => {
    expect(scope.contrib()).toBeNull();
    scope.pick('drey');
    expect(scope.active()).toBeNull();
  });

  it('keeps the choice per view, and a new view starts with its source view’s', () => {
    const handle = scope.register('tickets', CONTRIB);
    handle.setOptions([DREY, LARISCUS]);
    scope.pick('drey');
    expect(scope.active()?.id).toBe('drey');
    const other = views.saveCurrentAs('Lariscus view');
    expect(scope.active()?.id).toBe('drey');
    scope.pick('lariscus');
    expect(scope.active()?.id).toBe('lariscus');
    views.switchTo('notes');
    expect(scope.active()?.id).toBe('drey');
    views.switchTo(other);
    expect(scope.active()?.id).toBe('lariscus');
  });

  it('persists the choices, and reads a choice whose option went away as all', () => {
    const handle = scope.register('tickets', CONTRIB);
    handle.setOptions([DREY, LARISCUS]);
    scope.pick('lariscus');
    expect(JSON.parse(localStorage.getItem('drey.views.scope') ?? '{}')).toEqual({ views: { notes: 'lariscus' } });
    handle.setOptions([DREY]);
    expect(scope.active()).toBeNull();
    expect(scope.chosenId()).toBe('lariscus');
    scope.pick(null);
    expect(JSON.parse(localStorage.getItem('drey.views.scope') ?? '{}')).toEqual({ views: {} });
  });

  it('without an all-choice (SDK 1.61) the first option is in effect, for a new view and for a choice whose option went away', () => {
    const handle = scope.register('tickets', { label: 'Project filter' });
    handle.setOptions([DREY, LARISCUS]);
    expect(scope.active()?.id).toBe('drey');
    scope.pick('lariscus');
    expect(scope.active()?.id).toBe('lariscus');
    // The option goes away: the kept id reads as the first option until it comes back.
    handle.setOptions([DREY]);
    expect(scope.chosenId()).toBe('lariscus');
    expect(scope.active()?.id).toBe('drey');
    // A second view with no stored choice of its own starts on the first option too.
    const other = views.saveCurrentAs('Second');
    views.switchTo(other);
    expect(scope.active()?.id).toBe('drey');
  });

  it('without an all-choice and without options there is no choice in effect', () => {
    const handle = scope.register('tickets', { label: 'Project filter' });
    handle.setOptions([]);
    expect(scope.active()).toBeNull();
  });

  it('refuses a second registration and drops a deleted view’s choice', async () => {
    const handle = scope.register('tickets', CONTRIB);
    const second = scope.register('other', { label: 'x', allLabel: 'y' });
    second.setOptions([LARISCUS]);
    expect(scope.contrib()).toBe(CONTRIB);
    handle.setOptions([DREY]);
    const id = views.saveCurrentAs('Temp');
    scope.pick('drey');
    await views.remove(id);
    expect(JSON.parse(localStorage.getItem('drey.views.scope') ?? '{}').views[id]).toBeUndefined();
  });

  it('tells listeners when the choice changes, not when nothing did', () => {
    const handle = scope.register('tickets', CONTRIB);
    handle.setOptions([DREY, LARISCUS]);
    TestBed.tick();
    const seen: (string | null)[] = [];
    scope.onChange(() => seen.push(scope.active()?.id ?? null));
    scope.pick('drey');
    TestBed.tick();
    handle.setOptions([DREY, LARISCUS]);
    TestBed.tick();
    scope.pick(null);
    TestBed.tick();
    expect(seen).toEqual(['drey', null]);
  });

  it('forgets the filter when the plugin disposes it', () => {
    const handle = scope.register('tickets', CONTRIB);
    handle.setOptions([DREY]);
    handle.dispose();
    expect(scope.contrib()).toBeNull();
    expect(scope.choices()).toEqual([]);
  });
});
