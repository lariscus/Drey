/**
 * The `copilot` harness (req-182): GitHub Copilot CLI over ACP —
 * `copilot --acp --stdio` (public preview since 2026-01-28). Its settings
 * are fixed at startup, not per `session/new`, so the model rides the
 * launch (`--model`) and so does the tool permission: an unattended start
 * allows its tools (`--allow-all-tools`); a read-only start (req-183, a
 * review) allows nothing up front, so a permission request — when the
 * installed version sends one (github/copilot-cli#845) — reaches the owner.
 * Copilot advertises no read-only session mode as far as documented: then
 * read-only is not enforced inside the session, the run's stream says so
 * once, and the review checkout's read-only files stay the guard (Spike 7:
 * isolation from outside — the worktree and the governor are the
 * boundary). Login is Copilot's own (`copilot login`); a second account is
 * its own `COPILOT_HOME`. Copilot reports no quota windows: its slots are
 * counted by the runner (`counting`).
 */
import type { PermissionMode } from '../protocol';
import type { SpawnFn } from '../ports/process-spawner';
import { AcpAdapter } from './acp-adapter';
import type { AcpHarness, AcpModeChoice } from './acp-harness';
import { PromptUsageMeter } from './acp-usage';
import type { NowFn, ProviderAdapter, ProviderStart } from './contract';

/** A read-only session mode Copilot may advertise (its plan mode); none is documented over ACP. */
export const COPILOT_READ_ONLY_MODE = 'plan';

export const COPILOT_NOT_READ_ONLY_NOTE =
  'copilot offers no read-only mode and approves its tools itself — read-only is not enforced in the session; the review checkout’s read-only files are the guard';

/** The launch arguments: ACP on stdio, the model pin, the tool permission. */
export function copilotArgs(start: Pick<ProviderStart, 'model' | 'permissionMode'>): string[] {
  return [
    '--acp',
    '--stdio',
    ...(start.model !== null && start.model.trim() !== '' ? ['--model', start.model.trim()] : []),
    ...(start.permissionMode === 'read-only' ? [] : ['--allow-all-tools']),
  ];
}

export function copilotModeFor(mode: PermissionMode, offered: readonly string[] | null): AcpModeChoice {
  if (mode !== 'read-only') {
    return { modeId: null, note: null };
  }
  if (offered !== null && offered.includes(COPILOT_READ_ONLY_MODE)) {
    return { modeId: COPILOT_READ_ONLY_MODE, note: null };
  }
  return { modeId: null, note: COPILOT_NOT_READ_ONLY_NOTE };
}

export function copilotHarness(): AcpHarness {
  return {
    id: 'copilot',
    label: 'Copilot CLI',
    agent: 'copilot',
    launch: (start) => ({ command: 'copilot', args: copilotArgs(start) }),
    clientCapabilities: { elicitation: { form: {} } },
    resume: ['resume', 'load'],
    modelSettings: () => [],
    modeFor: copilotModeFor,
    meter: () => new PromptUsageMeter(),
    emptyTurnIsRefusal: true,
  };
}

export function copilotAdapter(spawnFn: SpawnFn, now: NowFn = (): Date => new Date()): ProviderAdapter {
  return new AcpAdapter(copilotHarness(), spawnFn, now);
}
