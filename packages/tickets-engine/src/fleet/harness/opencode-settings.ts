/**
 * The opencode harness's settings over ACP (req-182), measured against
 * opencode 2.0.32's `opencode acp`: the session's config options are
 * `model` (`provider/model`), `effort` (`low`, `high`, `max`, `default`)
 * and `mode` (`build`, `plan` — opencode's agents); the context cap rides
 * the launch as inline config, as it did for `opencode serve`.
 */
import type { PermissionMode } from '../protocol';
import type { AcpConfigSetting, AcpModeChoice } from './acp-harness';

/** opencode's read-only agent: "Read-only agent for exploring the codebase and planning work before implementation." */
export const OPENCODE_READ_ONLY_MODE = 'plan';

/** Drops a `#variant` suffix a pin or a catalog id may carry (`glm-5.3#fast`). */
export function stripVariant(id: string): string {
  const at = id.indexOf('#');
  return at === -1 ? id : id.slice(0, at);
}

/** A pin's settings: the model without its variant, and the variant as the session's effort (set when offered). */
export function opencodeModelSettings(model: string): readonly AcpConfigSetting[] {
  const at = model.indexOf('#');
  const variant = at === -1 ? '' : model.slice(at + 1).trim();
  return [{ configId: 'model', value: stripVariant(model).trim() }, ...(variant !== '' ? [{ configId: 'effort', value: variant }] : [])];
}

/**
 * A read-only start (req-183, a review) runs the `plan` agent; every other
 * start keeps the session's default agent — opencode's permissions come
 * from its own config, there is no bypass mode to switch to.
 */
export function opencodeModeFor(mode: PermissionMode, offered: readonly string[] | null): AcpModeChoice {
  if (mode !== 'read-only') {
    return { modeId: null, note: null };
  }
  if (offered === null || offered.includes(OPENCODE_READ_ONLY_MODE)) {
    return { modeId: OPENCODE_READ_ONLY_MODE, note: null };
  }
  return { modeId: null, note: 'opencode offers no plan mode — the review checkout’s read-only files are the only guard' };
}

/**
 * The inline config that caps the pinned model's window (req-80): OpenCode
 * auto-compacts against `limit.context`, and an override naming `context`
 * alone is dropped whole, so the output limit rides too.
 */
export function opencodeCapConfig(model: string | null, cap: number): string | null {
  if (model === null || !(cap > 0)) {
    return null;
  }
  const slashAt = model.indexOf('/');
  if (slashAt <= 0 || slashAt === model.length - 1) {
    return null;
  }
  const providerID = model.slice(0, slashAt).trim();
  const modelID = stripVariant(model.slice(slashAt + 1).trim());
  const limit = { context: Math.floor(cap), output: Math.min(32_000, Math.floor(cap / 4)) };
  return JSON.stringify({ provider: { [providerID]: { models: { [modelID]: { limit } } } } });
}
