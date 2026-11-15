// i18n: catalog
/**
 * What the Persona page hands every block (`BlockContext`), built in one
 * place: the persona and the data read beside it, the two engine-backed
 * states (skills, prompt preview), and the draft with the two ways to
 * change it. The page owns the session, the load and the repaint; this only
 * assembles what the blocks see.
 */
import type { PersonaView } from '../../shared/remote-protocol';
import type { DeskDeps } from '../board/desk-deps';
import type { BlockContext } from './persona-block-context';
import type { PersonaDraft, personaPathsOf } from './persona-model';
import type { PersonaReads } from './persona-page-load';
import type { PageSession } from './persona-page-state';
import type { PersonaPreviewState } from './persona-preview-state';
import type { PersonaSkillsState } from './persona-skills-state';

export interface ContextParts {
  readonly deps: DeskDeps;
  readonly t: BlockContext['t'];
  readonly view: PersonaView;
  readonly reads: PersonaReads;
  readonly base: PersonaDraft;
  readonly paths: ReturnType<typeof personaPathsOf>;
  readonly skills: PersonaSkillsState;
  readonly preview: PersonaPreviewState;
  readonly session: PageSession;
  readonly edit: (next: Partial<PersonaDraft>) => void;
  /** The page repaints after the change. */
  readonly repaint: () => void;
  /** req-288: reads the persona list again (a picture changed outside the Save). */
  readonly refreshPersonas: () => Promise<void>;
}

/** What a repaint of a loaded page depends on; the day's cost, the pause and the commit age do not count. */
export const viewKeyOf = (persona: PersonaView, deps: DeskDeps): string =>
  JSON.stringify([persona.title, persona.role, persona.class, persona.model, persona.avatarVersion, persona.color, persona.budget, persona.phases, persona.summary, persona.allowed, persona.chatModel, deps.snapshot()?.pipeline.map((phase) => phase.id)]);

export function blockContextOf(parts: ContextParts): BlockContext {
  const { deps, session, base } = parts;
  return {
    deps,
    api: deps.api,
    t: parts.t,
    persona: parts.view,
    extras: parts.reads.extras,
    paths: parts.paths,
    skills: parts.skills,
    preview: parts.preview,
    draft: () => session.loaded?.draft ?? base,
    edit: parts.edit,
    change: (next) => {
      parts.edit(next);
      parts.repaint();
    },
    refreshPersonas: parts.refreshPersonas,
  };
}
