/**
 * The one ACP adapter (req-182, ADR-0096 later change): every harness that
 * speaks the Agent Client Protocol natively — Kimi Code, Copilot CLI,
 * opencode — runs through this class and the one `AcpClient`; what sets the
 * harnesses apart is their `AcpHarness` launch description. ACP gives live
 * tool calls and thoughts, approvals and question forms held open for the
 * owner, `session/cancel` (the interrupt and the steer's cancel),
 * `session/resume` / `session/load` (resume) and `/compact`.
 */
import type { SpawnFn } from '../ports/process-spawner';
import { AcpClient } from './acp-client';
import { AcpForms } from './acp-forms';
import type { AcpHarness } from './acp-harness';
import { AcpRequests } from './acp-requests';
import { AcpSessionOpener } from './acp-session-open';
import { acpEmit, newAcpState, type AcpContext } from './acp-state';
import { AcpTurns } from './acp-turns';
import { AcpUpdateFold } from './acp-update-fold';
import { AcpWorker } from './acp-worker';
import type { NowFn, ProviderAdapter, ProviderStart, WorkerHandle } from './contract';

export class AcpAdapter implements ProviderAdapter {
  readonly liveInject = true;

  constructor(
    private readonly harness: AcpHarness,
    private readonly spawnFn: SpawnFn,
    private readonly now: NowFn,
  ) {}

  get id(): AcpHarness['id'] {
    return this.harness.id;
  }

  get label(): string {
    return this.harness.label;
  }

  /** One worker's parts, wired; the client's handlers and the finish reach them through late-bound arrows. */
  spawn(start: ProviderStart): WorkerHandle {
    const launch = this.harness.launch(start);
    // req-177: a slot's account is its login folder, handed in through the environment (over the harness's own).
    const env = launch.env === undefined && start.env === undefined ? undefined : { ...launch.env, ...start.env };
    const proc = this.spawnFn(launch.command, launch.args, env !== undefined ? { cwd: start.cwd, env } : { cwd: start.cwd });
    const state = newAcpState(start);
    const emit = acpEmit({ start, now: this.now });
    if (launch.note !== undefined) {
      emit({ kind: 'note', detail: 'runner', text: launch.note });
    }
    const fold = new AcpUpdateFold({ start, now: this.now, state });
    const acp = new AcpClient(
      proc,
      {
        onRequest: (message) => requests.onRequest(message),
        onNotification: (message) => {
          if (message.method === 'session/update' && !state.replaying) {
            fold.onUpdate((message.params?.['update'] ?? {}) as Record<string, unknown>);
          }
        },
        onNoise: (line) => emit({ kind: 'note', detail: 'stderr', text: line }),
      },
      this.harness.agent,
    );
    const finish = (): void => {
      if (!state.ended) {
        state.ended = true;
        proc.endInput();
        void proc.killTree();
      }
    };
    const ctx: AcpContext = { harness: this.harness, start, state, acp, now: this.now, finish };
    const requests: AcpRequests = new AcpRequests(ctx, fold, new AcpForms(ctx));
    const turns = new AcpTurns(ctx, fold, this.harness.meter());
    const worker = new AcpWorker(ctx, proc, { turns, requests, opener: new AcpSessionOpener(ctx, turns) });
    worker.begin();
    return worker;
  }
}
