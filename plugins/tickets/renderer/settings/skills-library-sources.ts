// i18n: catalog
/**
 * Settings → Skills library, Sources (board 7o): one row per GitHub source —
 * its repository, the ref chip, how many skills it brought, when it was
 * fetched, *Update to <ref>* when the last look found a newer one, and
 * remove, which asks in the row first.
 */
import type { SkillSourceView } from '../../../../packages/tickets-engine/src/contracts/skill-library';
import { el } from './dom.ts/settings-dom';
import { groupHead, textButton } from './models-dom';
import { confirmRow, skillGlyph, skillIconButton } from './skills-library-dom';
import { fetchedText, sourceLabel, sourceWords } from './skills-library-model';
import type { SkillsLibraryState } from './skills-library-state';

export interface SourcesPart {
  readonly element: HTMLElement;
  paint(): void;
}

export function createSourcesPart(state: SkillsLibraryState): SourcesPart {
  const { t, api } = state;
  const list = el('div', 'skl-list');
  const element = el('div', 'skl-sources');
  element.append(groupHead(t('tickets.settings.skills.sources')), list);

  function sourceRow(source: SkillSourceView): HTMLElement {
    const label = sourceLabel(source);
    if (state.confirming === `source:${source.id}`) {
      return confirmRow({
        question: t('tickets.settings.skills.remove_source_ask', { source: label, count: source.skills.length }),
        keep: t('tickets.settings.skills.keep'),
        go: t('tickets.settings.skills.remove'),
        busy: state.busy,
        onKeep: () => {
          state.confirming = null;
          state.changed();
        },
        onGo: () => void state.removeSource(source.id),
      });
    }
    const words = sourceWords(api.i18n, source);
    const row = el('div', 'mdl-row skl-source');
    row.dataset['source'] = source.id;
    const icon = el('span', 'skl-source-icon');
    icon.append(skillGlyph('branch', 14));
    const name = el('span', 'skl-mono skl-source-name', label);
    name.title = label;
    const fetched = el('span', 'mdl-sec mdl-grow', fetchedText(api.i18n, source.fetched, new Date()));
    if (source.checkError !== null) {
      fetched.title = source.checkError;
    }
    row.append(icon, name, el('span', 'mdl-chip', words.ref), el('span', 'mdl-sec skl-source-count', words.count), fetched);
    if (source.updateAvailable !== null) {
      const to = source.updateAvailable;
      const update = textButton(t('tickets.settings.skills.update_to', { ref: to }));
      update.disabled = state.busy;
      update.addEventListener('click', () => void state.updateSource(source.id, to));
      row.append(update);
    }
    const remove = skillIconButton('trash', 16, t('tickets.settings.skills.remove_source'));
    remove.disabled = state.busy;
    remove.addEventListener('click', () => {
      state.confirming = `source:${source.id}`;
      state.changed();
    });
    row.append(remove);
    return row;
  }

  return {
    element,
    paint: () => {
      const sources = state.library?.sources ?? [];
      list.replaceChildren(...(sources.length === 0 ? [el('div', 'mdl-row mdl-sec skl-empty', t('tickets.settings.skills.no_sources'))] : sources.map(sourceRow)));
    },
  };
}
