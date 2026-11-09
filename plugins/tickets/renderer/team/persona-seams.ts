// i18n: catalog
/**
 * The two engine reads of the Persona page that came with skills as Agent
 * Skills (milestone 232, req-172): a persona's skills with their switch,
 * removal and upload, and the brief a run would start with. Both are named
 * here so the wiring is one file and a spec swaps them for fakes; the
 * implementations call the plugin's IPC (`personaSkills`,
 * `personaSkillToggle`, `personaSkillRemove`, `skillUpload`,
 * `personaPromptPreview`), which the engine answers with a stable `code` per
 * failure (`skills.error.<code>` in the catalog). A transport failure is a
 * failure with no code and the thrown text.
 */
import type { PromptPreviewReply, SkillErrorCode, SkillListData, SkillUploadCommand, SkillUploadReply } from '../../../../packages/tickets-engine/src/contracts/skills';
import { SKILL_ERROR_CODES } from '../../../../packages/tickets-engine/src/contracts/skills';

/** What a failed skill call tells the page. */
export interface SkillsFailure {
  readonly ok: false;
  /** The engine's code; null for a failure that is no engine refusal (the transport, an unknown code). */
  readonly code: SkillErrorCode | null;
  readonly error: string;
}

export type SkillsResult = { readonly ok: true; readonly list: SkillListData } | SkillsFailure;

export type UploadResult = { readonly ok: true; readonly name: string; readonly replaced: boolean; readonly list: SkillListData } | SkillsFailure;

export interface PersonaSkillsSeam {
  list(persona: string): Promise<SkillsResult>;
  toggle(persona: string, skill: string, on: boolean): Promise<SkillsResult>;
  /** Deletes an own skill's folder; the engine refuses a shared one. */
  remove(persona: string, name: string): Promise<SkillsResult>;
  upload(command: SkillUploadCommand): Promise<UploadResult>;
}

/** The brief a run would start with: the text, the total and the parts the engine counted (an estimate, `exact: false`). */
export type PromptPreview = Extract<PromptPreviewReply, { ok: true }>;

export type PreviewResult = { readonly ok: true; readonly preview: PromptPreview } | SkillsFailure;

export interface PromptPreviewSeam {
  /** The brief for `step` (default: the engine's `build`) counted for `model`'s family (default: the persona's own). */
  preview(persona: string, options: { readonly step?: string; readonly model?: string }): Promise<PreviewResult>;
}

export type Invoke = (method: string, payload?: unknown) => Promise<unknown>;

const isCode = (code: unknown): code is SkillErrorCode => (SKILL_ERROR_CODES as readonly unknown[]).includes(code);

/** An answer that is no object is the engine's `internal`; an unknown code keeps the engine's own text; no text at all falls to the catalog's `internal` line. */
function failureOf(reply: unknown): SkillsFailure {
  if (reply === null || typeof reply !== 'object') {
    return { ok: false, code: 'internal', error: '' };
  }
  const { code, error } = reply as { code?: unknown; error?: unknown };
  return { ok: false, code: isCode(code) ? code : null, error: typeof error === 'string' ? error : '' };
}

async function call<T extends { readonly ok: boolean }>(invoke: Invoke, method: string, payload: unknown): Promise<T | SkillsFailure> {
  try {
    const reply = (await invoke(method, payload)) as T | null;
    return reply !== null && typeof reply === 'object' && reply.ok === true ? reply : failureOf(reply);
  } catch (error) {
    return { ok: false, code: null, error: error instanceof Error ? error.message : String(error) };
  }
}

const listOf = (reply: { readonly ok: true; readonly list: SkillListData } | SkillsFailure): SkillsResult => (reply.ok ? { ok: true, list: reply.list } : reply);

/** The seam over the engine's skill routes. */
export function engineSkillsSeam(invoke: Invoke): PersonaSkillsSeam {
  type Listing = { readonly ok: true; readonly list: SkillListData };
  return {
    list: async (persona) => listOf(await call<Listing>(invoke, 'personaSkills', { persona })),
    toggle: async (persona, skill, on) => listOf(await call<Listing>(invoke, 'personaSkillToggle', { persona, skill, on })),
    remove: async (persona, name) => listOf(await call<Listing>(invoke, 'personaSkillRemove', { persona, name })),
    upload: async (command) => {
      const reply = await call<Extract<SkillUploadReply, { ok: true }>>(invoke, 'skillUpload', command);
      return reply.ok ? { ok: true, name: reply.name, replaced: reply.replaced, list: reply.list } : reply;
    },
  };
}

/** The seam over `personaPromptPreview`. */
export function enginePromptPreviewSeam(invoke: Invoke): PromptPreviewSeam {
  return {
    preview: async (persona, options) => {
      const reply = await call<PromptPreview>(invoke, 'personaPromptPreview', { persona, ...options });
      return reply.ok ? { ok: true, preview: reply } : reply;
    },
  };
}
