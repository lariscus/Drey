// i18n: catalog
/**
 * The Model block of an agent (req-288, board 7k v3 `DeskPersonaV3`): the
 * class as a segmented choice of the owner's classes, the model — *Next free
 * in class* or one model of the class pinned, each with its harness — and the
 * line `2 heavy models · 1 free now`. No harness choice: the harness follows
 * from the model. A class change drops a pin that is not a model of the new
 * class. The draft's `modelClass` and `pinnedModel` go with the page's Save.
 */
import { h } from '../board/desk-deps';
import type { BlockContext } from './persona-block-context';
import { classChoicesOf, classCountsOf, classModelsOf, pinFitsClass, pinnedModelOf } from './persona-class-model';
import { listboxOf, pickerField, segmented, type ListOption } from './persona-controls';
import { blockHead } from './persona-dom';

/** Whether a persona's model listbox is open survives the block's repaint. */
const pickerStates = new Map<string, { open: boolean; field: string }>();

/** A model as the board writes it: the id in mono, then `· Harness`. */
function modelText(model: string, harness: string): readonly Node[] {
  const id = h('span', 'persona-mono persona-op-model', model);
  return harness === '' ? [id] : [id, h('span', 'persona-muted', ` · ${harness}`)];
}

export function classModelBlock(ctx: BlockContext): HTMLElement {
  const { t, api } = ctx;
  const draft = ctx.draft();
  const table = ctx.extras.table;
  const classes = classChoicesOf(table, draft.modelClass);
  // A record not migrated yet names no class: no segment is chosen, the models and counts read the strongest class until one is.
  const current = draft.modelClass === '' ? (classes[0] ?? '') : draft.modelClass;
  const chosen = draft.modelClass;
  const pickerState = pickerStates.get(ctx.persona.id) ?? { open: false, field: 'pinned-model' };
  pickerStates.set(ctx.persona.id, pickerState);
  const block = h('section', 'persona-block persona-model-block');
  block.setAttribute('aria-label', t('persona.model.title'));

  const pickClass = (cls: string): void => {
    const pinned = ctx.draft().pinnedModel;
    pickerState.open = false;
    ctx.change({ modelClass: cls, pinnedModel: pinned !== '' && !pinFitsClass(pinned, table, cls) ? '' : pinned });
  };
  const pickModel = (entry: string): void => {
    pickerState.open = false;
    ctx.change({ pinnedModel: entry });
  };

  const models = classModelsOf(table, current);
  const pinned = draft.pinnedModel;
  const options: ListOption[] = [
    { value: '', content: [t('persona.model.next_free')], selected: pinned === '' },
    ...models.map((model, at) => ({ value: model.entry, content: modelText(model.model, model.harness), selected: pinFitsSame(pinned, model.entry), indent: true, separator: at === 0 })),
  ];
  const stray = pinned !== '' && !options.some((option) => option.selected) ? pinnedModelOf(pinned, table) : null;
  if (stray !== null) {
    options.push({ value: stray.entry, content: modelText(stray.model, stray.harness), selected: true, indent: true, separator: models.length === 0 });
  }
  const shown = pinned === '' ? [t('persona.model.next_free')] : (() => {
    const chosen = pinnedModelOf(pinned, table);
    return modelText(chosen.model, chosen.harness);
  })();
  const picker = pickerField(api, t('persona.model.model'), shown, () => listboxOf(api, t('persona.model.model'), options, pickModel), pickerState);
  const counts = classCountsOf(table, current, ctx.extras.slots);
  const field = h('div', 'persona-field');
  field.append(h('span', 'persona-muted', t('persona.model.model')), picker);
  block.append(
    blockHead(t('persona.model.title')),
    segmented(t('persona.model.class'), classes, chosen, pickClass),
    field,
    h('span', 'persona-muted persona-model-counts', t('persona.model.counts', { models: counts.models, free: counts.free, class: current })),
  );
  return block;
}

/** The pinned entry and an option's entry name the same model (a bare model id matches its row on any harness). */
function pinFitsSame(pinned: string, entry: string): boolean {
  if (pinned === entry) {
    return true;
  }
  return !pinned.includes('/') && entry.endsWith(`/${pinned}`);
}
