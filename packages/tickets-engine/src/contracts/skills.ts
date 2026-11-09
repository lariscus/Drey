/**
 * Skills as Agent Skills (req-172, R8): what the skill routes carry.
 *
 * A skill is a folder `<name>/SKILL.md` in Anthropic's Agent Skills format —
 * frontmatter `name:` and `description:` (optional `license`, `allowed-tools`,
 * `metadata`) and a Markdown body — plus any files beside it. The shared home
 * is `tickets/_meta/skills/<name>/`, a persona's own is
 * `tickets/_meta/personas/<id>/skills/<name>/`; an own skill overrides a
 * shared one of the same name. The persona's `skills:` list in `persona.md`
 * is its selection: a skill that is in a folder but not in the list is
 * *available, off*. The table of routes is in `specs/ticket-schema.md`
 * ("Skills").
 *
 * Every failure carries a stable `code`; a client shows its own catalog text
 * for the code (`skills.error.<code>` in `shared/i18n/catalog/en.json`) and
 * falls back to the English `error` only for a code it does not know.
 */

export const SKILL_ERROR_CODES = [
  'no_vault',
  'no_persona',
  'no_skill',
  'bad_name',
  'bad_scope',
  'bad_skill_file',
  'bad_archive',
  'path_escape',
  'exists',
  'too_large',
  'not_own',
  'internal',
] as const;

export type SkillErrorCode = (typeof SKILL_ERROR_CODES)[number];

export interface SkillFailure {
  readonly ok: false;
  readonly code: SkillErrorCode;
  /** English text for logs and for a client that does not know the code. */
  readonly error: string;
}

export type SkillsReply<T> = ({ readonly ok: true } & T) | SkillFailure;

export type SkillOrigin = 'own' | 'shared';

/** Which family's counting rule a token figure follows; both are estimates (no tokenizer ships offline). */
export type TokenizerId = 'claude-estimate' | 'openai-estimate';

export interface TokenizerView {
  readonly id: TokenizerId;
  readonly family: 'anthropic' | 'openai-compatible';
  /** Always false in this milestone: a figure is an estimate, never the provider's own count. */
  readonly exact: boolean;
  /** The model the family was chosen by; null when only the worker decided. */
  readonly model: string | null;
}

/** One skill as the listing shows it: the effective one of its name (an own skill hides the shared one it overrides). */
export interface SkillView {
  readonly name: string;
  readonly description: string;
  readonly origin: SkillOrigin;
  /** In the persona's `skills:` list; always false on the shared listing. */
  readonly on: boolean;
  /** An own skill that overrides a shared skill of the same name. */
  readonly overridesShared: boolean;
  /** Still a flat `<name>.md` (the migration has not run, or could not). */
  readonly legacy: boolean;
  /** Bytes of the `SKILL.md` text. */
  readonly size: number;
  /** Estimated tokens of what a run loads: the body, under its name. */
  readonly tokens: number;
  /** Files beside `SKILL.md` in the folder (scripts, references); never loaded into a prompt. */
  readonly files: number;
  readonly allowedTools: readonly string[];
  readonly license: string | null;
  /** The frontmatter's own name when it differs from the folder (the folder wins); null otherwise. */
  readonly declaredName: string | null;
}

export interface SkillListData {
  /** The persona the listing is for; null on the shared pool's listing. */
  readonly persona: string | null;
  readonly skills: readonly SkillView[];
  /** Names in `skills:` that no folder holds (the run goes on without them). */
  readonly missing: readonly string[];
  /** Estimated tokens of the selected skills together (what `## Skills` costs). */
  readonly selectedTokens: number;
  readonly tokenizer: TokenizerView;
}

export type SkillListReply = SkillsReply<{ readonly list: SkillListData }>;

/** `POST /api/personas/<id>/skills/toggle`: the skill joins or leaves `skills:`; one commit. */
export interface SkillToggleCommand {
  readonly persona: string;
  readonly skill: string;
  readonly on: boolean;
}

/** `POST /api/personas/<id>/skills/remove`: deletes an own skill's folder; one commit. A shared skill is never deleted here. */
export interface SkillRemoveCommand {
  readonly persona: string;
  readonly name: string;
}

/**
 * `POST /api/skills`: uploads a skill. `markdown` is the text of one
 * `SKILL.md` (the folder name is `name`, else the frontmatter's); `zip` is a
 * zipped skill folder — `SKILL.md` at the archive root or inside one top
 * folder — as base64. An existing folder of that name is refused unless
 * `overwrite` is true.
 */
export interface SkillUploadCommand {
  readonly scope: SkillOrigin;
  /** The persona an own skill belongs to; required when `scope` is `own`. */
  readonly persona?: string;
  readonly format: 'markdown' | 'zip';
  readonly name?: string;
  readonly text?: string;
  readonly zipBase64?: string;
  readonly overwrite?: boolean;
}

export type SkillUploadReply = SkillsReply<{
  readonly name: string;
  readonly origin: SkillOrigin;
  /** Files written, `SKILL.md` included. */
  readonly files: number;
  /** True when an existing folder was replaced. */
  readonly replaced: boolean;
  readonly list: SkillListData;
}>;

/** `GET /api/personas/<id>/prompt?step=<phase>&model=<model>`. */
export interface PromptPreviewCommand {
  readonly persona: string;
  /** The pipeline step the brief is for (the instruction's `phase`); default `build`. */
  readonly step?: string;
  /** The model whose family counts the tokens; default the persona's own. */
  readonly model?: string;
}

export interface PromptPartTokens {
  readonly name: string;
  readonly tokens: number;
}

/** The brief a run of this persona would start with, and what it costs. */
export type PromptPreviewReply = SkillsReply<{
  readonly persona: string;
  readonly step: string;
  /** The instruction exactly as the composer builds it; the ticket-bound parts carry placeholders. */
  readonly text: string;
  readonly tokens: number;
  readonly tokenizer: TokenizerView;
  /** `instructions`, `skills`, `memory` and `rest` (everything else), in the order they sit in the text. */
  readonly parts: readonly PromptPartTokens[];
  /** The selected skills, each as the run loads it. */
  readonly skills: readonly PromptPartTokens[];
}>;

/** The routes' port: what the engine, the plugin's IPC and the remote protocol all call. */
export interface SkillsPort {
  /** The shared pool: `tickets/_meta/skills/`. */
  sharedSkills(): Promise<SkillListReply>;
  personaSkills(personaId: string): Promise<SkillListReply>;
  personaSkillToggle(cmd: SkillToggleCommand): Promise<SkillListReply>;
  personaSkillRemove(cmd: SkillRemoveCommand): Promise<SkillListReply>;
  skillUpload(cmd: SkillUploadCommand): Promise<SkillUploadReply>;
  personaPromptPreview(cmd: PromptPreviewCommand): Promise<PromptPreviewReply>;
}
