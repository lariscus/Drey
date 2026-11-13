import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../contracts/projects';
import type { VaultSite } from './disk-tool-vault';
import { folderSiteIds, isAbsoluteFolder, projectAccess, reachedVaults, writableVaults } from './project-reach';

/** req-283: the pure half of a token's reach — by vault NAME, folders as written, Write only where the project says so. */
const record = (id: string, vaults: ProjectRecord['vaults'], folders: readonly string[] = []): ProjectRecord => ({ id, name: id, color: '', repos: [], folders, vaults, purpose: '' });
const PROJECTS = [record('a', { Notes: 'write', Work: 'read', Private: 'none' }, ['C:\\specs', 'D:/x/specs/']), record('b', { Work: 'write' }, ['c:/specs', 'not/absolute'])];
const site = (id: string, name: string): VaultSite => ({ id, name, path: `/v/${id}`, active: false, exists: true });

describe('projectAccess', () => {
  it("one project: its read and write vaults by name, none left out, its absolute folders", () => {
    const access = projectAccess({ kind: 'project', project: 'a' }, PROJECTS);
    expect([...access.vaults]).toEqual([['Notes', true], ['Work', false]]);
    expect(access.folders).toEqual(['C:\\specs', 'D:/x/specs/']);
  });

  it('every project: the union — Write where any project says it (the caller makes a 1:1 read-only), one folder per spelling', () => {
    const access = projectAccess({ kind: 'every-project' }, PROJECTS);
    expect(Object.fromEntries(access.vaults)).toEqual({ Notes: true, Work: true });
    expect(access.folders).toEqual(['c:/specs', 'D:/x/specs/']);
  });

  it('no project or an unknown one: nothing', () => {
    expect(projectAccess({ kind: 'project', project: null }, PROJECTS).vaults.size).toBe(0);
    expect(projectAccess({ kind: 'project', project: 'zz' }, PROJECTS).folders).toEqual([]);
  });
});

describe('the registered vaults a project reaches', () => {
  it('matches by registered name, two vaults of one name both; writes only the Write ones', () => {
    const registered = [site('v1', 'Notes'), site('v2', 'Work'), site('v3', 'Private'), site('v4', 'Notes')];
    const access = projectAccess({ kind: 'project', project: 'a' }, PROJECTS);
    const reached = reachedVaults(access, registered);
    expect(reached.map((s) => s.id)).toEqual(['v1', 'v2', 'v4']);
    expect(writableVaults(access, reached)).toEqual(['v1', 'v4']);
  });
});

describe('folder sites', () => {
  it('folder-<last segment>, unique against vault ids and each other, never a colon', () => {
    expect(folderSiteIds(['C:\\specs', 'D:/x/specs/', '/srv/Shared Drive', 'E:\\'], ['folder-specs-2'])).toEqual(['folder-specs', 'folder-specs-3', 'folder-shared-drive', 'folder-e']);
  });

  it('serves only absolute folders', () => {
    expect(['C:\\a', 'c:/a', '/srv/a'].every(isAbsoluteFolder)).toBe(true);
    expect(['a/b', './a', '', 'C:a'].some(isAbsoluteFolder)).toBe(false);
  });
});
