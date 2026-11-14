/**
 * The `kimi` harness (E10-8, docs/design/kimi-worker.md): Moonshot's Kimi
 * Code CLI over ACP — `kimi acp`, pinned against kimi 2.4.1, probed on
 * 2.5.2. Print mode (`kimi -p`) is not used: it auto-approves everything
 * and reports no usage. Approvals and the AskUserQuestion tool arrive as
 * `session/request_permission`; a resume is `session/load`; the modes are
 * `default`, `plan`, `auto`, `yolo`; the model is a session config option;
 * tokens come from the session's wire log (ACP reports none), the cost from
 * the price table.
 */
import type { SpawnFn } from '../ports/process-spawner';
import { AcpAdapter } from './acp-adapter';
import type { AcpHarness } from './acp-harness';
import type { NowFn, ProviderAdapter } from './contract';
import { kimiModeFor } from './kimi-modes';
import type { KimiUsageReader } from './kimi-usage';
import { KimiWireMeter } from './kimi-wire-meter';

/** req-142: Kimi's web tools are switched in its own config.toml only — a run cannot take them away (ADR-0099). */
export const KIMI_NO_NETWORK_SWITCH_NOTE = 'kimi takes no per-run network switch — its web tools and its shell keep the network; this persona is not allowed it';

export function kimiHarness(readUsage: KimiUsageReader): AcpHarness {
  return {
    id: 'kimi',
    label: 'Kimi Code',
    agent: 'kimi',
    // req-177: a second Kimi account is its own KIMI_HOME, handed in through the slot's environment.
    launch: (start) => ({ command: 'kimi', args: ['acp'], ...(start.network === false ? { note: KIMI_NO_NETWORK_SWITCH_NOTE } : {}) }),
    clientCapabilities: {},
    resume: ['load'],
    modelSettings: (model) => [{ configId: 'model', value: model }],
    modeFor: kimiModeFor,
    meter: () => new KimiWireMeter(readUsage),
    emptyTurnIsRefusal: false,
  };
}

export function kimiAdapter(spawnFn: SpawnFn, readUsage: KimiUsageReader = async () => [], now: NowFn = (): Date => new Date()): ProviderAdapter {
  return new AcpAdapter(kimiHarness(readUsage), spawnFn, now);
}
