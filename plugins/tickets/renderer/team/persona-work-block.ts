// i18n: catalog
/**
 * The Work block (R11; board 7k v3, req-288): the run settings — the
 * persona's pool (max and min), read-only, the leaving actions — and the
 * daily budget. The harness, the model pool and the class floor left it with
 * Persona v3: the Model block's class and pin decide the model, the harness
 * follows from it. "Tell me when" is not drawn: nothing records or reads it
 * yet (req-236).
 */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { blockHead, labelled, textInput } from './persona-dom';
import { workSettingsNodes } from './persona-work-settings';

export function workBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const draft = ctx.draft();
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.page.work'));
  const budget = textInput(draft.budget === '' ? '' : `$${draft.budget}`, (value) => ctx.edit({ budget: value }), 'budget');
  budget.inputMode = 'decimal';
  block.append(blockHead(t('persona.page.work')), ...workSettingsNodes(ctx), labelled(t('persona.page.budget'), budget, 'persona-half'));
  return block;
}
