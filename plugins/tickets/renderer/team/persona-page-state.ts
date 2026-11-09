// i18n: catalog
/**
 * What the Persona page holds between a load and a close, apart from its
 * DOM: the loaded record with the draft over it, and the few flags a Save
 * or a decision sets. The page, its actions and the spec share these types;
 * nothing here touches the DOM.
 */
import type { ImprovementProposal } from '../../../../packages/tickets-engine/src/core/improvements';
import type { PersonaView } from '../../shared/remote-protocol';
import type { BlockContext } from './persona-block-context';
import type { InstructionsBlock } from './persona-instructions-block';
import type { SkillsBlock } from './persona-skills-block';
import type { PersonaDraft } from './persona-model';
import type { PersonaReads, PromptRead } from './persona-page-load';

/** Everything the page holds once the persona is loaded. */
export interface Loaded {
  view: PersonaView;
  base: PersonaDraft;
  draft: PersonaDraft;
  reads: PersonaReads;
  promptRead: PromptRead;
  proposal: ImprovementProposal | null;
  instructions: InstructionsBlock;
  skills: SkillsBlock;
  ctx: BlockContext;
}

/** The page's mutable session; one per mounted page. */
export interface PageSession {
  loaded: Loaded | null;
  /** A Save is running. */
  busy: boolean;
  /** The line the head shows in place of Saved / Changed (a refusal, the git warning); '' = none. */
  message: string;
  messageIsError: boolean;
  /** What the last paint of the loaded page depended on (`keyOf`). */
  viewKey: string;
  /** When `personas/<id>/` was last committed (ISO), as the Crew store last said; null = unknown. */
  committedAt: string | null;
}

export function newSession(): PageSession {
  return { loaded: null, busy: false, message: '', messageIsError: false, viewKey: '', committedAt: null };
}

/** The unsaved edits per persona: switching tabs remounts the page, a typed draft must survive that. */
export const drafts = new Map<string, PersonaDraft>();

/** The words of the instructions per open persona page, for the status bar; null while not loaded. */
export const wordCounts = new Map<string, number>();
