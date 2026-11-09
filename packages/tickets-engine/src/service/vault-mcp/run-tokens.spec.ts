import { describe, expect, it } from 'vitest';
import { RunTokens, type TokenCrypto, type VaultGrant } from './run-tokens';

/** req-167: one token per worker, hashed at rest, dead when revoked. */
function store(): { tokens: RunTokens; hashed: string[] } {
  let n = 0;
  const hashed: string[] = [];
  const crypto: TokenCrypto = {
    token: () => `tok-${++n}`,
    hash: (token) => {
      hashed.push(token);
      return `h(${token})`;
    },
  };
  return { tokens: new RunTokens(crypto), hashed };
}

const grant = (runId: string): VaultGrant => ({ runId, ticketId: 'T-1', persona: 'ben', readOnly: false, emit: () => undefined });

describe('RunTokens (req-167)', () => {
  it('mints a fresh token per worker and resolves it to its grant', () => {
    const { tokens } = store();
    const a = tokens.mint(grant('run-a'));
    const b = tokens.mint(grant('run-b'));
    expect(a).not.toBe(b);
    expect(tokens.resolve(a)?.grant.runId).toBe('run-a');
    expect(tokens.resolve(b)?.grant.runId).toBe('run-b');
    expect(tokens.live).toBe(2);
  });

  it('keeps only hashes: a token is looked up through its hash', () => {
    const { tokens, hashed } = store();
    const a = tokens.mint(grant('run-a'));
    tokens.resolve(a);
    expect(hashed).toEqual([a, a]);
  });

  it('a revoked, unknown or empty token resolves to nothing', () => {
    const { tokens } = store();
    const a = tokens.mint(grant('run-a'));
    tokens.revoke(a);
    expect(tokens.resolve(a)).toBeNull();
    expect(tokens.resolve('tok-99')).toBeNull();
    expect(tokens.resolve('')).toBeNull();
    expect(tokens.live).toBe(0);
  });

  it('each session keeps its own record of what its worker read', () => {
    const { tokens } = store();
    const a = tokens.resolve(tokens.mint(grant('run-a')))!;
    const b = tokens.resolve(tokens.mint(grant('run-b')))!;
    a.reads.saw('notes', 'a.md', 5);
    expect(a.reads.refusal('notes', 'a.md', 6)).toContain('changed on disk since you read it');
    expect(b.reads.refusal('notes', 'a.md', 6)).toBeNull();
  });
});
