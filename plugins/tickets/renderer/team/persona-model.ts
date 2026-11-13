// i18n: catalog
/**
 * The Persona page's pure model (board 7k, milestone 201; page v2, R11,
 * milestone 231): the tab's key, the persona's files, what the form edits
 * and which keys a Save sends (`personaPatch` writes only the sent keys, one
 * commit). DOM-free, so the page, its blocks and the spec share it.
 */
import type { PersonaAllowedPatch } from '../../../../packages/tickets-engine/src/contracts/persona-allowed';
import type { PersonaRunCommands } from '../../../../packages/tickets-engine/src/core/persona';
import type { PersonaSettingsPatch } from '../../../../packages/tickets-engine/src/contracts/persona-settings-patch';
import type { PersonaView } from '../../shared/remote-protocol';
import { savedSettingsOf, settingsDraftOf, settingsPatchOf, type SettingsDraft } from './persona-settings-model';
import { roleLabel } from './team-model';

export const PERSONA_KIND = 'tickets-persona';

const PERSONA_KEY_SCHEME = 'persona://';

export function personaKeyOf(id: string): string {
  return `${PERSONA_KEY_SCHEME}${id}`;
}

/** The persona id of a tab's key; '' for any other key. */
export function personaIdOfKey(key: string): string {
  return key.startsWith(PERSONA_KEY_SCHEME) ? key.slice(PERSONA_KEY_SCHEME.length) : '';
}

/** The persona's files in the vault, in full (read, opened) and as the page writes them. */
export function personaPathsOf(id: string): { readonly persona: string; readonly prompt: string; readonly personaShort: string; readonly promptShort: string; readonly dirShort: string } {
  return {
    persona: `tickets/_meta/personas/${id}/persona.md`,
    prompt: `tickets/_meta/personas/${id}/prompt.md`,
    personaShort: `personas/${id}/persona.md`,
    promptShort: `personas/${id}/prompt.md`,
    dirShort: `personas/${id}/`,
  };
}

/** The roles the record knows, in crew order (`PERSONA_ROLES`); the Role dropdown offers exactly these. */
export const ROLE_OPTIONS = ['planner', 'builder', 'reviewer', 'tester', 'custom'] as const;

/** The `Allowed to` block as the form edits it; `runCommands` '' = the crew setting decides. */
export interface AllowedDraft {
  readonly writeVaults: readonly string[];
  readonly runCommands: '' | PersonaRunCommands;
  readonly network: boolean;
  readonly spend: boolean;
}

/** What the form edits; the role as the field shows it (`Builder`). */
export interface PersonaDraft {
  readonly title: string;
  readonly role: string;
  readonly summary: string;
  /** The harness (`worker`): `claude-code`, `opencode`, `kimi`, `copilot`. */
  readonly worker: string;
  /** The daily budget as typed, dollars; '' = none. */
  readonly budget: string;
  readonly prompt: string;
  readonly pool: readonly string[];
  readonly allowed: AllowedDraft;
  /** The Work block's run settings (req-258). */
  readonly settings: SettingsDraft;
  /** Mission Control's persona only (req-293): the model id her turns use; '' = the same as the assistant. */
  readonly chatModel: string;
}

/** The keys a Save sends. */
export interface PersonaPatchKeys {
  title?: string;
  role?: string;
  summary?: string;
  worker?: string;
  budget?: number | null;
  prompt?: string;
  pool?: readonly string[];
  allowed?: PersonaAllowedPatch;
  settings?: PersonaSettingsPatch;
  /** null = back to the assistant's model. */
  chatModel?: string | null;
}

function allowedOf(view: PersonaView): AllowedDraft {
  return {
    writeVaults: view.allowed?.writeVaults ?? [],
    runCommands: view.allowed?.runCommands ?? '',
    network: view.allowed?.network === true,
    spend: view.allowed?.spendAboveAllowance === true,
  };
}

export function draftOf(view: PersonaView, prompt: string): PersonaDraft {
  return {
    title: view.title,
    role: roleLabel(view.role),
    summary: view.summary ?? '',
    worker: view.worker,
    budget: view.budget === null ? '' : String(view.budget),
    prompt,
    pool: view.pool.length > 0 ? view.pool : view.model === '' ? [] : [view.model],
    allowed: allowedOf(view),
    settings: settingsDraftOf(view),
    chatModel: view.chatModel ?? '',
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Only the `allowed:` keys that differ: the engine replaces what it is sent. */
function allowedPatchOf(base: AllowedDraft, draft: AllowedDraft): PersonaAllowedPatch | null {
  const patch: { -readonly [K in keyof PersonaAllowedPatch]: PersonaAllowedPatch[K] } = {};
  if (!sameList(draft.writeVaults, base.writeVaults)) {
    patch.writeVaults = draft.writeVaults;
  }
  if (draft.runCommands !== base.runCommands) {
    patch.runCommands = draft.runCommands === '' ? null : draft.runCommands;
  }
  if (draft.network !== base.network) {
    patch.network = draft.network;
  }
  if (draft.spend !== base.spend) {
    patch.spendAboveAllowance = draft.spend;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** The typed budget as the record holds it: dollars, null for none, undefined for text that is no amount (it sends nothing). */
export function budgetOf(text: string): number | null | undefined {
  const trimmed = text.trim().replace(/^\$/, '');
  if (trimmed === '') {
    return null;
  }
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

/** Only what differs from the record: the engine writes the sent keys and one commit. The role goes as the engine's word. */
export function patchOf(base: PersonaDraft, draft: PersonaDraft): PersonaPatchKeys {
  const patch: PersonaPatchKeys = {};
  if (draft.title.trim() !== base.title.trim()) {
    patch.title = draft.title.trim();
  }
  const role = draft.role.trim().toLowerCase();
  if (role !== base.role.trim().toLowerCase()) {
    patch.role = role;
  }
  if (draft.summary.trim() !== base.summary.trim()) {
    patch.summary = draft.summary.trim();
  }
  if (draft.worker !== base.worker && draft.worker.trim() !== '') {
    patch.worker = draft.worker.trim();
  }
  const budget = budgetOf(draft.budget);
  if (budget !== undefined && budget !== budgetOf(base.budget)) {
    patch.budget = budget;
  }
  if (draft.prompt !== base.prompt) {
    patch.prompt = draft.prompt;
  }
  if (!sameList(draft.pool, base.pool)) {
    patch.pool = draft.pool;
  }
  const allowed = allowedPatchOf(base.allowed, draft.allowed);
  if (allowed !== null) {
    patch.allowed = allowed;
  }
  const settings = settingsPatchOf(base.settings, draft.settings, Object.keys(patch).length > 0);
  if (settings !== null) {
    patch.settings = settings;
  }
  if (draft.chatModel.trim() !== base.chatModel.trim()) {
    patch.chatModel = draft.chatModel.trim() === '' ? null : draft.chatModel.trim();
  }
  return patch;
}

export function isDirty(base: PersonaDraft, draft: PersonaDraft): boolean {
  return Object.keys(patchOf(base, draft)).length > 0;
}

/** The base after a Save of `draft`: what the form now shows is what the record holds. */
export function savedBaseOf(draft: PersonaDraft): PersonaDraft {
  return { ...draft, title: draft.title.trim(), role: roleLabel(draft.role.trim().toLowerCase()), summary: draft.summary.trim(), worker: draft.worker.trim(), budget: draft.budget.trim().replace(/^\$/, ''), settings: savedSettingsOf(draft.settings), chatModel: draft.chatModel.trim() };
}

/** The instructions' length as the status bar shows it. */
export function wordsOf(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** A failed read that only means the file is not there yet (a persona without a prompt.md). */
export function isMissingFileError(error: unknown): boolean {
  return /ENOENT|no such file/i.test(error instanceof Error ? error.message : String(error));
}
