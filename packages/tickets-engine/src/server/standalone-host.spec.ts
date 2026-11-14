import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VAULTS_KEY } from '../contracts/vaults';
import { ChangeHub } from './drey-port';
import { FileConfigStore } from './file-config';
import { FsEngineHost } from './standalone-host';

/** D-73: a hosted vault Drey unloaded is no vault of this host, and loading it again says so to every client. */
describe('FsEngineHost — an unloaded vault (D-73)', () => {
  let root = '';
  let vaultPath = '';
  let host: FsEngineHost;
  let events: string[] = [];

  const registry = (...folders: string[]): unknown[] => folders.map((folder, i) => ({ id: `v${i}`, name: path.basename(folder), path: folder, active: i === 0 }));

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-hosted-vault-'));
    vaultPath = path.join(root, 'tickets-vault');
    await fsp.mkdir(path.join(vaultPath, 'tickets', '_meta'), { recursive: true });
    await fsp.writeFile(path.join(vaultPath, 'tickets', '_meta', 'pipeline.md'), '---\nphases: []\n---\n');
    const hub = new ChangeHub();
    events = [];
    hub.subscribe((what) => events.push(what));
    host = new FsEngineHost(vaultPath, new FileConfigStore(path.join(root, 'config.json')), hub, () => undefined, root);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('hosts the vault while no registry was named', async () => {
    expect((await host.listVaults()).map((v) => v.id)).toEqual(['standalone']);
  });

  it('hosts the vault while the registry names its folder', async () => {
    await host.configSet(VAULTS_KEY, registry(vaultPath, path.join(root, 'other')));
    expect((await host.listVaults()).map((v) => v.id)).toEqual(['standalone']);
  });

  it('has no vault once the registry no longer names its folder, and the files stay', async () => {
    await host.configSet(VAULTS_KEY, registry(path.join(root, 'other')));
    expect(await host.listVaults()).toEqual([]);
    await expect(fsp.stat(path.join(vaultPath, 'tickets', '_meta', 'pipeline.md'))).resolves.toBeTruthy();
  });

  it('announces a board change when the registry unloads the vault, and when it loads it again', async () => {
    await host.configSet(VAULTS_KEY, registry(vaultPath));
    expect(events).toEqual([]);
    await host.configSet(VAULTS_KEY, registry(path.join(root, 'other')));
    expect(events).toEqual(['board']);
    await host.configSet(VAULTS_KEY, registry(path.join(root, 'other'), path.join(root, 'third')));
    expect(events).toEqual(['board']);
    await host.configSet(VAULTS_KEY, registry(vaultPath));
    expect(events).toEqual(['board', 'board']);
    expect((await host.listVaults()).map((v) => v.id)).toEqual(['standalone']);
  });

  it('writes other keys without a board change', async () => {
    await host.configSet('vaultId', 'x');
    expect(events).toEqual([]);
    expect(await host.configGet('vaultId')).toBe('x');
  });
});
