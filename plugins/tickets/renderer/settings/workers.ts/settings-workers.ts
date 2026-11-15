import type { DreyPluginApi } from '../../../../../shared/plugin-api/renderer';
import { WORKER_PROVIDERS, type WorkerProviderId } from '../../../../../packages/tickets-engine/src/fleet/protocol';
import { el, kv, textConfig } from '../dom.ts/settings-dom';
import type { CrewSettings } from '../crew.ts/settings-crew';

/** One per-runner field: the plugin-config key it writes and how. */
export interface RunnerField {
  readonly id: string;
  readonly label: string;
  readonly key: string;
  /** req-173: `text` writes the plugin config (machine); the others the vault layer, tickets/_meta/crew.md. */
  readonly kind: 'compact' | 'text' | 'permission';
  readonly choices?: ReadonlyArray<readonly [string, string]>;
  readonly fallback?: string;
  readonly hint: string;
}

export const RUNNER_LABEL: Readonly<Record<WorkerProviderId, string>> = {
  opencode: 'OpenCode',
  'claude-code': 'Claude Code',
  kimi: 'Kimi Code',
  copilot: 'Copilot CLI',
};

const compactField = (provider: WorkerProviderId): RunnerField => ({
  id: `tset-compact-${provider}`,
  label: 'Resume compact threshold — tokens',
  key: provider,
  kind: 'compact',
  hint: 'A resumed session whose last context is at or above this many tokens is compacted first (T-0049). Empty uses the default.',
});

/**
 * The settings that belong to one CLI runner (req-71) — the keys the main
 * side reads per provider: the pools (req-63), the compact-threshold
 * override (T-0049) and Claude Code's permission flag, which OpenCode
 * never reads (its permissions come from its own config and ask on the
 * card, req-64).
 */
export const RUNNER_FIELDS: Readonly<Record<WorkerProviderId, readonly RunnerField[]>> = {
  opencode: [
    {
      id: 'tset-pool-opencode-probe',
      label: 'Pool probe',
      key: 'fleet.pool.opencode.probe',
      kind: 'text',
      hint: 'A llama.cpp server URL: its parallel slots cap the pool. Other servers do not report theirs.',
    },
    compactField('opencode'),
  ],
  'claude-code': [
    {
      id: 'tset-permissions',
      label: 'Dispatched-run permissions',
      key: 'permissionMode',
      kind: 'permission',
      choices: [
        ['accept-edits', 'Accept edits (asks before commands)'],
        ['bypass', 'Bypass permissions (unattended)'],
      ],
      fallback: 'accept-edits',
      hint: 'Runs the chain starts on its own have no dialog to ask in.',
    },
    compactField('claude-code'),
  ],
  // Kimi's approvals ride the card like OpenCode's (ACP permission requests), so no permission flag of its own beyond the dispatched-run mode.
  kimi: [compactField('kimi')],
  // req-182: Copilot CLI fixes its settings at launch (model, tools); past the threshold its resume starts fresh (no verified compact over ACP).
  copilot: [compactField('copilot')],
};

/**
 * The Workers section: a runner switch over the selected runner's fields.
 * It opens on `initial` (the default worker's provider); the switch is a
 * view choice only and is not saved.
 */
export function createWorkersSection(
  api: DreyPluginApi,
  initial: WorkerProviderId,
  crew: CrewSettings,
): { readonly root: HTMLElement; select(provider: WorkerProviderId): void } {
  const section = el('section', 'tset-section');
  section.setAttribute('aria-labelledby', 'tset-workers-head');
  const head = el('div', 'tset-section-head');
  const title = el('h3', undefined, 'Workers');
  title.id = 'tset-workers-head';
  const runnerSwitch = el('div', 'tset-runner-switch');
  runnerSwitch.setAttribute('role', 'group');
  runnerSwitch.setAttribute('aria-label', 'Runner');
  head.append(title, runnerSwitch, el('span', 'tset-chip tset-chip-manual', 'Applies on restart'));
  const rows = el('div', 'tset-kv');
  section.append(head, rows);

  const buttons = new Map<WorkerProviderId, HTMLButtonElement>();
  let current: WorkerProviderId | null = null;
  const select = (provider: WorkerProviderId): void => {
    if (provider === current) {
      return;
    }
    current = provider;
    for (const [id, button] of buttons) {
      button.classList.toggle('active', id === provider);
      button.setAttribute('aria-pressed', String(id === provider));
    }
    rows.replaceChildren(...RUNNER_FIELDS[provider].flatMap((field) => kv(field.id, field.label, control(api, crew, field), field.hint)));
  };
  for (const provider of WORKER_PROVIDERS) {
    const button = el('button', undefined, RUNNER_LABEL[provider]);
    button.type = 'button';
    button.addEventListener('click', () => select(provider));
    buttons.set(provider, button);
    runnerSwitch.append(button);
  }
  select(initial);
  return { root: section, select };
}

function control(api: DreyPluginApi, crew: CrewSettings, field: RunnerField): HTMLInputElement | HTMLSelectElement {
  switch (field.kind) {
    case 'compact':
      return crew.override('compactAboveTokensBy', field.key);
    case 'text':
      return textConfig(api, field.key);
    case 'permission':
      return crew.select('permissionMode', field.choices ?? []);
  }
}
