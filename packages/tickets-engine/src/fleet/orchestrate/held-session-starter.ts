import type { Clock } from '../ports/clock';
import type { RunInfo, RunRequest, SessionSpec } from '../protocol';
import { isHeldSession } from '../protocol-session';
import type { StartOutcome } from '../run/run-record';
import { INITIAL_RUN_STATE, isTerminal } from '../run/run-state';
import type { RunStateMachine } from '../run/run-state-machine';
import type { NormalizedEvent } from '../harness/contract';
import { FreeSessionKind } from './free-session-kind';
import type { HeldSessionKind } from './held-session-kind';
import { newLiveRun, type LiveRun } from './live-run';
import { OneOnOneKind } from './one-on-one-kind';
import { newRunInfo } from './opening-notes';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import type { RunStreams } from './run-streams';
import type { SlotBinder, SlotBinding } from './slot-binder';
import type { WorkerLauncher } from './worker-launcher';

export interface HeldSessionStarterDeps {
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

interface Opening {
  readonly id: string;
  readonly request: RunRequest;
  readonly spec: SessionSpec;
  readonly slot: SlotBinding | null;
  readonly stamp: string;
}

/**
 * The start of a held session (req-168's 1:1, req-173's free session;
 * ADR-0093, R12): the persona's own harness and model, granted by the pool
 * like any session (its slot reserved, the persona's and the provider's
 * ledgers counted, no ticket allowance), then the worker spawned QUIET and
 * HELD in the session's working directory — no claim, no worktree, no
 * prompt until the owner's first line, which the steer path wraps with the
 * brief once (req-75). What a kind refuses and how its record reads is the
 * kind's ({@link HeldSessionKind}).
 */
export class HeldSessionStarter {
  private readonly kinds: Readonly<Record<SessionSpec['kind'], HeldSessionKind>> = {
    '1:1': new OneOnOneKind() as HeldSessionKind,
    free: new FreeSessionKind() as HeldSessionKind,
  };

  constructor(private readonly deps: HeldSessionStarterDeps) {}

  async start(request: RunRequest): Promise<StartOutcome> {
    const refusal = this.refusal(request);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    const spec = request.session!;
    const stamp = this.deps.clock.now().toISOString();
    const id = `R-${stamp.replaceAll(/[-:.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    const label = this.kinds[spec.kind].label(spec);
    this.deps.log(`session ${id} (${label}): asked by ${request.origin ?? ''}`);
    const slot = this.bindSlot(request, id, spec.persona, label);
    if (typeof slot === 'string') {
      return { ok: false, error: slot };
    }
    try {
      return await this.open({ id, request, spec, slot, stamp });
    } catch (error) {
      this.deps.slots?.release(id);
      return { ok: false, error: `the ${spec.kind === 'free' ? 'free session' : '1:1'} did not start: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private refusal(request: RunRequest): string | null {
    if (this.deps.retiring()) {
      return 'the runner is handing over to a newer build — try again in a moment';
    }
    const spec = request.session;
    if (spec === undefined || !isHeldSession(request)) {
      return 'the request is not a held session';
    }
    if (spec.persona.trim() === '') {
      return `a ${spec.kind === 'free' ? 'free session' : '1:1'} names its persona`;
    }
    if ((request.origin ?? '').trim() === '') {
      return 'the start names no origin - every start says who asks for it';
    }
    return this.kinds[spec.kind].refusal(request, spec, this.deps.repo.list());
  }

  /** The pool's grant on the persona's provider, or why none serves. */
  private bindSlot(request: RunRequest, id: string, persona: string, label: string): SlotBinding | null | string {
    const slots = this.deps.slots;
    if (slots === undefined) {
      return null;
    }
    const bound = slots.bind(request, id, { prefer: null, persona });
    if ('refused' in bound) {
      this.deps.log(`session ${id} (${label}): refused — ${bound.refused}`);
      return bound.refused;
    }
    return bound;
  }

  /** The record, the opening lines, the quiet worker, the hold. */
  private async open(start: Opening): Promise<StartOutcome> {
    const { id, request, spec } = start;
    const dir = this.deps.repo.dirFor(id);
    await this.deps.repo.ensureDir(dir);
    const run = newLiveRun({ info: this.infoOf(start), request, dir, startedAtMs: this.deps.clock.now().getTime(), freshTelemetry: true });
    this.deps.repo.add(run);
    await this.deps.streams.open(run, this.openingLines(start));
    const handle = this.deps.launcher.launch(run, { resumeRef: null });
    run.info = this.deps.machine.transition({ ...run.info, pid: handle.pid }, { kind: 'spawned' });
    handle.setHold?.(true);
    await this.deps.repo.persist(run);
    await this.deps.bookkeeper.note(run, this.kinds[spec.kind].note(spec, request));
    return { ok: true, run: run.info };
  }

  private infoOf(start: Opening): RunInfo {
    const { id, request, spec, slot, stamp } = start;
    const base = newRunInfo({ id, request, prepared: null, decision: null, resumeRef: null, persona: spec.persona, stamp, slot }, INITIAL_RUN_STATE);
    return this.kinds[spec.kind].infoOf(base, spec);
  }

  private openingLines(start: Opening): readonly NormalizedEvent[] {
    const { id, request, spec, slot, stamp } = start;
    const lines = [
      this.kinds[spec.kind].openingLine(id, spec, request),
      ...(slot === null ? [] : [`slot: ${slot.label}`, ...(slot.grant !== undefined ? [`pool: ${slot.grant.reason}`] : [])]),
    ];
    return lines.map((text) => ({ ts: stamp, kind: 'note', text }));
  }
}

/** A live held session (a 1:1 or a free session) as the idle release and the reaper read it. */
export function isLiveHeldSession(run: LiveRun): boolean {
  return isHeldSession(run.request) && !isTerminal(run.info.state);
}
