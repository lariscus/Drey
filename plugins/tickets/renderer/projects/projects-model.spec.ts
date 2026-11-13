import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { colorOf, folderLabel, freshColor, newProjectName, presetOf, repoChoices, ticketCounts, vaultRowsOf, withVaultAccess } from './projects-model';

const project = (over: Partial<ProjectRecord> = {}): ProjectRecord => ({ id: 'drey', name: 'Drey', color: '#8ecbef', repos: ['drey'], folders: [], vaults: {}, purpose: '', ...over });

describe('projects-model (req-284)', () => {
  it('counts the open tickets per project; one project takes the tickets that name none', () => {
    const tickets = [{ meta: { project: 'drey' } }, { meta: {} }, { meta: { project: 'lariscus' } }];
    expect([...ticketCounts(tickets, [project()])]).toEqual([['drey', 2], ['lariscus', 1]]);
    expect([...ticketCounts(tickets, [project(), project({ id: 'lariscus' })])]).toEqual([['drey', 1], ['lariscus', 1]]);
  });

  it('lists the registered vaults, then the record names this device lacks as not on this device', () => {
    const rows = vaultRowsOf(project({ vaults: { 'Drey notes': 'write', 'Lariscus notes': 'read' } }), ['Drey notes', 'Private']);
    expect(rows).toEqual([
      { name: 'Drey notes', access: 'write', notOnDevice: false },
      { name: 'Private', access: 'none', notOnDevice: false },
      { name: 'Lariscus notes', access: 'read', notOnDevice: true },
    ]);
  });

  it('offers the repositories the project does not list', () => {
    expect(repoChoices(['drey', 'lariscus', 'smoke'], ['drey'])).toEqual(['lariscus', 'smoke']);
  });

  it('sets a vault access; None on a vault the record never named changes nothing', () => {
    expect(withVaultAccess({}, 'Private', 'none')).toEqual({});
    expect(withVaultAccess({}, 'Private', 'read')).toEqual({ Private: 'read' });
    expect(withVaultAccess({ Private: 'read' }, 'Private', 'none')).toEqual({ Private: 'none' });
  });

  it('names and colours a new project after the existing ones', () => {
    expect(newProjectName('New project', ['Drey', 'new project'])).toBe('New project 2');
    expect(freshColor([project(), project({ color: '' })])).toBe('#f2cfae');
  });

  it('reads colours, presets and folder labels', () => {
    expect(colorOf(project({ color: '' }))).toBe('#8ecbef');
    expect(presetOf('#BFE3CD')?.label).toBe('projects.color.green');
    expect(presetOf('#123456')).toBeNull();
    expect(folderLabel('E:\\specs\\drey-shared\\')).toBe('drey-shared');
  });
});
