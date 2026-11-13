// i18n: catalog
/**
 * Settings → Models, one model row of a class group (board 7l v3): drag
 * handle, id, the harness and account it runs on, what it can do, its context
 * window, its cost factor (edited in place), its class as a menu, and the
 * switch that lets the router use it. Every edit writes the whole table.
 */
import { el } from '../settings-dom';
import { modelsPayload, parseCostFactor, type ClassRowView } from './models-model';
import { glyph, onEnterEscape, textField } from './models-dom';
import type { ModelsState } from './models-state';

/** What a row needs of the page: the state, and the drag in progress (a row index; null = none). */
export interface RowContext {
  readonly state: ModelsState;
  readonly classNames: readonly string[];
  /** The row whose class menu is open; null = none. */
  menuFor(): number | null;
  openMenu(index: number | null): void;
  /** The row whose cost is being typed; null = none. */
  costFor(): number | null;
  editCost(index: number | null): void;
  dragging(index: number | null): void;
  moveRow(index: number, className: string): void;
}

function classMenu(ctx: RowContext, view: ClassRowView): HTMLElement {
  const { t } = ctx.state;
  const wrap = el('span', 'mdl-menuwrap');
  const open = ctx.menuFor() === view.index;
  const button = el('button', open ? 'mdl-classbtn mdl-open' : 'mdl-classbtn');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', t('tickets.settings.models.row.class_of', { model: view.row.model }));
  button.title = t('tickets.settings.models.row.move');
  button.append(el('span', undefined, view.row.class), glyph('down', 12));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    ctx.openMenu(open ? null : view.index);
  });
  wrap.append(button);
  if (open) {
    const menu = el('div', 'mdl-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('tickets.settings.models.row.move_menu'));
    for (const name of ctx.classNames) {
      const item = el('button', 'mdl-menuitem');
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(name === view.row.class));
      const mark = el('span', 'mdl-menumark');
      if (name === view.row.class) {
        mark.append(glyph('check', 12));
      }
      item.append(mark, name);
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        ctx.openMenu(null);
        ctx.moveRow(view.index, name);
      });
      menu.append(item);
    }
    wrap.append(menu);
  }
  return wrap;
}

function costCell(ctx: RowContext, view: ClassRowView): HTMLElement {
  const { state } = ctx;
  if (ctx.costFor() !== view.index) {
    const button = el('button', 'mdl-cost', view.cost);
    button.type = 'button';
    button.title = state.t('tickets.settings.models.row.cost_factor');
    button.addEventListener('click', () => ctx.editCost(view.index));
    return button;
  }
  const input = textField(String(view.row.cost), state.t('tickets.settings.models.row.cost_factor'), 'mdl-fld mdl-costfield');
  let done = false;
  const finish = (commit: boolean): void => {
    if (done) {
      return;
    }
    done = true;
    const parsed = commit ? parseCostFactor(input.value) : null;
    ctx.editCost(null);
    if (parsed?.ok === true && parsed.value !== view.row.cost && state.reply !== null) {
      void state.pool('poolModelsConfig', modelsPayload(state.reply.models, view.index, { cost: parsed.value }));
    }
  };
  onEnterEscape(input, () => finish(true), () => finish(false));
  input.addEventListener('blur', () => finish(true));
  queueMicrotask(() => input.focus());
  return input;
}

export function classRowOf(ctx: RowContext, view: ClassRowView): HTMLElement {
  const { state } = ctx;
  const row = el('div', 'mdl-modelrow');
  const grip = el('span', 'mdl-grip');
  grip.title = state.t('tickets.settings.models.row.drag');
  grip.draggable = true;
  grip.append(glyph('grip', 14));
  grip.addEventListener('dragstart', (event) => {
    ctx.dragging(view.index);
    const transfer = event.dataTransfer as DataTransfer | null | undefined;
    if (transfer !== null && transfer !== undefined) {
      transfer.effectAllowed = 'move';
      transfer.setData('text/plain', view.row.model);
      transfer.setDragImage(row, 0, 0);
    }
  });
  grip.addEventListener('dragend', () => ctx.dragging(null));

  const abilities = el('span', 'mdl-abilities');
  if (view.tools) {
    const tools = el('span', 'mdl-ability');
    tools.title = state.t('tickets.settings.models.row.tools');
    tools.append(glyph('tools', 14));
    abilities.append(tools);
  }
  if (view.image) {
    const image = el('span', 'mdl-ability');
    image.title = state.t('tickets.settings.models.row.image');
    image.append(glyph('image', 14));
    abilities.append(image);
  }

  const enabled = el('input', 'mdl-sw');
  enabled.type = 'checkbox';
  enabled.checked = view.row.enabled;
  const label = state.t('tickets.settings.models.row.enabled', { model: view.row.model });
  enabled.setAttribute('aria-label', label);
  enabled.title = label;
  enabled.addEventListener('change', () => {
    if (state.reply !== null) {
      void state.pool('poolModelsConfig', modelsPayload(state.reply.models, view.index, { enabled: enabled.checked }));
    }
  });

  row.append(
    grip,
    el('span', 'mdl-mono mdl-modelid', view.row.model),
    el('span', 'mdl-chip', view.chip),
    el('span', 'mdl-grow'),
    abilities,
    el('span', 'mdl-sec mdl-context', view.context),
    costCell(ctx, view),
    classMenu(ctx, view),
    enabled,
  );
  return row;
}
