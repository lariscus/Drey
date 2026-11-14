// i18n: catalog
/**
 * What the Persona page reads when it opens, apart from the record the Crew
 * store already holds: the prompt file, the model table with the slots, the
 * registered vaults, the counts of memory and journal. Each read
 * may fail on its own (an engine without a runner, no vault) and then leaves
 * its part empty; only the prompt file and the proposals are load-critical.
 */
import type { ChatModelsReply } from '../../../../packages/tickets-engine/src/contracts/chat-models';
import type { ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol-slots';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { DeskDeps } from '../desk-deps';
import type { PageExtras } from './persona-block-context';
import { isMissingFileError } from './persona-model';

export type PromptRead = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

/** The editor holds LF; the file may not: the page compares and saves in LF. */
export const lf = (text: string): string => text.replace(/\r\n/g, '\n');

export async function readPromptFile(api: DreyPluginApi, vaultId: string | null, path: string, noVault: string): Promise<PromptRead> {
  if (vaultId === null) {
    return { ok: false, error: noVault };
  }
  try {
    return { ok: true, text: lf((await api.vault.readFile(path, { vaultId })).content) };
  } catch (error) {
    return isMissingFileError(error) ? { ok: true, text: '' } : { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const quiet = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch {
    return null;
  }
};

const countOf = (reply: unknown): number | null => {
  const entries = (reply as { ok?: boolean; entries?: readonly unknown[] } | null)?.entries;
  return (reply as { ok?: boolean } | null)?.ok === true && Array.isArray(entries) ? entries.length : null;
};

/**
 * req-288: the model table as `service.json` holds it, when no runner is awake to answer `poolModels`
 * (it never wakes one): the classes and the rows, no live load — nothing runs while the runner sleeps.
 */
async function fileTableOf(deps: DeskDeps): Promise<ModelsReply | null> {
  const reply = (await deps.invoke('modelTable')) as { ok?: unknown; classes?: unknown; models?: unknown } | null;
  if (reply === null || reply.ok !== true || !Array.isArray(reply.classes) || !Array.isArray(reply.models)) {
    return null;
  }
  return { ok: true, classes: reply.classes, models: reply.models, now: { used: 0, global: null, slots: [], classes: [] } } as unknown as ModelsReply;
}

export interface PersonaReads {
  readonly extras: PageExtras;
  readonly memory: number | null;
  readonly journal: number | null;
}

export async function readBeside(deps: DeskDeps, id: string, mission = false): Promise<PersonaReads> {
  const [table, slotReply, memory, journal, chatModels] = await Promise.all([
    quiet(async () => ((await deps.invoke('poolModels')) as ModelsReply | null) ?? (await fileTableOf(deps))),
    quiet(async () => (await deps.invoke('slots')) as { readonly slots?: readonly SlotView[] } | null),
    quiet(() => deps.invoke('personaMemory', { persona: id })),
    quiet(() => deps.invoke('personaJournal', { persona: id })),
    mission ? quiet(async () => (await deps.invoke('chatModels')) as ChatModelsReply | null) : Promise.resolve(null),
  ]);
  return {
    extras: {
      chatModels,
      table: table?.ok === true ? table : null,
      slots: slotReply?.slots ?? [],
    },
    memory: countOf(memory),
    journal: countOf(journal),
  };
}
