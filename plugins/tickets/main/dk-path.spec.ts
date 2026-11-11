import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledDkPath, resolveDkPath, withEffectiveDkPath, type DkRuntime } from './dk-path';

const RES = path.join('C:', 'Program Files', 'drey', 'resources');
const BUNDLED = path.join(RES, 'dk', 'dk.exe');

function runtime(overrides: Partial<DkRuntime> = {}): DkRuntime {
  return { packaged: true, resourcesPath: RES, platform: 'win32', exists: (file) => file === BUNDLED, ...overrides };
}

describe('bundledDkPath', () => {
  it('is <resources>/dk/dk.exe on Windows and dk elsewhere', () => {
    expect(bundledDkPath(RES, 'win32')).toBe(BUNDLED);
    expect(bundledDkPath('/opt/drey/resources', 'linux')).toBe(path.join('/opt/drey/resources', 'dk', 'dk'));
  });
});

describe('resolveDkPath', () => {
  it('a configured path wins, even when the bundled one exists', () => {
    expect(resolveDkPath('D:/tools/dk.exe', runtime())).toBe('D:/tools/dk.exe');
    expect(resolveDkPath('  D:/tools/dk.exe  ', runtime())).toBe('D:/tools/dk.exe');
  });

  it('packaged without a configured path takes the bundled binary', () => {
    expect(resolveDkPath('', runtime())).toBe(BUNDLED);
    expect(resolveDkPath('   ', runtime())).toBe(BUNDLED);
  });

  it('a packaged build whose binary is missing falls back to PATH', () => {
    expect(resolveDkPath('', runtime({ exists: () => false }))).toBe('');
  });

  it('a build that is not packaged uses PATH, bundled file or not', () => {
    expect(resolveDkPath('', runtime({ packaged: false }))).toBe('');
    expect(resolveDkPath('', runtime({ packaged: false, exists: () => true }))).toBe('');
  });

  it('an empty resources path is no bundle', () => {
    expect(resolveDkPath('', runtime({ resourcesPath: '' }))).toBe('');
  });
});

describe('withEffectiveDkPath', () => {
  const store: Record<string, unknown> = { backend: 'dricket', 'dk.store': 'E:/store' };
  const config = { get: <T,>(key: string): Promise<T | undefined> => Promise.resolve(store[key] as T | undefined) };

  it('resolves dk.path when the config holds none and reads the other keys through', async () => {
    const effective = withEffectiveDkPath(config, runtime());
    expect(await effective.get<string>('dk.path')).toBe(BUNDLED);
    expect(await effective.get<string>('backend')).toBe('dricket');
    expect(await effective.get<string>('dk.checkout')).toBeUndefined();
  });

  it('keeps a configured dk.path', async () => {
    const effective = withEffectiveDkPath({ get: async <T,>(key: string) => (key === 'dk.path' ? ('D:/dk.exe' as T) : undefined) }, runtime());
    expect(await effective.get<string>('dk.path')).toBe('D:/dk.exe');
  });

  it('tolerates a non-text value', async () => {
    const effective = withEffectiveDkPath({ get: async <T,>() => 42 as T }, runtime({ packaged: false }));
    expect(await effective.get<string>('dk.path')).toBe('');
  });
});
