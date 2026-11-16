import { describe, expect, it } from 'vitest';
import { WORKER_PROVIDERS } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { RUNNER_FIELDS, RUNNER_LABEL } from './settings-workers';

const keysOf = (provider: keyof typeof RUNNER_FIELDS): string[] => RUNNER_FIELDS[provider].map((f) => f.key);
const fieldOf = (provider: keyof typeof RUNNER_FIELDS, kind: string) => RUNNER_FIELDS[provider].find((f) => f.kind === kind);

describe('RUNNER_FIELDS (req-71)', () => {
  it('has a section and a label for every worker provider', () => {
    expect(Object.keys(RUNNER_FIELDS).sort()).toEqual([...WORKER_PROVIDERS].sort());
    expect(Object.keys(RUNNER_LABEL).sort()).toEqual([...WORKER_PROVIDERS].sort());
  });

  it('writes the compact override of the vault layer per provider (req-173), and no pool size (the slots hold it, req-186)', () => {
    for (const provider of WORKER_PROVIDERS) {
      expect(keysOf(provider).some((key) => key.endsWith('.size'))).toBe(false);
      expect(fieldOf(provider, 'compact')?.key).toBe(provider);
    }
  });

  it('offers the pool probe only for OpenCode — a machine key of the plugin config', () => {
    expect(fieldOf('opencode', 'text')?.key).toBe('fleet.pool.opencode.probe');
    expect(keysOf('claude-code').some((k) => k.endsWith('.probe'))).toBe(false);
  });

  it("offers the dispatched-run permissions only for Claude Code, on the vault layer's permission-mode (req-173)", () => {
    const field = fieldOf('claude-code', 'permission');
    expect(field?.key).toBe('permissionMode');
    expect(fieldOf('opencode', 'permission')).toBeUndefined();
    expect(field?.choices?.map(([value]) => value)).toEqual(['accept-edits', 'bypass']);
  });

  it('gives Kimi Code a compact override, and no probe or permission flag of its own', () => {
    expect(RUNNER_LABEL.kimi).toBe('Kimi Code');
    expect(RUNNER_FIELDS.kimi.map((f) => f.kind)).toEqual(['compact']);
  });

  it('keeps control ids unique across all runners', () => {
    const ids = WORKER_PROVIDERS.flatMap((p) => RUNNER_FIELDS[p].map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
