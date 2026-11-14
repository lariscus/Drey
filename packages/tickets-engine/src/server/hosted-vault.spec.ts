import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VAULTS_KEY } from '../contracts/vaults';
import { HostedVault } from './hosted-vault';

const HOSTED = path.resolve('tickets-vault');

function hosted(registered: unknown): HostedVault {
  return new HostedVault(HOSTED, { get: async <T>(key: string) => (key === VAULTS_KEY ? (registered as T | undefined) : undefined) });
}

const entry = (id: string, folder: string, active = false): Record<string, unknown> => ({ id, name: id, path: folder, active });

describe('HostedVault (D-73)', () => {
  it('is loaded while no registry was ever named', async () => {
    expect(await hosted(undefined).loaded()).toBe(true);
  });

  it('is loaded while its folder is one of the registered vaults', async () => {
    expect(await hosted([entry('a', path.resolve('notes')), entry('b', HOSTED)]).loaded()).toBe(true);
  });

  it('is unloaded once its folder left the registry', async () => {
    expect(await hosted([entry('a', path.resolve('notes'))]).loaded()).toBe(false);
  });

  it('is unloaded when the registry is empty', async () => {
    expect(await hosted([]).loaded()).toBe(false);
  });

  it('finds the folder whatever the spelling of its path', async () => {
    const spelled = path.join(HOSTED, '..', 'tickets-vault', '.');
    expect(await hosted([entry('b', spelled)]).loaded()).toBe(true);
  });

  it('matches the case of a folder on Windows only', async () => {
    const upper = HOSTED.toUpperCase();
    expect(await hosted([entry('b', upper)]).loaded()).toBe(process.platform === 'win32');
  });

  it('reads a failing config as "no registry named"', async () => {
    const failing = new HostedVault(HOSTED, { get: () => Promise.reject(new Error('unreadable')) });
    expect(await failing.loaded()).toBe(true);
  });
});
