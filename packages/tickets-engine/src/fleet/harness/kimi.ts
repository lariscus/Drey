/**
 * The `kimi` adapter (E10-8, docs/design/kimi-worker.md): Moonshot's Kimi
 * Code CLI over ACP — `kimi acp`, newline-delimited JSON-RPC 2.0 on stdio,
 * pinned against kimi 2.4.1. Print mode (`kimi -p`) is not used: it
 * auto-approves everything and reports no usage. ACP gives live tool calls
 * and thoughts, approvals and questions held open for the owner,
 * `session/cancel` (the interrupt and the steer's cancel), `session/load`
 * (resume) and `/compact`; tokens and cost come from the session's wire log.
 */
import type { SpawnFn } from '../ports/process-spawner';
import { AcpClient } from './acp-client';
import type { NowFn, ProviderAdapter, ProviderStart, WorkerHandle } from './contract';
import { KimiRequests } from './kimi-requests';
import { newKimiState, kimiEmit, type KimiContext } from './kimi-state';
import { KimiTurns } from './kimi-turns';
import { KimiUpdateFold } from './kimi-update-fold';
import type { KimiUsageReader } from './kimi-usage';
import { KimiWorker } from './kimi-worker';

export class KimiAcpAdapter implements ProviderAdapter {
  readonly id = 'kimi' as const;
  readonly label = 'Kimi Code';
  readonly liveInject = true;

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly readUsage: KimiUsageReader,
    private readonly now: NowFn,
  ) {}

  /** One worker's parts, wired; the client's handlers and the finish reach them through late-bound arrows. */
  spawn(start: ProviderStart): WorkerHandle {
    // req-177: a second Kimi account is its own KIMI_HOME, handed in through the environment.
    const proc = this.spawnFn('kimi', ['acp'], start.env !== undefined ? { cwd: start.cwd, env: start.env } : { cwd: start.cwd });
    const state = newKimiState();
    const emit = kimiEmit({ start, now: this.now });
    const fold = new KimiUpdateFold({ start, now: this.now });
    const acp = new AcpClient(proc, {
      onRequest: (message) => requests.onRequest(message),
      onNotification: (message) => {
        if (message.method === 'session/update' && !state.replaying) {
          fold.onUpdate((message.params?.['update'] ?? {}) as Record<string, unknown>);
        }
      },
      onNoise: (line) => emit({ kind: 'note', detail: 'stderr', text: line }),
    });
    const finish = (): void => {
      if (!state.ended) {
        state.ended = true;
        proc.endInput();
        void proc.killTree();
      }
    };
    const ctx: KimiContext = { start, state, acp, now: this.now, finish };
    const requests: KimiRequests = new KimiRequests(ctx, fold);
    const worker = new KimiWorker(ctx, proc, { turns: new KimiTurns(ctx, fold, this.readUsage), requests });
    worker.begin();
    return worker;
  }
}

export function kimiAdapter(spawnFn: SpawnFn, readUsage: KimiUsageReader = async () => [], now: NowFn = (): Date => new Date()): ProviderAdapter {
  return new KimiAcpAdapter(spawnFn, readUsage, now);
}
