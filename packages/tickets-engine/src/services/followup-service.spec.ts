import { describe, expect, it, vi } from 'vitest';
import type { RunInfo } from '../fleet/protocol';
import { FollowupService } from './followup-service';

const NOW = new Date('2026-11-14T12:00:00Z');
const DRAFTS = [{ title: 'Cache the heading tree', why: 'slow', priority: null }];

function run(patch: Partial<RunInfo>): RunInfo {
  return {
    id: 'R-1',
    ticketId: 'T-0086',
    provider: 'claude-code',
    state: 'done',
    pid: null,
    startedAt: '2026-11-14T11:00:00Z',
    endedAt: '2026-11-14T11:30:00Z',
    followups: DRAFTS,
    ...patch,
  } as RunInfo;
}

function service(runs: () => RunInfo[], file = vi.fn(async () => ({ ok: true as const, file: 'f.md', filed: 1 }))) {
  const log = vi.fn();
  return { svc: new FollowupService({ runs: async () => runs(), file, log, now: () => NOW }), file, log };
}

describe('FollowupService', () => {
  it('files a done run\'s proposals once, however often the fleet changes', async () => {
    const { svc, file } = service(() => [run({})]);
    await svc.scan();
    await svc.scan();
    expect(file).toHaveBeenCalledTimes(1);
    expect(file).toHaveBeenCalledWith({ ticket: 'T-0086', runId: 'R-1', drafts: DRAFTS });
  });

  it('waits for the run to be done and skips runs without proposals', async () => {
    const { svc, file } = service(() => [
      run({ id: 'R-live', state: 'running', endedAt: null }),
      run({ id: 'R-none', followups: undefined }),
      run({ id: 'R-empty', followups: [] }),
      run({ id: 'R-failed', state: 'failed' }),
    ]);
    await svc.scan();
    expect(file).not.toHaveBeenCalled();
  });

  it('leaves history alone: a run that ended long before the service started is not filed again', async () => {
    const { svc, file } = service(() => [run({ endedAt: '2026-11-10T09:00:00Z' })]);
    await svc.scan();
    expect(file).not.toHaveBeenCalled();
  });

  it('retries a failed filing on the next notice and logs it', async () => {
    const file = vi.fn().mockResolvedValueOnce({ ok: false, error: 'no tickets vault detected' }).mockResolvedValue({ ok: true, file: 'f.md', filed: 1 });
    const { svc, log } = service(() => [run({})], file);
    await svc.scan();
    await svc.scan();
    await svc.scan();
    expect(file).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not filed: no tickets vault detected'), 'warn');
  });

  it('never rejects when the run list fails', async () => {
    const log = vi.fn();
    const svc = new FollowupService({
      runs: async () => {
        throw new Error('fleet is down');
      },
      file: vi.fn(),
      log,
      now: () => NOW,
    });
    await expect(svc.scan()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('follow-ups: fleet is down', 'warn');
  });
});
