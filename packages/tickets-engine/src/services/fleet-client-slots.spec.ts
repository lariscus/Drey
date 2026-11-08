import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeQuotaHttp } from '../fleet/routing/routing.fake';
import { startRunner, type RunnerHandle } from '../fleet/runner';
import { FleetClient } from './fleet-client';

/** The engine's read of the slots (req-177) against the real runner, in-process; no network. */
describe('FleetClient — the slots', () => {
  let tmp = '';
  let runner: RunnerHandle | null = null;
  let awake = true;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-client-slots-'));
    awake = true;
    runner = await startRunner(
      { root: path.join(tmp, 'fleet'), idleMs: 60 * 60_000 },
      { exit: () => undefined, stdout: () => undefined, signals: false, userHome: path.join(tmp, 'home'), quotaHttp: new FakeQuotaHttp(() => ({ status: 500, body: null })) },
    );
  });

  afterEach(async () => {
    await runner?.stop();
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  });

  const client = (): FleetClient =>
    new FleetClient({
      root: path.join(tmp, 'fleet'),
      runner: { current: () => Promise.resolve(awake ? runner!.descriptor : null), wake: () => Promise.resolve({ ok: false, error: 'asleep in this spec' }) },
      log: () => undefined,
      onFleetChanged: () => undefined,
    });

  it('reads every slot, and the chain status carries the summary', async () => {
    const fleet = client();
    const reply = await fleet.slots();
    expect(reply?.slots.map((s) => s.id)).toEqual(['opencode', 'claude-code', 'kimi']);
    expect(reply?.configPath).toBe(path.join(tmp, 'service.json'));
    expect((await fleet.chainStatus())?.slots?.map((s) => s.id)).toEqual(['opencode', 'claude-code', 'kimi']);
    fleet.dispose();
  });

  it('writes the slots and clears a needs login through the runner', async () => {
    const fleet = client();
    const written = await fleet.writeSlots([{ id: 'claude-a', label: 'Claude A', provider: 'claude-code', login: { claudeConfigDir: path.join(tmp, 'a') } }]);
    expect(written.ok && written.slots.map((s) => s.id)).toEqual(['claude-a', 'opencode', 'kimi']);
    expect(await fleet.slotLoginDone('claude-a')).toMatchObject({ ok: true, slot: { id: 'claude-a' } });
    expect((await fleet.refreshSlots('claude-a')).ok).toBe(true);
    expect(await fleet.writeSlots([{ id: 'x', provider: 'copilot' }])).toMatchObject({ ok: false });
    fleet.dispose();
  });

  it('a read never wakes a sleeping runner: no slots then', async () => {
    awake = false;
    expect(await client().slots()).toBeNull();
  });
});
