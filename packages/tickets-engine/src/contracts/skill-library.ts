/**
 * Settings → Skills library (req-289, board 7o): every skill of the board in
 * one list — the shared pool, the skills fetched from GitHub sources, the
 * personas' own — with who uses each, and the GitHub sources themselves. A
 * fetched skill is an Agent Skills folder in `tickets/_meta/skills/<name>/`
 * like an uploaded one; its source is recorded in
 * `tickets/_meta/skill-sources.md`. Fetching is a network call and happens
 * only on the owner's action (Fetch, Update, and the look for newer refs when
 * the page opens); a public repository needs no token. Failures carry the
 * codes of `contracts/skills.ts`.
 */
import type { SkillFailure, SkillOrigin, SkillSourceRef, SkillsReply } from './skills';

/** A persona in a skill's *Used by*: enough for its circle. */
export interface SkillUser {
  readonly id: string;
  readonly title: string;
  readonly color: string;
}

/** One row of the library: a shared skill (fetched or not) or one persona's own skill. */
export interface SkillLibraryRow {
  readonly name: string;
  readonly description: string;
  readonly origin: SkillOrigin;
  /** The persona an own skill belongs to; null for a shared one. */
  readonly persona: string | null;
  readonly source: SkillSourceRef | null;
  readonly updateAvailable: string | null;
  /** Estimated tokens of what a run loads of it. */
  readonly tokens: number;
  readonly size: number;
  /** The personas that select it and get this one (an own skill of theirs of that name hides a shared one). */
  readonly usedBy: readonly SkillUser[];
}

/** One GitHub source as the Sources list shows it. */
export interface SkillSourceView extends SkillSourceRef {
  /** `repo` and `path` as one string — the source's identity, e.g. `github.com/acme/skills/skills/e2e`. */
  readonly id: string;
  /** The skill folders it brought, by name. */
  readonly skills: readonly string[];
  /** When the files were fetched (ISO). */
  readonly fetched: string;
  /** The newer ref the last look found; null when none (or none was looked for). */
  readonly updateAvailable: string | null;
  /** When the last look for a newer ref ran (ISO); null = not yet in this service's life. */
  readonly checked: string | null;
  /** Why the last look failed; null when it did not. */
  readonly checkError: string | null;
}

export interface SkillLibraryData {
  readonly sources: readonly SkillSourceView[];
  readonly skills: readonly SkillLibraryRow[];
}

/** `skillLibrary`: `check` also asks GitHub for newer refs of the sources (the page's first look). */
export interface SkillLibraryCommand {
  readonly check?: boolean;
}

export type SkillLibraryReply = SkillsReply<{ readonly library: SkillLibraryData }>;

/** `skillSourceFetch`: a new source — every skill folder under `path` at `ref`, one commit. */
export interface SkillSourceFetchCommand {
  /** `github.com/<owner>/<repo>`, `https://github.com/<owner>/<repo>(.git)` or `<owner>/<repo>`. */
  readonly repo: string;
  readonly path?: string;
  readonly ref: string;
}

/** `skillSourceUpdate`: the source's skills fetched again at `to` (default its own ref), one commit. */
export interface SkillSourceUpdateCommand {
  readonly source: string;
  readonly to?: string;
}

/** `skillSourceRemove`: the source's skill folders and its record leave, one commit. */
export interface SkillSourceRemoveCommand {
  readonly source: string;
}

/** `skillDelete`: a shared skill's folder (and its name in a source's record), or `persona`'s own skill; one commit. */
export interface SkillDeleteCommand {
  readonly name: string;
  readonly persona?: string;
}

/** A skill folder of a source that was not taken, and why. */
export interface SkippedSkill {
  readonly folder: string;
  readonly code: SkillFailure['code'];
  readonly error: string;
}

export type SkillSourceReply = SkillsReply<{
  readonly library: SkillLibraryData;
  /** The source the write was about (absent after a removal). */
  readonly source?: string;
  readonly skipped: readonly SkippedSkill[];
  /** A commit that did not happen (a vault outside git); null when all went well. */
  readonly warning: string | null;
}>;

/** The port the invoke table calls. */
export interface SkillLibraryPort {
  skillLibrary(cmd?: SkillLibraryCommand): Promise<SkillLibraryReply>;
  skillSourceFetch(cmd: SkillSourceFetchCommand): Promise<SkillSourceReply>;
  skillSourceUpdate(cmd: SkillSourceUpdateCommand): Promise<SkillSourceReply>;
  skillSourceRemove(cmd: SkillSourceRemoveCommand): Promise<SkillSourceReply>;
  skillDelete(cmd: SkillDeleteCommand): Promise<SkillSourceReply>;
}
