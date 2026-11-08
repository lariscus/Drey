import { describe, expect, it, vi } from 'vitest';
import type { SpawnFn } from '../procs';
import { modelBody, opencodeCapConfig } from './opencode-api';
import { opencodeAdapter } from './opencode';
import { collect, fakeProcess } from './worker-process.fake';

/** The OpenCode wire shapes: the model pin and the mid-run context cap. */

describe('modelBody — the OpenCode model pin (v2 shape)', () => {
  it('splits providerID/modelID at the first slash', () => {
    expect(modelBody('zai-coding-plan/glm-5.3-flash', 'go')).toEqual({
      text: 'go',
      model: { providerID: 'zai-coding-plan', modelID: 'glm-5.3-flash' },
    });
  });

  it('a pin without a slash rides as the modelID; no pin sends text only', () => {
    expect(modelBody('glm-5.3', 'go')).toEqual({ text: 'go', model: { providerID: '', modelID: 'glm-5.3' } });
    expect(modelBody(null, 'go')).toEqual({ text: 'go' });
  });
});

describe('opencodeCapConfig — the mid-run context cap (req-80)', () => {
  it('caps the pinned model with context and output together; a variant suffix drops', () => {
    expect(JSON.parse(opencodeCapConfig('zai-coding-plan/glm-5.3-flash#fast', 160_000)!)).toEqual({
      provider: { 'zai-coding-plan': { models: { 'glm-5.3-flash': { limit: { context: 160_000, output: 32_000 } } } } },
    });
    expect(JSON.parse(opencodeCapConfig('local/small', 40_000)!)).toEqual({
      provider: { local: { models: { small: { limit: { context: 40_000, output: 10_000 } } } } },
    });
  });

  it('no cap, no pin or a pin without a provider caps nothing', () => {
    expect(opencodeCapConfig('zai-coding-plan/glm-5.3-flash', 0)).toBeNull();
    expect(opencodeCapConfig(null, 160_000)).toBeNull();
    expect(opencodeCapConfig('glm-5.3', 160_000)).toBeNull();
  });

  it('the server starts with the cap in its environment and the stream says so', async () => {
    vi.useFakeTimers();
    const proc = fakeProcess();
    const spawned: Array<{ env?: Readonly<Record<string, string>> }> = [];
    const spawn: SpawnFn = (_cmd, _args, opts) => {
      spawned.push(opts);
      return proc;
    };
    const { events, start } = collect({ model: 'zai-coding-plan/glm-5.3-flash', contextCap: 160_000 });
    opencodeAdapter(spawn, async () => ({ ok: false, status: 503 }) as Response, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(100);
    expect(spawned[0]?.env?.['OPENCODE_CONFIG_CONTENT']).toBe(opencodeCapConfig('zai-coding-plan/glm-5.3-flash', 160_000));
    expect(events.some((e) => e.kind === 'note' && (e.text ?? '').startsWith('context cap: 160000'))).toBe(true);
    proc.exit(null);
    vi.useRealTimers();
  });
});
