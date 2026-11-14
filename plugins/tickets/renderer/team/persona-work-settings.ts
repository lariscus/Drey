// i18n: catalog
/**
 * The Work block's run settings (req-258; board 7k v3, req-288): the
 * persona's pool (max and min) side by side, the read-only switch as a row,
 * the leaving actions as chips. Read-only is an instruction: the run's brief
 * carries the read-only rules, the harness keeps its permissions. The class
 * floor folded into the Model block's class.
 */
import type { PersonaLeavingAction } from '../../../../packages/tickets-engine/src/core/persona-settings';
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { labelled, outlineButton, selectOf, textInput } from './persona-dom';
import { switchButton } from './persona-controls';
import { addableActionsOf, type SettingsDraft } from './persona-settings-model';

function setOf(ctx: BlockContext): (next: Partial<SettingsDraft>, repaint?: boolean) => void {
  return (next, repaint = false) => {
    const settings = { ...ctx.draft().settings, ...next };
    if (repaint) {
      ctx.change({ settings });
    } else {
      ctx.edit({ settings });
    }
  };
}

function pair(left: HTMLElement, right: HTMLElement): HTMLElement {
  const row = h('div', 'persona-pair');
  row.append(left, right);
  return row;
}

/** Read-only as the board draws it: the label, the large switch at the right. */
function readOnlyRow(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const toggle = switchButton(t('persona.page.read_only'), ctx.draft().settings.readOnly, () => setOf(ctx)({ readOnly: !ctx.draft().settings.readOnly }, true), {
    large: true,
    title: t('persona.page.read_only_tip', { name: ctx.draft().title }),
    field: 'readonly',
  });
  const row = h('div', 'persona-row');
  row.append(h('span', 'persona-grow', t('persona.page.read_only')), toggle);
  return row;
}

function countField(ctx: BlockContext, key: 'parallel' | 'min'): HTMLElement {
  const { t } = ctx;
  const name = ctx.draft().title;
  const input = textInput(ctx.draft().settings[key], (value) => setOf(ctx)({ [key]: value }), key);
  input.inputMode = 'numeric';
  const field = labelled(t(key === 'parallel' ? 'persona.page.parallel_max' : 'persona.page.parallel_min'), input);
  field.title = t(key === 'parallel' ? 'persona.page.parallel_max_tip' : 'persona.page.parallel_min_tip', { name });
  return field;
}

function actionChip(ctx: BlockContext, action: PersonaLeavingAction): HTMLElement {
  const chip = h('span', 'persona-action', action);
  chip.dataset['action'] = action;
  const remove = h('button', 'persona-action-x');
  remove.type = 'button';
  const label = ctx.t('persona.page.remove_action', { action });
  remove.title = label;
  remove.setAttribute('aria-label', label);
  remove.append(ctx.api.ui.icon('x', 12));
  remove.addEventListener('click', () => setOf(ctx)({ leaving: ctx.draft().settings.leaving.filter((entry) => entry !== action) }, true));
  chip.append(remove);
  return chip;
}

/** `Add action…`: the actions not yet on the persona, as a select in the button's place. */
function addAction(ctx: BlockContext): HTMLElement | null {
  const choices = addableActionsOf(ctx.draft().settings.leaving);
  if (choices.length === 0) {
    return null;
  }
  const label = ctx.t('persona.page.add_action');
  const open = outlineButton(label, 'persona-action-add', () => {
    const select = selectOf([{ value: '', label }, ...choices.map((action) => ({ value: action, label: action }))], '', (value) => {
      if (value !== '') {
        setOf(ctx)({ leaving: [...ctx.draft().settings.leaving, value as PersonaLeavingAction] }, true);
      }
    }, 'persona-select persona-select-sm');
    select.setAttribute('aria-label', label);
    open.replaceWith(select);
    select.focus();
  });
  return open;
}

function leavingActions(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const chips = h('div', 'persona-actions');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', t('persona.page.leaving'));
  chips.append(...ctx.draft().settings.leaving.map((action) => actionChip(ctx, action)));
  const add = addAction(ctx);
  if (add !== null) {
    chips.append(add);
  }
  const field = labelled(t('persona.page.leaving'), chips);
  field.firstElementChild?.setAttribute('title', t('persona.page.leaving_tip', { name: ctx.draft().title }));
  return field;
}

/** The settings rows of the Work block, in board order. */
export function workSettingsNodes(ctx: BlockContext): readonly HTMLElement[] {
  return [pair(countField(ctx, 'parallel'), countField(ctx, 'min')), readOnlyRow(ctx), leavingActions(ctx)];
}
