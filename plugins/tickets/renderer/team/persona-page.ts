// i18n: catalog
/**
 * The Persona page (board 7k, milestone 201; rebuilt to the R11 mockup in
 * milestone 231, req-171): a tab of its own, opened by `Edit persona` on the
 * Crew tab. Head, two columns — Profile, Work, Allowed to | Instructions
 * (Drey's Markdown editor), Skills, Proposals — and one Save: what the form
 * changed goes as one `personaPatch`, one commit to `personas/<id>/`. Plain
 * DOM; each block is a file of its own over `persona-model.ts`, the page
 * owns the state, the load and the Save.
 */
import type { ImprovementProposal } from '../../../../packages/tickets-engine/src/core/improvements';
import type { PersonaImprovementsReply, PersonaView } from '../../shared/remote-protocol';
import { h, type DeskDeps } from '../desk-deps';
import { allowedBlock } from './persona-allowed-block';
import type { BlockContext } from './persona-block-context';
import { outlineButton } from './persona-dom';
import { personaHead } from './persona-head';
import { createInstructionsBlock, type InstructionsBlock } from './persona-instructions-block';
import { draftOf, isDirty, patchOf, personaPathsOf, savedBaseOf, wordsOf, type PersonaDraft } from './persona-model';
import { readBeside, readPromptFile, type PersonaReads, type PromptRead } from './persona-page-load';
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

/** The unsaved edits per persona: switching tabs remounts the page, a typed draft must survive that. */
const drafts = new Map<string, PersonaDraft>();

/** The words of the instructions per open persona page, for the status bar; null while not loaded. */
const wordCounts = new Map<string, number>();

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

/** Everything the page holds once the persona is loaded. */
interface Loaded {
  view: PersonaView;
  base: PersonaDraft;
  draft: PersonaDraft;
  reads: PersonaReads;
  promptRead: PromptRead;
  proposal: ImprovementProposal | null;
  instructions: InstructionsBlock;
  ctx: BlockContext;
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

  let state: Loaded | null = null;
  let viewKey = '';
  let loading = false;
  let busy = false;
  let loadError = '';
  let message = '';
  let messageIsError = false;
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
  const openProposal = (reply: PersonaImprovementsReply): ImprovementProposal | null => (reply.ok ? (reply.proposals.find((entry) => entry.state === 'open') ?? null) : null);

  const syncState = (): void => {
    const dirty = state !== null && isDirty(state.base, state.draft);
    if (state !== null) {
      wordCounts.set(id, wordsOf(state.draft.prompt));
    }
    if (stateNode !== null) {
      const failed = state !== null && !state.promptRead.ok;
      stateNode.textContent = message !== '' ? message : failed ? t('persona.page.prompt_unreadable') : dirty ? t('persona.page.changed') : t('persona.page.saved');
      stateNode.classList.toggle('persona-state-error', messageIsError || failed);
    }
    syncApply(root, state !== null && state.draft.prompt !== state.base.prompt, t('persona.proposals.apply_blocked'));
    if (saveButton !== null) {
      saveButton.disabled = state?.promptRead.ok !== true || busy;
    }
    if (discardButton !== null) {
      discardButton.disabled = busy;
    }
  };

  const fail = (text: string): void => {
    message = text;
    messageIsError = true;
    syncState();
  };

  const render = (): void => {
    if (disposed) {
      return;
    }
    const scrolls = ['.persona-left', '.persona-right'].map((selector) => root.querySelector(selector)?.scrollTop ?? 0);
    stateNode = saveButton = discardButton = null;
    if (state === null) {
      const missing = store.loaded() && store.personas().every((entry) => entry.id !== id);
      root.replaceChildren(h('div', `persona-note${loadError !== '' ? ' persona-state-error' : ''}`, loadError !== '' ? loadError : missing ? t('persona.page.missing', { id }) : t('persona.page.loading')));
      return;
    }
    const { ctx, reads } = state;
    const head = personaHead(ctx, { memory: reads.memory, journal: reads.journal, proposals: state.proposal === null ? 0 : 1 }, () => host.back());
    stateNode = head.state;
    const left = h('div', 'persona-left');
    left.append(profileBlock(ctx), workBlock(ctx), allowedBlock(ctx));
    const right = h('div', 'persona-right');
    right.append(
      state.instructions.element,
      skillsBlock(ctx),
      proposalsBlock(ctx, {
        proposal: state.proposal,
        memory: reads.memory,
        journal: reads.journal,
        promptDirty: state.draft.prompt !== state.base.prompt,
        decide: (proposal, decision) => void decide(proposal, decision),
        openCrew: (tab) => host.openCrew(id, tab),
      }),
    );
    const cols = h('div', 'persona-cols');
    cols.append(left, right);
    discardButton = outlineButton(t('persona.page.discard'), 'persona-btn persona-btn-32', () => discard());
    saveButton = outlineButton(t('persona.page.save'), 'persona-save', () => void save());
    saveButton.title = t('persona.page.save_title', { path: paths.dirShort });
    const foot = h('footer', 'persona-foot');
    foot.append(h('span', 'persona-grow'), discardButton, saveButton);
    root.replaceChildren(head.element, cols, foot);
    [left, right].forEach((column, at) => (column.scrollTop = scrolls[at] ?? 0));
    syncState();
  };

  const edit = (next: Partial<PersonaDraft>): void => {
    if (state === null) {
      return;
    }
    state.draft = { ...state.draft, ...next };
    message = '';
    messageIsError = false;
    if (isDirty(state.base, state.draft)) {
      drafts.set(id, state.draft);
    } else {
      drafts.delete(id);
    }
    syncState();
  };

  const discard = (): void => {
    if (state === null) {
      return;
    }
    state.draft = state.base;
    drafts.delete(id);
    message = '';
    messageIsError = false;
    state.instructions.setText(state.base.prompt);
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
    draft: () => state?.draft ?? loaded.base,
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
      state?.instructions.dispose();
      const instructions = createInstructionsBlock(ctx, draft.prompt, prompt.ok);
      state = { view: persona, base, draft, reads, promptRead: prompt, proposal: openProposal(improvements), instructions, ctx };
      viewKey = keyOf(persona, deps);
      loadError = '';
      host.retitle(persona.title);
      render();
    } catch (error) {
      failLoad(error instanceof Error ? error.message : String(error));
    } finally {
      loading = false;
    }
  };

  const save = async (): Promise<void> => {
    if (state === null || busy || !state.promptRead.ok) {
      return;
    }
    const { base, draft } = state;
    const patch = patchOf(base, draft);
    if (Object.keys(patch).length === 0) {
      return;
    }
    busy = true;
    syncState();
    try {
      if (patch.prompt !== undefined) {
        // The file may have moved on since the page read it (Mission Control writes it too).
        const fresh = await readPrompt();
        if (!fresh.ok || fresh.text !== base.prompt) {
          fail(t('persona.page.prompt_moved'));
          return;
        }
      }
      const reply = (await deps.invoke('personaPatch', { persona: id, ...patch })) as { ok: boolean; error?: string; warning?: string };
      if (!reply.ok) {
        fail(reply.error ?? t('persona.page.save_failed'));
        return;
      }
      drafts.delete(id);
      state.base = savedBaseOf(draft);
      state.draft = state.base;
      state.promptRead = { ok: true, text: state.base.prompt };
      message = reply.warning ?? '';
      messageIsError = false;
      host.retitle(state.base.title);
      await store.refresh();
      const saved = store.personas().find((entry) => entry.id === id);
      if (saved !== undefined) {
        state.view = saved;
        viewKey = keyOf(saved, deps);
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
      render();
    }
  };

  /** Dismiss or Apply over the improvements routes; an applied prompt proposal rewrote `prompt.md`, so the page reads it again. */
  const decide = async (proposal: ImprovementProposal, decision: 'accepted' | 'dismissed'): Promise<void> => {
    try {
      const reply = (await deps.invoke('personaImprovementDecide', { persona: id, proposal: proposal.id, decision })) as { ok: boolean; error?: string };
      if (!reply.ok) {
        fail(reply.error ?? t('persona.page.save_failed'));
        return;
      }
      const improvements = await improvementsOf();
      if (state === null) {
        return;
      }
      state.proposal = openProposal(improvements);
      if (decision === 'accepted' && proposal.target === 'prompt.md') {
        const fresh = await readPrompt();
        if (fresh.ok) {
          state.base = { ...state.base, prompt: fresh.text };
          state.draft = { ...state.draft, prompt: fresh.text };
          state.instructions.setText(fresh.text);
        }
      }
      render();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };

  const onChange = (): void => {
    const persona = store.personas().find((entry) => entry.id === id);
    if (persona === undefined) {
      render();
      return;
    }
    if (state === null) {
      // The tab may be restored before the snapshot or the directory arrive; a failed load tries again on the next change.
      if (!loading && vaultId() !== null) {
        void load(persona);
      }
      return;
    }
    const clean = !isDirty(state.base, state.draft);
    if (keyOf(persona, deps) !== viewKey && !busy) {
      viewKey = keyOf(persona, deps);
      state.view = persona;
      if (clean) {
        void load(persona);
        return;
      }
    }
    if (clean && !busy && Date.now() - lastPromptRead >= PROMPT_REREAD_MS) {
      void readPrompt().then((fresh) => {
        const current = state;
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
    state?.instructions.dispose();
    root.remove();
  };
}
