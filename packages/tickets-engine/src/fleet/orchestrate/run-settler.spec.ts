import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { settled } from './run-spec-support';
import { endTurn, harness, reportUsage, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';

/** The settle's effective cost and the run's `## Verlauf` line (costtracking, concept §4.3/§5.4) — in the store since req-176. */
describe('RunSettler — the settled cost and the Verlauf chapter', () => {
  const dirs = useTempDirs();
  /** An interactive dialog run: no gate, no move — the settle keeps the ticket where it is. */
  const dialogRequest = (over: Partial<RunRequest> = {}): RunRequest =>
    runRequest(dirs.vault, { acceptance: [], gate: 'structural', nextPhase: null, nextPhaseDir: null, interactive: 'plan', ...over });
  const lastVerlaufLine = (text: string): string | null => {
    const at = text.lastIndexOf('- { phase:');
    return at === -1 ? null : text.slice(at, text.indexOf('\n', at));
  };

  it('a settled run with usage appends its one-line Verlauf entry — the chapter is created, the entry rides the settle', async () => {
    const h = harness(dirs.fleet);
    const id = await startRun(h.sup, dialogRequest({ model: 'opus' }), 'pia');
    await reportUsage(h, id, 0, { tokensIn: 48_000, tokensOut: 6_000, costUsd: 1.17 });
    endTurn(h.adapter.handles[0]!);
    await settled(h.sup, id, 'done');
    // The fixture's clock is fixed at 12:00, so the run's dauer is 0m.
    expect(h.store.text).toContain('## Verlauf');
    expect(lastVerlaufLine(h.store.text)).toBe('- { phase: plan, persona: pia, model: opus, tokens: 54k, cost: 1.17, dauer: 0m, ausgang: handed-over }');

    // A second run appends BELOW the first — existing entries stay.
    const id2 = await startRun(h.sup, dialogRequest({ model: 'opus' }), 'pia');
    await reportUsage(h, id2, 1, { tokensIn: 10_000, tokensOut: 500 });
    endTurn(h.adapter.handles[1]!);
    await settled(h.sup, id2, 'done');
    expect(h.store.text).toContain('tokens: 54k, cost: 1.17');
    expect(lastVerlaufLine(h.store.text)).toBe('- { phase: plan, persona: pia, model: opus, tokens: 11k, cost: 0.1875, dauer: 0m, ausgang: handed-over }');
  });

  it('a zero-usage run writes no Verlauf entry and creates no chapter', async () => {
    const h = harness(dirs.fleet);
    const id = await startRun(h.sup, dialogRequest());
    endTurn(h.adapter.handles[0]!);
    await settled(h.sup, id, 'done');
    expect(h.store.text).not.toContain('## Verlauf');
  });

  it('the settled cost falls back to the price table when the provider reports none — unknown models stay null', async () => {
    const h = harness(dirs.fleet);
    const id = await startRun(h.sup, dialogRequest({ model: 'opus' }));
    // 48k opus in + 6k out → 0.72 + 0.45 = 1.17 from the table.
    await reportUsage(h, id, 0, { tokensIn: 48_000, tokensOut: 6_000 });
    endTurn(h.adapter.handles[0]!);
    await settled(h.sup, id, 'done');
    expect(h.sup.get(id)?.costUsd).toBe(1.17);

    // A provider-reported cost is never overwritten by the table.
    const id2 = await startRun(h.sup, dialogRequest({ model: 'opus' }));
    await reportUsage(h, id2, 1, { tokensIn: 48_000, tokensOut: 6_000, costUsd: 0.5 });
    endTurn(h.adapter.handles[1]!);
    await settled(h.sup, id2, 'done');
    expect(h.sup.get(id2)?.costUsd).toBe(0.5);

    // An unknown model and no provider cost: no cost is never a 0 fake.
    const id3 = await startRun(h.sup, dialogRequest({ model: 'mystery-model' }));
    await reportUsage(h, id3, 2, { tokensIn: 48_000, tokensOut: 6_000 });
    endTurn(h.adapter.handles[2]!);
    await settled(h.sup, id3, 'done');
    expect(h.sup.get(id3)?.costUsd).toBeNull();
  });
});
