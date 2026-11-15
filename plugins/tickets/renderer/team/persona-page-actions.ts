// i18n: catalog
/**
 * The two things the Persona page does to the engine: Save (one
 * `personaPatch`, one commit to `personas/<id>/`) and a decision on a
 * proposal (Apply / Dismiss over the improvements routes). They change the
 * session and ask the page to repaint through the environment the page
 * hands them; no DOM here.
 */
import type { ImprovementProposal } from '../../../../packages/tickets-engine/src/core/persona/improvements';
import type { PersonaImprovementsReply } from '../../shared/remote-protocol';
import type { DeskDeps } from '../board/desk-deps';
import type { Translate } from './persona-dom';
import { patchOf, savedBaseOf } from './persona-model';
import type { PromptRead } from './persona-page-load';
import { drafts, type PageSession } from './persona-page-state';
import type { TeamStore } from './team-store';

export interface ActionEnv {
  readonly deps: DeskDeps;
  readonly t: Translate;
  readonly id: string;
  readonly store: TeamStore;
  readonly session: PageSession;
  readPrompt(): Promise<PromptRead>;
  improvementsOf(): Promise<PersonaImprovementsReply>;
  /** The tab follows the persona's name. */
  retitle(title: string): void;
  /** Repaints the page. */
  render(): void;
  /** Refreshes the head's save state and the buttons. */
  sync(): void;
  /** Shows a refusal in the head. */
  fail(text: string): void;
  /** The persona's key: what a repaint of the loaded page depends on. */
  keyOf(persona: NonNullable<PageSession['loaded']>['view']): string;
}

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const openProposalOf = (reply: PersonaImprovementsReply): ImprovementProposal | null => (reply.ok ? (reply.proposals.find((entry) => entry.state === 'open') ?? null) : null);

/** Save: only what differs goes, in one patch; a prompt that moved on disk since the page read it is refused. */
export async function savePersona(env: ActionEnv): Promise<void> {
  const { session, t, id } = env;
  const loaded = session.loaded;
  if (loaded === null || session.busy || !loaded.promptRead.ok) {
    return;
  }
  const { base, draft } = loaded;
  const patch = patchOf(base, draft);
  if (Object.keys(patch).length === 0) {
    return;
  }
  session.busy = true;
  env.sync();
  try {
    if (patch.prompt !== undefined) {
      // The file may have moved on since the page read it (Mission Control writes it too).
      const fresh = await env.readPrompt();
      if (!fresh.ok || fresh.text !== base.prompt) {
        env.fail(t('persona.page.prompt_moved'));
        return;
      }
    }
    const reply = (await env.deps.invoke('personaPatch', { persona: id, ...patch })) as { ok: boolean; error?: string; warning?: string };
    if (!reply.ok) {
      env.fail(reply.error ?? t('persona.page.save_failed'));
      return;
    }
    drafts.delete(id);
    loaded.base = savedBaseOf(draft);
    loaded.draft = loaded.base;
    loaded.promptRead = { ok: true, text: loaded.base.prompt };
    session.message = reply.warning ?? '';
    session.messageIsError = false;
    env.retitle(loaded.base.title);
    await env.store.refresh();
    const saved = env.store.personas().find((entry) => entry.id === id);
    if (saved !== undefined) {
      loaded.view = saved;
      loaded.ctx = { ...loaded.ctx, persona: saved };
      session.viewKey = env.keyOf(saved);
    }
  } catch (error) {
    env.fail(textOf(error));
  } finally {
    session.busy = false;
    env.render();
  }
}

/** Dismiss or Apply; an applied prompt proposal rewrote `prompt.md`, so the page reads it again. */
export async function decideProposal(env: ActionEnv, proposal: ImprovementProposal, decision: 'accepted' | 'dismissed'): Promise<void> {
  try {
    const reply = (await env.deps.invoke('personaImprovementDecide', { persona: env.id, proposal: proposal.id, decision })) as { ok: boolean; error?: string };
    if (!reply.ok) {
      env.fail(reply.error ?? env.t('persona.page.save_failed'));
      return;
    }
    const improvements = await env.improvementsOf();
    const loaded = env.session.loaded;
    if (loaded === null) {
      return;
    }
    loaded.proposal = openProposalOf(improvements);
    if (decision === 'accepted' && proposal.target === 'prompt.md') {
      const fresh = await env.readPrompt();
      if (fresh.ok) {
        loaded.base = { ...loaded.base, prompt: fresh.text };
        loaded.draft = { ...loaded.draft, prompt: fresh.text };
        loaded.instructions.setText(fresh.text);
      }
    }
    env.render();
  } catch (error) {
    env.fail(textOf(error));
  }
}
