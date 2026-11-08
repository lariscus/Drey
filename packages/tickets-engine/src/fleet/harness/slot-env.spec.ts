import { describe, expect, it } from 'vitest';
import type { SpawnFn } from '../ports/process-spawner';
import { claudeCodeAdapter } from './claude-code';
import type { ProviderStart } from './contract';
import { ContractProcess } from './contract-process.fake';
import { kimiAdapter } from './kimi';

/** The spawn options each start was given. */
function recording(): { spawnFn: SpawnFn; opts: Parameters<SpawnFn>[2][] } {
  const opts: Parameters<SpawnFn>[2][] = [];
  const proc = new ContractProcess();
  return {
    opts,
    spawnFn: (cmd, args, options) => {
      opts.push(options);
      return proc.spawnFn()(cmd, args, options);
    },
  };
}

const start = (over: Partial<ProviderStart> = {}): ProviderStart => ({
  cwd: 'W:/kt',
  instruction: 'Go.',
  model: null,
  permissionMode: 'accept-edits',
  resumeRef: null,
  ticketId: 'T-0001',
  onEvent: () => undefined,
  onSessionRef: () => undefined,
  ...over,
});

describe("a slot's account reaches the worker through its environment (req-177)", () => {
  it('claude-code spawns with the slot env (CLAUDE_CONFIG_DIR), and with the inherited one without', () => {
    const rec = recording();
    const adapter = claudeCodeAdapter(rec.spawnFn);
    adapter.spawn(start({ env: { CLAUDE_CONFIG_DIR: '/home/u/.claude-b' } }));
    adapter.spawn(start());
    expect(rec.opts).toEqual([{ cwd: 'W:/kt', env: { CLAUDE_CONFIG_DIR: '/home/u/.claude-b' } }, { cwd: 'W:/kt' }]);
  });

  it('kimi spawns with the slot env (KIMI_HOME)', () => {
    const rec = recording();
    kimiAdapter(rec.spawnFn, async () => []).spawn(start({ env: { KIMI_HOME: '/k2' } }));
    expect(rec.opts[0]).toEqual({ cwd: 'W:/kt', env: { KIMI_HOME: '/k2' } });
  });
});
