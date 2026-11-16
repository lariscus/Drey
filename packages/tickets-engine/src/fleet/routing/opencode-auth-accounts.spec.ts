import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { OpencodeAuthAccounts } from './opencode-auth-accounts';

const FILE = '/home/u/.local/share/opencode/auth.json';

describe('OpencodeAuthAccounts — the accounts opencode is signed in to', () => {
  it('returns the top-level key names of auth.json and nothing else', async () => {
    const fs = new MemoryFileSystem();
    fs.files.set(FILE, JSON.stringify({ 'zai-coding-plan': { type: 'api', key: 'sk-secret-1' }, openai: { type: 'oauth', refresh: 'sk-secret-2' } }));
    const names = await new OpencodeAuthAccounts(fs, FILE).names();
    expect(names).toEqual(['zai-coding-plan', 'openai']);
    expect(JSON.stringify(names)).not.toContain('secret');
  });

  it('a missing, unparsable or non-object file has no accounts', async () => {
    const fs = new MemoryFileSystem();
    const accounts = new OpencodeAuthAccounts(fs, FILE);
    expect(await accounts.names()).toEqual([]);
    fs.files.set(FILE, '{ broken');
    expect(await accounts.names()).toEqual([]);
    fs.files.set(FILE, '["zai"]');
    expect(await accounts.names()).toEqual([]);
    fs.files.set(FILE, '{}');
    expect(await accounts.names()).toEqual([]);
  });
});
