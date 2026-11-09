import type { Clock } from '../ports/clock';
import type { RunInfo, RunRequest, SessionSpec } from '../protocol';
import { isOneOnOne } from '../protocol-session';
import type { StartOutcome } from '../run/run-record';
import { INITIAL_RUN_STATE, isTerminal } from '../run/run-state';
import type { RunStateMachine } from '../run/run-state-machine';
import type { NormalizedEvent } from '../harness/contract';
import { newLiveRun, type LiveRun } from './live-run';
import { newRunInfo } from './opening-notes';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import type { RunStreams } from './run-streams';
import type { SlotBinder, SlotBinding } from './slot-binder';
import type { WorkerLauncher } from './worker-launcher';

export interface OneOnOneStarterDeps {
  readonly machine: RunStateMachine;
  readonly repo: RunRepository;
  readonly streams: RunStreams;
  readonly bookkeeper: RunBookkeeper;
  readonly launcher: WorkerLauncher;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** The runner is handing over to a newer build: it starts nothing new (req-51). */
  readonly retiring: () => boolean;
  /** The pool's door (req-170/177): absent = no slots, a spec's wiring. */
  readonly slots?: SlotBinder;
}

/** Why a 1:1 request cannot start; null when it may. */
function specFailures(request: RunRequest, spec: SessionSpec | undefined): string | null {
  if (spec === undefined || !isOneOnOne(request)) {
    return 'the request is not a 1:1 session';
  }
  if (spec.persona.trim() === '') {
    return 'a 1:1 names its persona';
  }
  if (spec.workingDirectory.trim() === '') {
    return 'a 1:1 names its working directory';
  }
  if ((request.origin ?? '').trim() === '') {
    return 'the start names no origin - every start says who asks for it';
  }
  return request.instruction.trim() === '' ? 'the 1:1 brief is empty' : null;
}

/**
 * A 1:1's start (req-168, ADR-0093, R1/R12): the persona's own harness and
 * model, granted by the pool like any session (its slot reserved, the
 * persona's and the provider's ledgers counted, no ticket allowance), then
 * the worker spawned QUIET and HELD in the tickets repository, read-only —
 * no claim, no worktree, no prompt until the owner's first line, which the
 * steer path wraps with the brief once (req-75). One live 1:1 per persona.
 */
export class OneOnOneStarter {
  constructor(private readonly deps: OneOnOneStarterDeps) {}

  async start(request: RunRequest): Promise<StartOutcome> {
    const refusal = this.refusal(request);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    const spec = request.session!;
    const stamp = this.deps.clock.now().toISOString();
    const id = `R-${stamp.replaceAll(/[-:.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    this.deps.log(`session ${id} (1:1 with ${spec.persona}): asked by ${request.origin ?? ''}`);
    const slot = this.bindSlot(request, id, spec.persona);
    if (typeof slot === 'string') {
      return { ok: false, error: slot };
    }
    try {
      return await this.open({ id, request, spec, slot, stamp });
    } catch (error) {
      this.deps.slots?.release(id);
      return { ok: false, error: `the 1:1 did not start: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private refusal(request: RunRequest): string | null {
    if (this.deps.retiring()) {
      return 'the runner is handing over to a newer build — try again in a moment';
    }
    const failure = specFailures(request, request.session);
    if (failure !== null) {
      return failure;
    }
    const persona = request.session!.persona;
    const live = this.deps.repo.list().find((r) => isOneOnOne(r) && r.persona === persona && !isTerminal(r.state));
    return live === undefined ? null : `${persona} already has a live 1:1 (${live.id})`;
  }

  /** The pool's grant on the persona's provider, or why none serves. */
  private bindSlot(request: RunRequest, id: string, persona: string): SlotBinding | null | string {
    const slots = this.deps.slots;
    if (slots === undefined) {
      return null;
    }
    const bound = slots.bind(request, id, { prefer: null, persona });
    if ('refused' in bound) {
      this.deps.log(`session ${id} (1:1 with ${persona}): refused — ${bound.refused}`);
      return bound.refused;
    }
    return bound;
  }

  /** The record, the opening lines, the quiet worker, the hold. */
  private async open(start: { id: string; request: RunRequest; spec: SessionSpec; slot: SlotBinding | null; stamp: string }): Promise<StartOutcome> {
    const { id, request, spec, slot, stamp } = start;
    const dir = this.deps.repo.dirFor(id);
    await this.deps.repo.ensureDir(dir);
    const run = newLiveRun({ info: this.infoOf(start), request, dir, startedAtMs: this.deps.clock.now().getTime(), freshTelemetry: true });
    this.deps.repo.add(run);
    await this.deps.streams.open(run, this.openingLines(id, spec, slot, stamp));
    const handle = this.deps.launcher.launch(run, { resumeRef: null });
    run.info = this.deps.machine.transition({ ...run.info, pid: handle.pid }, { kind: 'spawned' });
    handle.setHold?.(true);
    await this.deps.repo.persist(run);
    await this.deps.bookkeeper.note(run, `1:1 with ${spec.persona} — the worker waits for your first line; read-only, no ticket, released after idle`);
    return { ok: true, run: run.info };
  }

  /** A run record shaped as a 1:1: kind, persona, the explicit directory, quiet and held from the start. */
  private infoOf(start: { id: string; request: RunRequest; spec: SessionSpec; slot: SlotBinding | null; stamp: string }): RunInfo {
    const { id, request, spec, slot, stamp } = start;
    const base = newRunInfo({ id, request, prepared: null, decision: null, resumeRef: null, persona: spec.persona, stamp, slot }, INITIAL_RUN_STATE);
    return { ...base, kind: '1:1', workingDirectory: spec.workingDirectory, chatFile: spec.chatFile, column: null, phase: null, quietStart: true, held: true };
  }

  private openingLines(id: string, spec: SessionSpec, slot: SlotBinding | null, stamp: string): readonly NormalizedEvent[] {
    const lines = [
      `session ${id} — 1:1 with ${spec.persona} in ${spec.workingDirectory} (read-only, no ticket, no worktree)`,
      ...(slot === null ? [] : [`slot: ${slot.label}`, ...(slot.grant !== undefined ? [`pool: ${slot.grant.reason}`] : [])]),
    ];
    return lines.map((text) => ({ ts: stamp, kind: 'note', text }));
  }
}

/** A live 1:1 run as the idle release and the reaper read it. */
export function isLiveOneOnOne(run: LiveRun): boolean {
  return isOneOnOne(run.request) && !isTerminal(run.info.state);
}
