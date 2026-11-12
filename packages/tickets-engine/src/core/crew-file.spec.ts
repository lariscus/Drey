import { describe, expect, it } from 'vitest';
import { CREW_FIELDS } from '../contracts/crew-config';
import { parseCrewFile } from './crew-file';
import { CREW_PROSE, patchCrewFile } from './crew-file-write';

const FILE = `---
default-persona: ben
default-worker: claude-code
permission-mode: bypass
caps:
  gate-failure-lines: 20
handover:
  resume-pause-ttl-min: 12
  compact-above-tokens-by:
    claude-code: 90000
tranche:
  runs: off
  early-stop:
    red-gates: 4
memory:
  signals: [red-gate, retry]
---
Our notes.
`;

describe('crew.md (req-173, the vault layer)', () => {
  it('maps every key to its kebab path and its legacy flat key', () => {
    const byKey = Object.fromEntries(CREW_FIELDS.map((f) => [f.key, f]));
    expect(byKey['caps.gateFailureLines']).toMatchObject({ path: ['caps', 'gate-failure-lines'], legacy: 'fleet.cap.gateFailureLines', kind: 'count' });
    expect(byKey['tranche.earlyStop.minRuns']).toMatchObject({ path: ['tranche', 'early-stop', 'min-runs'], legacy: 'autopilot.earlyStop.minRuns', kind: 'limit' });
    expect(byKey['handover.resumePauseTtlMin']!.legacy).toBe('fleet.resumePauseTtlMin');
    expect(byKey['defaultPersona']!.legacy).toBe('personas.default');
    expect(byKey['permissionMode']!.legacy).toBe('autoPermissionMode');
  });

  it('reads the keys it knows, off as null, and the overrides', () => {
    const { config, error, warnings } = parseCrewFile(FILE);
    expect(error).toBeNull();
    expect(warnings).toEqual(['crew.md: default-persona is retired (req-257) — it is read and never used; a chain entry says who works a ticket']);
    expect(config.values).toEqual({
      defaultPersona: 'ben',
      defaultWorker: 'claude-code',
      permissionMode: 'bypass',
      'caps.gateFailureLines': 20,
      'handover.resumePauseTtlMin': 12,
      'tranche.runs': null,
      'tranche.earlyStop.redGates': 4,
    });
    expect(config.overrides.compactAboveTokensBy).toEqual({ 'claude-code': 90000 });
  });

  it('drops a value of the wrong kind with a warning, and an absent file is empty', () => {
    const parsed = parseCrewFile('---\npermission-mode: read-only\ncaps:\n  diff-stat-lines: -3\n---\n');
    expect(parsed.config.values).toEqual({});
    expect(parsed.warnings).toHaveLength(2);
    expect(parseCrewFile(null).config.values).toEqual({});
  });

  it('reports a file that does not parse instead of guessing', () => {
    expect(parseCrewFile('---\ncaps: [\n---\n').error).toMatch(/does not parse/);
  });

  it('patches in place: other keys, the memory key of req-169 and the prose stay', () => {
    const out = patchCrewFile(FILE, [
      { key: 'defaultWorker', value: 'kimi' },
      { key: 'caps.gateFailureLines', value: undefined },
      { key: 'tranche.minutes', value: null },
    ]);
    expect(out.ok).toBe(true);
    const text = out.ok ? out.text : '';
    expect(text).toContain('memory:\n  signals: [ red-gate, retry ]');
    expect(text.endsWith('Our notes.\n')).toBe(true);
    expect(text).not.toContain('caps:');
    const parsed = parseCrewFile(text).config.values;
    expect(parsed.defaultWorker).toBe('kimi');
    expect(parsed['tranche.minutes']).toBeNull();
    expect(parsed['caps.gateFailureLines']).toBeUndefined();
  });

  it('writes a fresh file with a fence and the default prose', () => {
    const out = patchCrewFile(null, [{ key: 'defaultPersona', value: 'paul' }]);
    expect(out).toEqual({ ok: true, text: `---\ndefault-persona: paul\n---\n\n${CREW_PROSE}` });
    const emptied = patchCrewFile(out.ok ? out.text : null, [{ key: 'defaultPersona', value: undefined }]);
    expect(emptied.ok && parseCrewFile(emptied.text).config.values).toEqual({});
  });

  it('refuses an invalid value and a file it cannot parse', () => {
    expect(patchCrewFile(null, [{ key: 'permissionMode', value: 'read-only' }]).ok).toBe(false);
    expect(patchCrewFile('---\ncaps: [\n---\n', [{ key: 'defaultWorker', value: 'kimi' }]).ok).toBe(false);
  });

  it('sets and removes an override', () => {
    const out = patchCrewFile(null, [], [{ map: 'contextCapTokensBy', name: 'opencode', value: 64000 }]);
    expect(out.ok && parseCrewFile(out.text).config.overrides.contextCapTokensBy).toEqual({ opencode: 64000 });
  });
});
