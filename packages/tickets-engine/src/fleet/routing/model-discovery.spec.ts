import { describe, expect, it } from 'vitest';
import type { ModelRow, ProbeOutcome, WorkerProviderId } from '../protocol';
import { ModelDiscovery, type HarnessProbe, type SavedDiscovery } from './model-discovery';
import type { ImportOutcome } from './models-dev-import';
import { PoolSettingsRegistry } from './pool-settings';
import { FakeClock, slot } from './routing.fake';
import type { Slot } from './slot';

const NOW = new Date('2026-11-13T10:00:00Z');
const SLOTS: Slot[] = [slot({ id: 'claude-a', label: 'Claude A' }), slot({ id: 'zai', label: 'z.ai', provider: 'opencode', login: { opencodeAuthEntry: 'zai-coding-plan' } })];

function probe(provider: WorkerProviderId, label: string, outcome: ProbeOutcome | (() => Promise<ProbeOutcome>)): HarnessProbe & { calls: number } {
  const p = { provider, label, calls: 0, probe: async (): Promise<ProbeOutcome> => (p.calls++, typeof outcome === 'function' ? outcome() : outcome) };
  return p;
}

const CLAUDE: ProbeOutcome = {
  installed: true,
  version: '2.1.319',
  signedIn: true,
  models: [
    { model: 'claude-fable-5-2', name: 'Fable 5.2' },
    { model: 'claude-opus-5-5', name: 'Opus 5.5' },
  ],
  error: null,
};
const OPENCODE: ProbeOutcome = { installed: true, version: '2.0.32', signedIn: true, models: [{ model: 'zai-coding-plan/glm-5.3-air', name: null }, { model: 'github-copilot/gpt-5.4', name: null }], error: null };
const KIMI_OUT: ProbeOutcome = { installed: true, version: '2.5.2', signedIn: false, models: [], error: null };
const COPILOT: ProbeOutcome = { installed: false, version: null, signedIn: null, models: [], error: null };

class Rig {
  saved: SavedDiscovery | null = null;
  readonly settings = new PoolSettingsRegistry(() => undefined);
  registryCalls = 0;
  registry: (rows: readonly ModelRow[]) => ImportOutcome = (rows) => ({ ok: true, rows: rows.map((row) => ({ ...row, context: 1_000_000, tools: true })), filled: [], unmatched: [] });
  readonly discovery: ModelDiscovery;

  constructor(probes: readonly HarnessProbe[], root: Record<string, unknown> = {}) {
    this.settings.apply(root, SLOTS, null);
    this.discovery = new ModelDiscovery({
      probes,
      file: { read: async () => this.saved, write: async (saved) => void (this.saved = saved) },
      settings: this.settings,
      slots: () => SLOTS,
      ignored: () => this.settings.ignored(),
      registry: { fill: async (rows) => (this.registryCalls++, this.registry(rows)) },
      clock: new FakeClock(NOW),
      log: () => undefined,
    });
  }
}

describe('ModelDiscovery — what the harnesses offer (req-286)', () => {
  it('a check asks every harness: the rows, the providers an ACP harness serves through, the new-model cards', async () => {
    const rig = new Rig([probe('claude-code', 'Claude Code', CLAUDE), probe('opencode', 'opencode', OPENCODE), probe('kimi', 'Kimi CLI', KIMI_OUT), probe('copilot', 'Copilot CLI', COPILOT)]);
    await rig.discovery.check(false);
    const report = rig.discovery.report();
    expect(report.checkedAt).toBe(NOW.toISOString());
    expect(report.harnesses.map((h) => [h.label, h.version, h.state, h.providers, h.models])).toEqual([
      ['Claude Code', '2.1.319', 'signed-in', [], 2],
      ['opencode', '2.0.32', 'signed-in', ['zai-coding-plan', 'github-copilot'], 2],
      ['Kimi CLI', '2.5.2', 'signed-out', [], 0],
      ['Copilot CLI', null, 'not-installed', [], 0],
    ]);
    expect(report.found.map((m) => [m.model, m.provider, m.slot, m.suggested])).toEqual([
      ['claude-fable-5-2', 'claude-code', null, 'super heavy'],
      ['claude-opus-5-5', 'claude-code', null, 'heavy'],
      ['zai-coding-plan/glm-5.3-air', 'opencode', 'zai', 'light'],
      ['github-copilot/gpt-5.4', 'opencode', null, 'standard'],
    ]);
    expect(rig.registryCalls).toBe(0);
    expect(rig.saved?.offered).toHaveLength(4);
  });

  it('a model the table holds or the owner ignored has no card', async () => {
    const root = { models: [{ model: 'claude-opus-5-5', provider: 'claude-code', class: 'heavy' }], discovery: { ignored: ['claude-code:claude-fable-5-2'] } };
    const rig = new Rig([probe('claude-code', 'Claude Code', CLAUDE)], root);
    await rig.discovery.check(false);
    expect(rig.discovery.report().found).toEqual([]);
    expect(rig.discovery.report().ignored).toEqual(['claude-code:claude-fable-5-2']);
  });

  it('Find models again fills the capabilities from the registry; a later check without it keeps them', async () => {
    const rig = new Rig([probe('claude-code', 'Claude Code', CLAUDE)]);
    expect((await rig.discovery.check(true)).registryError).toBeNull();
    expect(rig.discovery.offered('claude-code', 'claude-opus-5-5')?.capabilities).toEqual({ tools: true, context: 1_000_000 });
    await rig.discovery.check(false);
    expect(rig.discovery.offered('claude-code', 'claude-opus-5-5')?.capabilities).toEqual({ tools: true, context: 1_000_000 });
    expect(rig.registryCalls).toBe(1);
  });

  it("the registry's refusal is said; the harnesses' answer stands", async () => {
    const rig = new Rig([probe('claude-code', 'Claude Code', CLAUDE)]);
    rig.registry = () => ({ ok: false, error: 'models.dev answered nothing' });
    expect((await rig.discovery.check(true)).registryError).toBe('models.dev answered nothing');
    expect(rig.discovery.report().found).toHaveLength(2);
  });

  it('a probe that throws is a failed row; a check already running is joined, not started twice', async () => {
    let release: (o: ProbeOutcome) => void = () => undefined;
    const slow = probe('claude-code', 'Claude Code', () => new Promise<ProbeOutcome>((resolve) => (release = resolve)));
    const broken = probe('kimi', 'Kimi CLI', () => Promise.reject(new Error('spawn EPERM')));
    const rig = new Rig([slow, broken]);
    const first = rig.discovery.check(false);
    const second = rig.discovery.check(false);
    expect(rig.discovery.report().running).toBe(true);
    release(CLAUDE);
    await Promise.all([first, second]);
    expect(slow.calls).toBe(1);
    expect(rig.discovery.report().harnesses[1]).toMatchObject({ state: 'failed', error: 'spawn EPERM' });
    expect(rig.discovery.report().running).toBe(false);
  });

  it('the last check comes back after a restart', async () => {
    const rig = new Rig([probe('claude-code', 'Claude Code', CLAUDE)]);
    rig.saved = { checkedAt: '2026-11-12T08:00:00.000Z', harnesses: [], offered: [{ model: 'm', provider: 'kimi', slot: null, name: null, capabilities: {}, suggested: 'light' }] };
    await rig.discovery.load();
    expect(rig.discovery.report()).toMatchObject({ checkedAt: '2026-11-12T08:00:00.000Z', found: [{ model: 'm' }] });
  });
});
