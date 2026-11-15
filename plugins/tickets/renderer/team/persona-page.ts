// i18n: catalog
/**
 * The Persona page (board 7k, milestone 201; rebuilt to the R11 mockup in
 * milestone 231, req-171; v4, req-295): a tab of its own, opened by a click on
 * a persona's card on the Crew tab. Head (state, today's cost, Pause), two
 * columns — Profile, Work, Allowed to | tabs Instructions (Drey's Markdown
 * editor, Skills, Proposals) · Memory · 1:1; for Mission Control's persona
 * Profile, Model, Skills | the same tabs — and one Save: what the form
 * changed goes as one `personaPatch`, one commit to `personas/<id>/`. Plain
 * DOM; each block is a file of its own over `persona-model.ts`, the page
 * composes them (`persona-page-columns.ts`) and owns the load and the
 * repaint, `persona-page-actions.ts` the Save and the decisions.
 */
import type { PersonaImprovementsReply, PersonaView } from '../../shared/remote-protocol';
import { h, type DeskDeps } from '../board/desk-deps';
import type { BlockContext } from './persona-block-context';
import { askPersonaDelete } from './persona-delete-action';
import { personaHead, savedTextOf, type PersonaHead } from './persona-head';
import { columnsOf } from './persona-page-columns';
import type { PersonaTab } from './persona-tabs';
import { teamModelOf } from './team-model';
import { createInstructionsBlock } from './persona-instructions-block';
import { draftOf, isDirty, personaPathsOf, wordsOf, type PersonaDraft } from './persona-model';
import { decideProposal, openProposalOf, savePersona, type ActionEnv } from './persona-page-actions';
import { blockContextOf, viewKeyOf } from './persona-page-context';
import { readBeside, readPromptFile, type PromptRead } from './persona-page-load';
import { pageFoot, type PageFoot } from './persona-page-foot';
import { drafts, newSession, wordCounts } from './persona-page-state';
import { syncApply } from './persona-proposals-block';
import { PersonaPreviewState } from './persona-preview-state';
import { previewRequestOf } from './persona-preview-model';
import { enginePromptPreviewSeam, engineSkillsSeam, type PersonaSkillsSeam, type PromptPreviewSeam } from './persona-seams';
import { createSkillsBlock } from './persona-skills-block';
import { PersonaSkillsState } from './persona-skills-state';
import type { TeamStore } from './team-store';

/** How soon a failed load tries again: the engine may be restarting, and the board may stay quiet meanwhile. */
const LOAD_RETRY_MS = 2_000;

/** How often a clean page looks at the prompt file again after a board change. */
const PROMPT_REREAD_MS = 4_000;

export function personaWordCountOf(id: string): number | null {
  return wordCounts.get(id) ?? null;
}

export interface PersonaPageHost {
  /** Back to Crew. */
  back(): void;
  /** The persona's name changed: the tab follows. */
  retitle(title: string): void;
  /** The persona was deleted (req-261): the tab leaves for Crew. */
  removed(): void;
}

/** The two engine-backed seams (skills, prompt preview); a spec swaps them. */
export interface PersonaPageSeams {
  readonly skills?: PersonaSkillsSeam;
  readonly preview?: PromptPreviewSeam;
}

export function mountPersonaPage(deps: DeskDeps, store: TeamStore, mountHost: HTMLElement, id: string, host: PersonaPageHost, seams: PersonaPageSeams = {}): () => void {
  const { api } = deps;
  const t: BlockContext['t'] = (key, params) => api.i18n.t(key, params);
  const paths = personaPathsOf(id);
  const root = h('div', 'persona-page');
  mountHost.append(root);
  const session = newSession();

  let loading = false;
  let loadError = '';
  let lastPromptRead = 0;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stateNode: HTMLElement | null = null;
  let foot: PageFoot | null = null;
  let head: PersonaHead | null = null;
  // The tab survives a repaint (a Save, a decision): it is the page's, not the DOM's.
  let tab: PersonaTab = 'instructions';

  const vaultId = (): string | null => deps.snapshot()?.vaultId ?? null;
  const readPrompt = (): Promise<PromptRead> => {
    lastPromptRead = Date.now();
    return readPromptFile(api, vaultId(), paths.prompt, t('persona.page.no_vault'));
  };
  const invoke = (method: string, payload?: unknown): Promise<unknown> => deps.invoke(method, payload);
  const improvementsOf = async (): Promise<PersonaImprovementsReply> => (await invoke('personaImprovements', { persona: id })) as PersonaImprovementsReply;

  const syncState = (): void => {
    const loaded = session.loaded;
    const dirty = loaded !== null && isDirty(loaded.base, loaded.draft);
    if (loaded !== null) {
      wordCounts.set(id, wordsOf(loaded.draft.prompt));
    }
    if (stateNode !== null) {
      const failed = loaded !== null && !loaded.promptRead.ok;
      stateNode.textContent = session.message !== '' ? session.message : failed ? t('persona.page.prompt_unreadable') : dirty ? t('persona.page.changed') : savedTextOf(api.i18n, session.committedAt);
      stateNode.classList.toggle('persona-state-error', session.messageIsError || failed);
    }
    syncApply(root, loaded !== null && loaded.draft.prompt !== loaded.base.prompt, t('persona.proposals.apply_blocked'));
    foot?.sync({ canSave: loaded?.promptRead.ok === true, busy: session.busy });
  };

  const fail = (text: string): void => {
    session.message = text;
    session.messageIsError = true;
    syncState();
  };

  /** The head's state, cost and Pause follow the engine's events without a repaint of the page. */
  const syncFacts = (): void => {
    const card = teamModelOf(store.personas(), deps.runs(), deps.chain(), deps.titleOf, Date.now()).personas.find((entry) => entry.id === id);
    head?.facts.sync(card);
  };
  const pause = (paused: boolean): void => {
    void deps.mutate(t(paused ? 'persona.head.pausing' : 'persona.head.resuming'), () => deps.invoke('personaPause', { persona: id, paused })).then(() => store.refresh());
  };
  const selectTab = (next: PersonaTab): void => {
    tab = next;
    render();
  };

  const render = (): void => {
    if (disposed) {
      return;
    }
    const scrolls = ['.persona-left', '.persona-right'].map((selector) => root.querySelector(selector)?.scrollTop ?? 0);
    stateNode = foot = head = null;
    const loaded = session.loaded;
    if (loaded === null) {
      const missing = store.loaded() && store.personas().every((entry) => entry.id !== id);
      root.replaceChildren(h('div', `persona-note${loadError !== '' ? ' persona-state-error' : ''}`, loadError !== '' ? loadError : missing ? t('persona.page.missing', { id }) : t('persona.page.loading')));
      return;
    }
    const { ctx, reads } = loaded;
    head = personaHead(ctx, () => host.back(), pause);
    stateNode = head.state;
    const { element: cols, left, right } = columnsOf({
      ctx,
      reads,
      instructions: loaded.instructions,
      skills: loaded.skills,
      proposal: loaded.proposal,
      promptDirty: loaded.draft.prompt !== loaded.base.prompt,
      tab,
      selectTab,
      decide: (proposal, decision) => void decideProposal(env, proposal, decision),
    });
    foot = pageFoot(t, t('persona.page.save_title', { path: paths.dirShort }), { discard, save: () => void savePersona(env), ...(ctx.persona.kind === 'mission' ? {} : { remove: () => askPersonaDelete(env, () => host.removed()) }) });
    root.replaceChildren(head.element, cols, foot.element);
    [left, right].forEach((column, at) => (column.scrollTop = scrolls[at] ?? 0));
    syncFacts();
    syncState();
  };

  const env: ActionEnv = { deps, t, id, store, session, readPrompt, improvementsOf, retitle: (title) => host.retitle(title), render, sync: syncState, fail, keyOf: (persona) => viewKeyOf(persona, deps) };

  const edit = (next: Partial<PersonaDraft>): void => {
    const loaded = session.loaded;
    if (loaded === null) {
      return;
    }
    loaded.draft = { ...loaded.draft, ...next };
    session.message = '';
    session.messageIsError = false;
    if (isDirty(loaded.base, loaded.draft)) {
      drafts.set(id, loaded.draft);
    } else {
      drafts.delete(id);
    }
    if (next.pinnedModel !== undefined) {
      void loaded.ctx.preview.ensure();
    }
    syncState();
  };

  const discard = (): void => {
    const loaded = session.loaded;
    if (loaded === null) {
      return;
    }
    loaded.draft = loaded.base;
    drafts.delete(id);
    session.message = '';
    session.messageIsError = false;
    loaded.instructions.setText(loaded.base.prompt);
    render();
  };

  const failLoad = (text: string): void => {
    if (disposed) {
      return;
    }
    loadError = text;
    render();
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      onChange();
    }, LOAD_RETRY_MS);
  };

  const load = async (persona: PersonaView): Promise<void> => {
    loading = true;
    try {
      const [prompt, improvements] = await Promise.all([readPrompt(), improvementsOf()]);
      if (disposed) {
        return;
      }
      if (!improvements.ok) {
        failLoad(improvements.error);
        return;
      }
      const base = draftOf(persona, prompt.ok ? prompt.text : '');
      const draft = drafts.get(id) ?? base;
      const skills = new PersonaSkillsState(seams.skills ?? engineSkillsSeam(invoke), id);
      const preview = new PersonaPreviewState(seams.preview ?? enginePromptPreviewSeam(invoke), id, () => previewRequestOf(session.loaded?.view.phases ?? persona.phases, (session.loaded?.draft ?? draft).pinnedModel));
      const [reads] = await Promise.all([readBeside(deps, id, persona.kind === 'mission'), skills.load(), preview.ensure()]);
      if (disposed) {
        return;
      }
      // A switch, a removal or an upload changes what a run loads: the brief is counted again.
      skills.subscribe(() => {
        if (!disposed && !skills.busy && skills.failure === null) {
          void preview.ensure(true);
        }
      });
      const ctx = blockContextOf({ deps, t, view: persona, reads, base, paths, skills, preview, session, edit, repaint: render, refreshPersonas: () => store.refresh() });
      session.loaded?.instructions.dispose();
      session.loaded?.skills.dispose();
      const instructions = createInstructionsBlock(ctx, draft.prompt, prompt.ok);
      session.loaded = { view: persona, base, draft, reads, promptRead: prompt, proposal: openProposalOf(improvements), instructions, skills: createSkillsBlock(ctx), ctx };
      session.viewKey = viewKeyOf(persona, deps);
      session.committedAt = persona.committedAt ?? null;
      loadError = '';
      host.retitle(persona.title);
      render();
    } catch (error) {
      failLoad(error instanceof Error ? error.message : String(error));
    } finally {
      loading = false;
    }
  };

  const onChange = (): void => {
    const persona = store.personas().find((entry) => entry.id === id);
    if (persona === undefined) {
      render();
      return;
    }
    const loaded = session.loaded;
    if (loaded !== null) {
      syncFacts();
    }
    if (loaded === null) {
      // The tab may be restored before the snapshot or the directory arrive; a failed load tries again on the next change.
      if (!loading && vaultId() !== null) {
        void load(persona);
      }
      return;
    }
    if ((persona.committedAt ?? null) !== session.committedAt) {
      session.committedAt = persona.committedAt ?? null;
      syncState();
    }
    const clean = !isDirty(loaded.base, loaded.draft);
    if (viewKeyOf(persona, deps) !== session.viewKey && !session.busy) {
      session.viewKey = viewKeyOf(persona, deps);
      loaded.view = persona;
      if (clean) {
        void load(persona);
        return;
      }
    }
    if (clean && !session.busy && Date.now() - lastPromptRead >= PROMPT_REREAD_MS) {
      void readPrompt().then((fresh) => {
        const current = session.loaded;
        if (disposed || current === null || !fresh.ok || fresh.text === current.base.prompt || isDirty(current.base, current.draft)) {
          return;
        }
        current.base = { ...current.base, prompt: fresh.text };
        current.draft = current.base;
        current.instructions.setText(fresh.text);
        render();
      });
    }
  };

  const offStore = store.subscribe(onChange);
  const offDeps = deps.subscribe(onChange);
  render();
  onChange();
  return () => {
    disposed = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }
    offStore();
    offDeps();
    session.loaded?.instructions.dispose();
    session.loaded?.skills.dispose();
    root.remove();
  };
}
