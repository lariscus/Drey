// i18n: catalog
/**
 * Settings → Tickets → Skills library (board 7o, req-289): every skill of
 * the board in one place — the shared pool, the skills fetched from GitHub
 * sources, the personas' own — with who uses each, and the sources with
 * Fetch, Update and remove. The parts live beside this file (`-head`,
 * `-sources`, `-skills`), the state and its calls in
 * `skills-library-state.ts`, the pure half in `skills-library-model.ts`.
 * GitHub is asked only on the owner's action: Fetch, Update, and the first
 * look when the page opens, which asks whether the sources have newer refs.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { el } from '../settings-dom';
import { createHeadPart } from './skills-library-head';
import { createSkillsPart } from './skills-library-skills';
import { createSourcesPart } from './skills-library-sources';
import { SkillsLibraryState } from './skills-library-state';

export interface SkillsLibrarySection {
  readonly root: HTMLElement;
  refresh(): Promise<void>;
  dispose(): void;
}

export function createSkillsLibrarySection(api: DreyPluginApi): SkillsLibrarySection {
  let disposed = false;
  const state = new SkillsLibraryState(api, () => paint());
  const head = createHeadPart(state);
  const sources = createSourcesPart(state);
  const skills = createSkillsPart(state);
  // not `.mdl`: the Models section is the page's one `.mdl`; this one borrows its `.mdl-*` parts
  const root = el('section', 'tset-section');
  root.classList.add('skl');
  root.setAttribute('aria-labelledby', 'tset-skills-head');
  root.append(head.element, sources.element, skills.element);

  /** True while a field of the page has the caret: a background read must not rebuild it under the typist. */
  const typing = (): boolean => {
    const active = document.activeElement;
    return active instanceof HTMLInputElement && root.contains(active) && active.type !== 'file';
  };

  function paint(): void {
    if (disposed) {
      return;
    }
    head.paint();
    sources.paint();
    skills.paint();
  }

  paint();
  return {
    root,
    refresh: async () => {
      if (state.busy || (typing() && state.library !== null)) {
        return;
      }
      await state.load();
    },
    dispose: () => {
      disposed = true;
    },
  };
}
