// i18n: catalog
/**
 * `Preview full prompt` (R11, req-238): the brief a run of this persona would
 * start with, read-only in the host's Markdown view (the rendered view, so
 * the composer's `## Skills` and `## Memory` sections read as sections), under
 * a row that marks the parts — instructions, skills, memory, the rest — each
 * with its estimated tokens, and the skills one by one as the run loads them.
 * Ticket-bound parts carry the engine's placeholders (`T-0000`, `<ticket
 * title>`): the figure is the run's start, not a run.
 */
import type { MarkdownViewHandle } from '../../../../shared/plugin-api/renderer';
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { partLinesOf } from './persona-preview-model';
import type { PromptPreview } from './persona-seams';
import { skillTitleOf } from './persona-skills-model';

export interface PreviewPanel {
  readonly element: HTMLElement;
  dispose(): void;
}

export function createPreviewPanel(ctx: BlockContext, preview: PromptPreview): PreviewPanel {
  const { t, api } = ctx;
  const element = h('div', 'persona-ed persona-ed-preview');
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', t('persona.preview.title'));
  const parts = h('div', 'persona-preview-parts');
  parts.append(h('small', 'persona-muted persona-tokens', t('persona.page.tokens_at_start', { count: preview.tokens })));
  for (const part of partLinesOf(preview)) {
    const chip = h('span', 'persona-part', t('persona.preview.part', { name: part.key === null ? part.name : t(part.key), count: part.tokens }));
    chip.dataset['part'] = part.name;
    parts.append(chip);
  }
  element.append(parts);
  if (preview.skills.length > 0) {
    const skills = h('div', 'persona-preview-parts persona-preview-skills');
    for (const skill of preview.skills) {
      const chip = h('span', 'persona-part persona-part-skill', t('persona.preview.part', { name: skillTitleOf(skill.name), count: skill.tokens }));
      chip.dataset['skill'] = skill.name;
      skills.append(chip);
    }
    element.append(skills);
  }
  let view: MarkdownViewHandle | null = api.ui.createMarkdownView({ content: preview.text, mode: 'view', readOnly: true });
  view.element.classList.add('persona-ed-view');
  view.element.setAttribute('aria-label', t('persona.preview.title'));
  element.append(view.element);
  return {
    element,
    dispose: () => {
      view?.dispose();
      view = null;
      element.remove();
    },
  };
}
