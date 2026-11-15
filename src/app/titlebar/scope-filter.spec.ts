import { TestBed } from '@angular/core/testing';
import type { DreyApi } from '../../../shared/ipc-api';
import { WorkspaceScopeService } from '../views';
import { ScopeFilter } from './scope-filter';

describe('ScopeFilter (req-285, board 7n)', () => {
  let scope: WorkspaceScopeService;
  let managed = 0;

  beforeEach(() => {
    localStorage.clear();
    window.dreyApi = { readVaultFile: () => Promise.resolve({ content: '', modifiedMs: 1 }) } as unknown as DreyApi;
    scope = TestBed.inject(WorkspaceScopeService);
    managed = 0;
  });

  afterEach(() => {
    delete (window as { dreyApi?: unknown }).dreyApi;
    localStorage.clear();
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(ScopeFilter);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws nothing without a registered filter', () => {
    expect(render().querySelector('.sf-btn')).toBeNull();
  });

  it('shows the active choice, the menu with all, the choices, the count and Manage', () => {
    const handle = scope.register('tickets', { label: 'Project filter', allLabel: 'All projects', manageLabel: 'Manage projects…', manage: () => (managed += 1) });
    handle.setOptions([
      { id: 'drey', label: 'Drey', color: '#8ecbef', sources: { vaults: [], folders: [] } },
      { id: '_unassigned', label: 'Unassigned', color: '', count: 4, sources: null },
    ]);
    const fixture = TestBed.createComponent(ScopeFilter);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector<HTMLButtonElement>('.sf-btn')!;
    expect(button.textContent?.trim()).toBe('All projects');
    expect(button.getAttribute('aria-label')).toBe('Project filter: All projects');
    button.click();
    fixture.detectChanges();
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.sf-item')];
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['All projects', 'Drey', 'Unassigned4', 'Manage projects…']);
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true');
    rows[1]!.click();
    fixture.detectChanges();
    expect(scope.active()?.id).toBe('drey');
    expect(el.querySelector('.sf-menu')).toBeNull();
    expect(el.querySelector('.sf-btn')?.textContent?.trim()).toBe('Drey');
    el.querySelector<HTMLButtonElement>('.sf-btn')!.click();
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('.sf-item')].at(-1)!.click();
    expect(managed).toBe(1);
  });

  it('without an all-choice (SDK 1.61) the first option is in effect and the menu has no all row', () => {
    const handle = scope.register('tickets', { label: 'Project filter', manageLabel: 'Manage projects…', manage: () => (managed += 1) });
    // No options yet: nothing to show, no choice in effect.
    expect(render().querySelector('.sf-btn')).toBeNull();
    handle.setOptions([
      { id: 'drey', label: 'Drey', color: '#8ecbef', sources: { vaults: [], folders: [] } },
      { id: 'lariscus', label: 'Lariscus', color: '#f2cfae', sources: { vaults: [], folders: [] } },
    ]);
    const fixture = TestBed.createComponent(ScopeFilter);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.sf-btn')?.textContent?.trim()).toBe('Drey');
    el.querySelector<HTMLButtonElement>('.sf-btn')!.click();
    fixture.detectChanges();
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.sf-item')];
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Drey', 'Lariscus', 'Manage projects…']);
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true');
    rows[1]!.click();
    fixture.detectChanges();
    expect(scope.active()?.id).toBe('lariscus');
    expect(el.querySelector('.sf-btn')?.textContent?.trim()).toBe('Lariscus');
  });
});
