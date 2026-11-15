import type { TransitionPatch } from './ticket-files';
import { patchTicketFile, withLogLine } from './ticket-files';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The machine's result: the ok:false variant names the error; ok:true
 * carries the resulting path. Structurally assignable to the board's richer
 * MutationResult — the machine never produces `moved`.
 */
export type TransitionResult =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly path?: string };

/**
 * THE one transition machine (ADR-0088, E1). Every ticket move — the
 * board's `transition`, archive, unarchive and the Ready card's Accept /
 * Send back — is the same pipeline with different parameters:
 *
 *   read → patch (+ optional extra Log line) → write → announce
 *
 * On the store the write is one `put` (the board service's IO decides the
 * stage from the target path); there is no rename, commit or push of a
 * ticket file any more (E14-9b).
 *
 * The machine is pure domain: all IO arrives injected through
 * {@link TransitionIo}, so `core/` keeps its no-node/no-Electron rule and
 * the spec covers every step with fakes.
 */

/** The IO the machine needs, supplied by the host (the board service over the store). */
export interface TransitionIo {
  /** Read a ticket by its board path. */
  read(path: string): Promise<string>;
  /** Write a ticket at its board path (no announcement — the machine announces once at the end). */
  write(path: string, text: string): Promise<void>;
  /** The closing announcement: the board changed. */
  announce(): void;
}

export interface TransitionSpec {
  /** The ticket id — the results name it. */
  readonly id: string;
  /** Current board path. */
  readonly fromPath: string;
  /**
   * Pre-read content; when present the machine does not read through
   * {@link TransitionIo.read} (the caller already holds the text).
   */
  readonly text?: string;
  /**
   * When the machine reads via {@link TransitionIo.read} and it rejects,
   * this error is returned instead of propagating (the unarchive wording
   * is specific). Without it a read failure propagates to the caller —
   * the historical behaviour of the board moves.
   */
  readonly readError?: string;
  /** The frontmatter/Log patch — see `patchTicketFile`. */
  readonly patch: TransitionPatch;
  /** An optional second Log line after the ordinary `<from> -> <to>` line (the send-back note). */
  readonly extraLog?: string;
  /** Target board path (it names the phase the ticket ends in); absent = in-place patch. */
  readonly toPath?: string;
}

/**
 * Run one transition. Never throws for patch/write failures — those
 * surface as `ok: false`. A read failure propagates unless the spec names
 * a `readError`.
 */
export async function runTransition(io: TransitionIo, spec: TransitionSpec): Promise<TransitionResult> {
  let text: string;
  if (spec.text !== undefined) {
    text = spec.text;
  } else {
    try {
      text = await io.read(spec.fromPath);
    } catch (error) {
      if (spec.readError !== undefined) {
        return { ok: false, error: spec.readError };
      }
      throw error;
    }
  }

  let patched: string;
  try {
    patched = patchTicketFile(text, spec.patch);
    if (spec.extraLog !== undefined) {
      patched = withLogLine(patched, spec.patch.now, spec.patch.actor, spec.extraLog);
    }
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }

  const toPath = spec.toPath ?? spec.fromPath;
  try {
    await io.write(toPath, patched);
  } catch (error) {
    return { ok: false, error: `move failed: ${messageOf(error)}` };
  }
  io.announce();
  return { ok: true, path: toPath };
}
