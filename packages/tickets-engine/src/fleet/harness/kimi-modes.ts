import type { PermissionMode } from '../protocol';

/**
 * The Kimi session's mode for a start's permission mode (ACP
 * `session/set_mode`). Kimi 2.5.2 advertises `default`, `plan` ("Read-only
 * planning; no tool execution"), `auto` and `yolo` in `session/new`'s
 * `modes.availableModes`. A read-only start (req-183, a review) takes `plan`
 * when the session advertises it; an older CLI that does not keeps `auto`,
 * and the review checkout's read-only files are then its only guard — the
 * run's stream says so.
 */
export const KIMI_READ_ONLY_MODE = 'plan';

export interface KimiModeChoice {
  readonly modeId: string;
  /** A note for the run's stream when the asked mode is not available; null otherwise. */
  readonly note: string | null;
}

/** The mode ids a `session/new` or `session/load` result advertises; null when it names none. */
export function kimiModesOf(result: Record<string, unknown>): readonly string[] | null {
  const modes = result['modes'];
  if (typeof modes !== 'object' || modes === null) {
    return null;
  }
  const available = (modes as Record<string, unknown>)['availableModes'];
  if (!Array.isArray(available)) {
    return null;
  }
  return available.map((m) => (typeof m === 'object' && m !== null ? (m as Record<string, unknown>)['id'] : null)).filter((id): id is string => typeof id === 'string');
}

export function kimiModeFor(mode: PermissionMode, available: readonly string[] | null): KimiModeChoice {
  if (mode === 'bypass') {
    return { modeId: 'yolo', note: null };
  }
  if (mode !== 'read-only') {
    return { modeId: 'auto', note: null };
  }
  if (available !== null && available.includes(KIMI_READ_ONLY_MODE)) {
    return { modeId: KIMI_READ_ONLY_MODE, note: null };
  }
  return { modeId: 'auto', note: 'kimi advertises no read-only mode — the review checkout’s read-only files are the only guard' };
}
