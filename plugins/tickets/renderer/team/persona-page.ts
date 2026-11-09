// i18n: catalog
/**
 * The Persona page (board 7k, milestone 201; rebuilt to the R11 mockup in
 * milestone 231, req-171): a tab of its own, opened by `Edit persona` on the
 * Crew tab. Head, two columns — Profile, Work, Allowed to | Instructions
 * (Drey's Markdown editor), Skills, Proposals — and one Save: what the form
 * changed goes as one `personaPatch`, one commit to `personas/<id>/`. Plain
 * DOM; each block is a file of its own over `persona-model.ts`, the page
 * composes them and owns the load and the repaint, `persona-page-actions.ts`
 * the Save and the decisions.
 */
import type { PersonaImprovementsReply, PersonaView } from '../../shared/remote-protocol';
import { h, type DeskDeps } from '../desk-deps';
import { allowedBlock } from './persona-allowed-block';
import type { BlockContext } from './persona-block-context';
import { outlineButton } from './persona-dom';
import { personaHead } from './persona-head';
import { createInstructionsBlock } from './persona-instructions-block';
import { draftOf, isDirty, personaPathsOf, wordsOf, type PersonaDraft } from './persona-model';
import { decideProposal, openProposalOf, savePersona, type ActionEnv } from './persona-page-actions';
import { readBeside, readPromptFile, type PersonaReads, type PromptRead } from './persona-page-load';
import { drafts, newSession, wordCounts } from './persona-page-state';
import { profileBlock } from './persona-profile-block';
import { proposalsBlock, syncApply } from './persona-proposals-block';
import { noPromptPreview, vaultSkillsSeam, type PersonaSkillsSeam, type PromptPreviewSeam } from './persona-seams';
import { skillsBlock } from './persona-skills-block';
import { workBlock } from './persona-work-block';
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
  /** Opens the Crew tab on this persona's Memory or 1:1 tab. */
  openCrew(persona: string, tab: 'Memory' | '1:1'): void;
}

/** The two seams that wait for req-172; a spec swaps them. */
export interface PersonaPageSeams {
  readonly skills?: PersonaSkillsSeam;
  readonly preview?: PromptPreviewSeam;
}

/** What a repaint of a loaded page depends on; the day's cost and the pause do not count. */
const keyOf = (persona: PersonaView, deps: DeskDeps): string =>
  JSON.stringify([persona.title, persona.role, persona.worker, persona.pool, persona.color, persona.budget, persona.phases, persona.summary, persona.allowed, deps.snapshot()?.pipeline.map((phase) => phase.id)]);

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
  let saveButton: HTMLButtonElement | null = null;
  let discardButton: HTMLButtonElement | null = null;

  const vaultId = (): string | null => deps.snapshot()?.vaultId ?? null;
  const readPrompt = (): Promise<PromptRead> => {
    lastPromptRead = Date.now();
    return readPromptFile(api, vaultId(), paths.prompt, t('persona.page.no_vault'));
  };
  const improvementsOf = async (): Promise<PersonaImprovementsReply> => (await deps.invoke('personaImprovements', { persona: id })) as PersonaImprovementsReply;

  const syncState = (): void => {
    const loaded = session.loaded;
    const dirty = loaded !== null && isDirty(loaded.base, loaded.draft);
    if (loaded !== null) {
      wordCounts.set(id, wordsOf(loaded.draft.prompt));
    }
    if (stateNode !== null) {
      const failed = loaded !== null && !loaded.promptRead.ok;
      stateNode.textContent = session.message !== '' ? session.message : failed ? t('persona.page.prompt_unreadable') : dirty ? t('persona.page.changed') : t('persona.page.saved');
      stateNode.classList.toggle('persona-state-error', session.messageIsError || failed);
    }
    syncApply(root, loaded !== null && loaded.draft.prompt !== loaded.base.prompt, t('persona.proposals.apply_blocked'));
    if (saveButton !== null) {
      saveButton.disabled = loaded?.promptRead.ok !== true || session.busy;
    }
    if (discardButton !== null) {
      discardButton.disabled = session.busy;
    }
  };

  const fail = (text: string): void => {
    session.message = text;
    session.messageIsError = true;
    syncState();
  };

  const render = (): void => {
    if (disposed) {
      return;
    }
    const scrolls = ['.persona-left', '.persona-right'].map((selector) => root.querySelector(selector)?.scrollTop ?? 0);
    stateNode = saveButton = discardButton = null;
    const loaded = session.loaded;
    if (loaded === null) {
      const missing = store.loaded() && store.personas().every((entry) => entry.id !== id);
      root.replaceChildren(h('div', `persona-note${loadError !== '' ? ' persona-state-error' : ''}`, loadError !== '' ? loadError : missing ? t('persona.page.missing', { id }) : t('persona.page.loading')));
      return;
    }
    const { ctx, reads } = loaded;
    const head = personaHead(ctx, { memory: reads.memory, journal: reads.journal, proposals: loaded.proposal === null ? 0 : 1 }, () => host.back());
    stateNode = head.state;
    const left = h('div', 'persona-left');
    left.append(profileBlock(ctx), workBlock(ctx), allowedBlock(ctx));
    const right = h('div', 'persona-right');
    right.append(
      loaded.instructions.element,
      skillsBlock(ctx),
      proposalsBlock(ctx, {
        proposal: loaded.proposal,
        memory: reads.memory,
        journal: reads.journal,
        promptDirty: loaded.draft.prompt !== loaded.base.prompt,
        decide: (proposal, decision) => void decideProposal(env, proposal, decision),
        openCrew: (tab) => host.openCrew(id, tab),
      }),
    );
    const cols = h('div', 'persona-cols');
    cols.append(left, right);
    discardButton = outlineButton(t('persona.page.discard'), 'persona-btn persona-btn-32', () => discard());
    saveButton = outlineButton(t('persona.page.save'), 'persona-save', () => void savePersona(env));
    saveButton.title = t('persona.page.save_title', { path: paths.dirShort });
    const foot = h('footer', 'persona-foot');
    foot.append(h('span', 'persona-grow'), discardButton, saveButton);
    root.replaceChildren(head.element, cols, foot);
    [left, right].forEach((column, at) => (column.scrollTop = scrolls[at] ?? 0));
    syncState();
  };

  const env: ActionEnv = { deps, t, id, store, session, readPrompt, improvementsOf, retitle: (title) => host.retitle(title), render, sync: syncState, fail, keyOf: (persona) => keyOf(persona, deps) };

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

  const blockContext = (loaded: { view: PersonaView; reads: PersonaReads; base: PersonaDraft }, seam: PersonaSkillsSeam, preview: PromptPreviewSeam): BlockContext => ({
    deps,
    api,
    t,
    persona: loaded.view,
    extras: loaded.reads.extras,
    paths,
    skillsSeam: seam,
    previewSeam: preview,
    loadedSkills: loaded.base.skills,
    draft: () => session.loaded?.draft ?? loaded.base,
    edit,
    change: (next) => {
      edit(next);
      render();
    },
  });

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
      const seam = seams.skills ?? vaultSkillsSeam(api, vaultId());
      const base = draftOf(persona, prompt.ok ? prompt.text : '', improvements.persona.skills);
      const reads = await readBeside(deps, id, seam, base.skills);
      if (disposed) {
        return;
      }
      const draft = drafts.get(id) ?? base;
      const ctx = blockContext({ view: persona, reads, base }, seam, seams.preview ?? noPromptPreview);
      session.loaded?.instructions.dispose();
      const instructions = createInstructionsBlock(ctx, draft.prompt, prompt.ok);
      session.loaded = { view: persona, base, draft, reads, promptRead: prompt, proposal: openProposalOf(improvements), instructions, ctx };
      session.viewKey = keyOf(persona, deps);
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
    if (loaded === null) {
      // The tab may be restored before the snapshot or the directory arrive; a failed load tries again on the next change.
      if (!loading && vaultId() !== null) {
        void load(persona);
      }
      return;
    }
    const clean = !isDirty(loaded.base, loaded.draft);
    if (keyOf(persona, deps) !== session.viewKey && !session.busy) {
      session.viewKey = keyOf(persona, deps);
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
    root.remove();
  };
}
