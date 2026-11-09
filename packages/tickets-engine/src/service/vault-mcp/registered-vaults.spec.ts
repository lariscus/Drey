import { describe, expect, it } from 'vitest';
import { parseRegisteredVaults } from '../../contracts/vaults';
import { RegisteredVaults } from './registered-vaults';

/** req-167: the vaults a worker reaches — Drey's registry from the engine config, else the service's own vault. */
describe('RegisteredVaults (req-167)', () => {
  const disk = { isFolder: async (abs: string) => abs !== 'E:/gone' };

  it("reads Drey's registry from the config key and marks a missing folder", async () => {
    const config = { get: async <T>() => [{ id: 'notes', name: 'Notes', path: 'E:/notes', active: true }, { id: 'gone', name: 'Gone', path: 'E:/gone', active: false }] as T };
    expect(await new RegisteredVaults(config, 'E:/hosted', disk).current()).toEqual([
      { id: 'notes', name: 'Notes', path: 'E:/notes', active: true, exists: true },
      { id: 'gone', name: 'Gone', path: 'E:/gone', active: false, exists: false },
    ]);
  });

  it('serves the vault the service was started for when Drey never named any', async () => {
    const config = { get: async <T>() => undefined as T };
    expect(await new RegisteredVaults(config, 'E:\\vaults\\mine', disk).current()).toEqual([{ id: 'vault', name: 'mine', path: 'E:\\vaults\\mine', active: true, exists: true }]);
  });

  it('leaves out what is malformed', () => {
    expect(parseRegisteredVaults([{ id: 'a', path: 'E:/a' }, { id: '', path: 'E:/b' }, { path: 'E:/c' }, 'x', null])).toEqual([{ id: 'a', name: 'a', path: 'E:/a', active: false }]);
    expect(parseRegisteredVaults('nope')).toEqual([]);
  });
});
