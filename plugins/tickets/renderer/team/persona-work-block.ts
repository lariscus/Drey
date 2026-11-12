// i18n: catalog
/**
 * The Work block (R11; board 7k v2, req-258): the harness, the persona's
 * models from the model table, the run settings (class floor, read-only, the
 * persona's pool, leaving actions), the daily budget. The step chips went with
 * req-258 (the persona board has no steps). "Tell me when" is not drawn:
 * nothing records or reads it yet (req-236).
 */
import { WORKER_PROVIDERS } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { h } from '../desk-deps';
import { RUNNER_LABEL } from '../settings-workers';
import type { BlockContext } from './persona-block-context';
import { blockHead, iconButton, labelled, outlineButton, selectOf, textInput } from './persona-dom';
import { addableModelsOf, modelLinesOf, movedPool, type ModelLine } from './persona-work-model';
import { workSettingsNodes } from './persona-work-settings';

function rowMenu(ctx: BlockContext, line: ModelLine, pool: readonly string[]): HTMLElement {
  const menu = h('div', 'persona-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const item = (label: string, disabled: boolean, run: () => void): void => {
    const button = outlineButton(label, 'persona-menu-item', run);
    button.setAttribute('role', 'menuitem');
    button.disabled = disabled;
    menu.append(button);
  };
  item(ctx.t('persona.page.move_up'), line.index === 1, () => ctx.change({ pool: movedPool(pool, line.index - 1, -1) }));
  item(ctx.t('persona.page.move_down'), line.index === pool.length, () => ctx.change({ pool: movedPool(pool, line.index - 1, 1) }));
  item(ctx.t('persona.page.remove_model'), pool.length === 1, () => ctx.change({ pool: pool.filter((_, at) => at !== line.index - 1) }));
  const wrap = h('span', 'persona-menu-wrap');
  const opener = iconButton(ctx.api, 'more-horizontal', ctx.t('persona.page.row_options', { model: line.model }), () => {
    menu.hidden = !menu.hidden;
  });
  opener.setAttribute('aria-haspopup', 'menu');
  wrap.append(opener, menu);
  return wrap;
}

function modelRow(ctx: BlockContext, line: ModelLine, pool: readonly string[]): HTMLElement {
  const row = h('div', 'persona-pool-row');
  row.setAttribute('role', 'listitem');
  row.dataset['model'] = line.entry;
  const body = h('span', 'persona-grow persona-pool-name', line.model);
  body.append(h('span', 'persona-muted persona-line', line.detail));
  row.append(h('span', 'persona-pool-n', String(line.index)), body);
  if (line.busy !== null) {
    row.append(h('span', 'persona-tag', line.busy));
  }
  row.append(rowMenu(ctx, line, pool));
  return row;
}

/** `Add a model…`: the table's models not yet in the pool; without a table the name is typed. */
function addModel(ctx: BlockContext, pool: readonly string[]): HTMLElement {
  const choices = addableModelsOf(pool, ctx.extras.table);
  const wrap = h('div', 'persona-add');
  const label = ctx.t('persona.page.add_model');
  const add = (entry: string): void => {
    if (entry.trim() !== '' && !pool.includes(entry.trim())) {
      ctx.change({ pool: [...pool, entry.trim()] });
    }
  };
  const open = outlineButton(label, 'persona-link', () => {
    wrap.replaceChildren();
    if (choices.length > 0) {
      const select = selectOf([{ value: '', label }, ...choices.map((entry) => ({ value: entry, label: entry }))], '', (value) => add(value));
      select.setAttribute('aria-label', label);
      wrap.append(select);
      select.focus();
    } else {
      const input = textInput('', () => undefined);
      input.setAttribute('aria-label', label);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          add(input.value);
        } else if (event.key === 'Escape') {
          ctx.change({});
        }
      });
      wrap.append(input);
      input.focus();
    }
  });
  wrap.append(open);
  return wrap;
}

export function workBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const draft = ctx.draft();
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.page.work'));
  const known = (WORKER_PROVIDERS as readonly string[]).includes(draft.worker);
  const harness = selectOf(
    [...WORKER_PROVIDERS.map((provider) => ({ value: provider as string, label: RUNNER_LABEL[provider] })), ...(known || draft.worker === '' ? [] : [{ value: draft.worker, label: draft.worker }])],
    draft.worker,
    (value) => ctx.edit({ worker: value }),
  );
  harness.dataset['field'] = 'worker';
  const pool = h('div', 'persona-pool');
  pool.setAttribute('role', 'list');
  for (const line of modelLinesOf(draft.pool, draft.worker, ctx.extras.table, ctx.extras.slots, ctx.deps.runs(), ctx.api.i18n)) {
    pool.append(modelRow(ctx, line, draft.pool));
  }
  pool.append(addModel(ctx, draft.pool));
  const budget = textInput(draft.budget === '' ? '' : `$${draft.budget}`, (value) => ctx.edit({ budget: value }), 'budget');
  budget.inputMode = 'decimal';
  block.append(
    blockHead(t('persona.page.work')),
    labelled(t('persona.page.harness'), harness),
    labelled(t('persona.page.models'), pool),
    ...workSettingsNodes(ctx),
    labelled(t('persona.page.budget'), budget, 'persona-half'),
  );
  return block;
}
