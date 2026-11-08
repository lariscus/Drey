import { OPENCODE_API, type OcMessage } from './opencode-api';
import { emitOf, type OpencodeContext } from './opencode-state';

/** How often the compact-first wait reads the message list. */
const COMPACT_POLL_MS = 500;

/**
 * The worker's session before its first prompt (T-0049): a resumed session
 * verified first (one the server no longer has respawns the run fresh,
 * never a failed one), a new one created, and — when asked — the native
 * compact, settled before the instruction rides.
 */
export class OpencodeSessionSetup {
  constructor(private readonly ctx: OpencodeContext) {}

  /** The resume pre-flight; false = reported to the supervisor, the worker is ending. */
  async preflight(): Promise<boolean> {
    const { state, client, start } = this.ctx;
    if (state.sessionRef === null) {
      return true;
    }
    let reason: string | null = null;
    try {
      const res = await client.get(OPENCODE_API.session(state.sessionRef));
      if (!res.ok) {
        reason = `the session answered HTTP ${res.status}`;
      }
    } catch (error) {
      reason = String(error).slice(0, 200);
    }
    if (reason === null) {
      return true;
    }
    emitOf(this.ctx)({ kind: 'error', text: `resume pre-flight failed — ${reason}` });
    start.onResumeFailed?.(reason);
    return false;
  }

  /** A new session when the run resumes none; its id goes to the supervisor. */
  async create(): Promise<void> {
    const { state, client, start } = this.ctx;
    if (state.sessionRef !== null) {
      return;
    }
    const res = await client.post(OPENCODE_API.createSession, { title: `fleet ${start.ticketId}` });
    const id = (await client.data<{ id?: string }>(res))?.id;
    if (typeof id !== 'string') {
      throw new Error('opencode: session create returned no id');
    }
    state.sessionRef = id;
    start.onSessionRef(id);
  }

  /**
   * T-0049 compact-first: the compaction runs as a turn of its own; the
   * `idle` marker is the one signal it settled. No deadline: a local model
   * may think for minutes (ADR-0014). It must settle before `lastPromptAt`
   * exists, or the poll would end the run on the compact's own idle marker.
   */
  async compactFirst(): Promise<void> {
    const { state, client, start, now } = this.ctx;
    if (start.compactFirst !== true || state.sessionRef === null || !client.bound) {
      return;
    }
    const note = (text: string): void => emitOf(this.ctx)({ kind: 'note', text });
    const startedAt = now().getTime();
    try {
      const res = await client.post(OPENCODE_API.compact(state.sessionRef), {});
      if (!res.ok) {
        return note(`the pre-run compact failed (HTTP ${res.status}) — the session continues un-compacted`);
      }
    } catch (error) {
      return note(`the pre-run compact failed — ${String(error).slice(0, 200)}`);
    }
    while (state.alive) {
      if (await this.compacted(state.sessionRef, startedAt)) {
        return note('the resumed session was natively compacted before the first prompt');
      }
      await new Promise((resolve) => setTimeout(resolve, COMPACT_POLL_MS));
    }
  }

  private async compacted(sessionRef: string, startedAt: number): Promise<boolean> {
    try {
      const list = await this.ctx.client.get(OPENCODE_API.messages(sessionRef));
      const newest = list.ok ? ((await this.ctx.client.data<OcMessage[]>(list)) ?? [])[0] : undefined;
      return newest !== undefined && newest.type === 'idle' && (newest.time?.created ?? 0) >= startedAt;
    } catch {
      return false; // retried by the next round
    }
  }
}
