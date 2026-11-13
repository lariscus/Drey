// i18n: catalog
/**
 * Settings → Models, the Accounts group (board 7l v3): one row per slot with
 * its cost and sessions edited in place (each change is one `slotUpdate`), its
 * quota windows and a remove control that asks inside the row; `Add account`
 * opens a bordered row on top. Pure parts are in `models-accounts-model.ts`.
 */
import type { SlotView, WorkerProviderId } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { RUNNER_LABEL } from '../settings-workers';
import { el } from '../settings-dom';
import {
  BILLING_KINDS,
  amountText,
  billingCurrencyOf,
  billingKindOf,
  billingLabel,
  billingPatch,
  billingUnit,
  currencySymbol,
  removeAsk,
  removePayload,
  slotEntryOf,
  usesOnlyCount,
  windowBarsOf,
  type BillingKind,
  type WindowBar,
} from './models-accounts-model';
import { harnessLabelOf, stepOf } from './models-model';
import { glyphButton, groupHead, iconButton, labelled, onEnterEscape, selectOf, stepper, textButton, textField } from './models-dom';
import type { ModelsState } from './models-state';

export interface AccountsPart {
  readonly element: HTMLElement;
  paint(): void;
}

interface Draft {
  label: string;
  provider: WorkerProviderId;
  kind: BillingKind;
  amount: string;
  sessions: number;
}

const PROVIDERS = Object.keys(RUNNER_LABEL) as WorkerProviderId[];

export function createAccountsPart(state: ModelsState): AccountsPart {
  const { api } = state;
  const element = el('div');
  let draft: Draft | null = null;
  let removing: string | null = null;

  /** The Cost cluster: kind select, `€` amount, unit — `change` reports the kind and the typed amount. */
  function costCluster(kind: BillingKind, amount: string, currency: string, onChange: (kind: BillingKind, amount: string, amountField: HTMLInputElement) => void): HTMLElement {
    const cluster = el('span', 'mdl-cost-cluster');
    cluster.title = state.t('tickets.settings.models.accounts.cost_title');
    const select = selectOf(
      BILLING_KINDS.map((value) => ({ value, label: billingLabel(value, api.i18n) })),
      kind,
      state.t('tickets.settings.models.accounts.billing'),
      'mdl-fld mdl-fld-28 mdl-fld-120',
    );
    const amountBox = el('span', 'mdl-amount');
    const input = textField(amount, state.t('tickets.settings.models.accounts.amount'), 'mdl-amountfield');
    amountBox.append(el('span', 'mdl-sec', currencySymbol(currency, api.i18n)), input);
    const unit = el('span', 'mdl-sec mdl-unit', billingUnit(kind, api.i18n));
    select.addEventListener('change', () => {
      unit.textContent = billingUnit(select.value as BillingKind, api.i18n);
      onChange(select.value as BillingKind, input.value, input);
    });
    input.addEventListener('change', () => onChange(select.value as BillingKind, input.value, input));
    cluster.append(select, amountBox, unit);
    return cluster;
  }

  function barOf(window: WindowBar): HTMLElement {
    const line = el('span', 'mdl-window');
    line.title = window.title;
    const track = el('span', 'mdl-track');
    const fill = el('span', window.low ? 'mdl-fill mdl-fill-low' : 'mdl-fill');
    fill.style.width = `${window.percent}%`;
    track.append(fill);
    line.append(el('span', 'mdl-wlabel', window.label), track, el('span', undefined, window.text));
    return line;
  }

  function accountRow(slot: SlotView): HTMLElement {
    const reply = state.reply!;
    const row = el('div', 'mdl-row mdl-row-52 mdl-account');
    const currency = billingCurrencyOf(slot.billing);
    const cost = costCluster(billingKindOf(slot.billing), amountText(slot.billing, api.i18n), currency, (kind, amount, field) => {
      const patch = billingPatch(kind, amount, currency);
      if (!patch.ok) {
        field.setAttribute('aria-invalid', 'true');
        return;
      }
      field.removeAttribute('aria-invalid');
      void state.slot('slotUpdate', { id: slot.id, patch: patch.value });
    });
    const sessions = stepper(state.t, slot.total === null ? '∞' : api.i18n.formatNumber(slot.total), state.t('tickets.settings.models.accounts.sessions_title'), (delta) =>
      void state.slot('slotUpdate', { id: slot.id, patch: { sessions: stepOf(slot.total, delta) } }),
    );
    const bars = el('span', 'mdl-windows');
    bars.append(...windowBarsOf(slot, reply.routing.reservePerWindow, api.i18n).map(barOf));
    const trash = iconButton('trash', 16, state.t('tickets.settings.models.accounts.remove'), 'mdl-ib mdl-ib-28');
    trash.addEventListener('click', () => {
      removing = slot.id;
      paint();
    });
    const sessionsBox = el('span', 'mdl-sessions');
    sessionsBox.append(sessions.root, el('span', 'mdl-sec mdl-small', state.t('tickets.settings.models.accounts.sessions')));
    row.append(el('b', 'mdl-account-name', slot.label), el('span', 'mdl-sec mdl-account-harness', harnessLabelOf(slot.provider, reply.discovery.harnesses)), cost, sessionsBox, bars, el('span', 'mdl-grow'), trash);
    return row;
  }

  function confirmRow(slot: SlotView): HTMLElement {
    const reply = state.reply!;
    const uses = usesOnlyCount(slot, state.slots, reply.models);
    const row = el('div', 'mdl-row mdl-row-52 mdl-confirm');
    row.setAttribute('role', 'alertdialog');
    const remove = textButton(state.t('tickets.settings.models.accounts.remove_do'), 'warn');
    remove.addEventListener('click', () => {
      removing = null;
      void state.slot('slotRemove', removePayload(slot.id, uses));
    });
    const keep = textButton(state.t('tickets.settings.models.accounts.keep'));
    keep.addEventListener('click', () => {
      removing = null;
      paint();
    });
    row.append(el('span', 'mdl-dot'), el('span', 'mdl-grow', removeAsk(slot.label, uses, api.i18n)), remove, keep);
    return row;
  }

  function addBox(): HTMLElement {
    const current = draft!;
    const box = el('div', 'mdl-addbox mdl-addbox-account');
    const name = textField(current.label, state.t('tickets.settings.models.accounts.label'), 'mdl-fld mdl-fld-130');
    name.addEventListener('input', () => {
      current.label = name.value;
    });
    const harness = selectOf(
      PROVIDERS.map((value) => ({ value, label: harnessLabelOf(value, state.reply?.discovery.harnesses ?? []) })),
      current.provider,
      state.t('tickets.settings.models.accounts.harness'),
      'mdl-fld mdl-fld-130',
    );
    harness.addEventListener('change', () => {
      current.provider = harness.value as WorkerProviderId;
    });
    const cost = costCluster(current.kind, current.amount, 'EUR', (kind, amount) => {
      current.kind = kind;
      current.amount = amount;
    });
    const costBox = el('div', 'mdl-lab');
    costBox.append(state.t('tickets.settings.models.accounts.cost'), cost);
    const sessions = stepper(
      state.t,
      api.i18n.formatNumber(current.sessions),
      state.t('tickets.settings.models.accounts.sessions_title'),
      (delta) => {
        current.sessions = Math.max(1, current.sessions + delta);
        paint();
      },
      true,
    );
    const sessionsBox = el('div', 'mdl-lab');
    sessionsBox.append(state.t('tickets.settings.models.accounts.sessions_label'), sessions.root);
    const commit = (): void => {
      const made = slotEntryOf(current, state.slots);
      name.removeAttribute('aria-invalid');
      if (!made.ok) {
        (made.field === 'label' ? name : box.querySelector<HTMLInputElement>('.mdl-amountfield'))?.setAttribute('aria-invalid', 'true');
        return;
      }
      void state.slot('slotAdd', { slot: made.entry }).then((ok) => {
        if (ok) {
          draft = null;
          paint();
        }
      });
    };
    const cancel = (): void => {
      draft = null;
      paint();
    };
    onEnterEscape(name, commit, cancel);
    const add = textButton(state.t('tickets.settings.models.add'), 'primary', false);
    add.addEventListener('click', commit);
    const no = textButton(state.t('tickets.settings.models.cancel'), '', false);
    no.addEventListener('click', cancel);
    box.append(labelled(state.t('tickets.settings.models.accounts.label'), name), labelled(state.t('tickets.settings.models.accounts.harness'), harness), costBox, sessionsBox, el('span', 'mdl-grow'), add, no);
    return box;
  }

  function paint(): void {
    const reply = state.reply;
    if (reply === null) {
      element.replaceChildren();
      return;
    }
    const add = glyphButton('plus', state.t('tickets.settings.models.accounts.add'));
    add.addEventListener('click', () => {
      draft ??= { label: '', provider: 'claude-code', kind: 'subscription', amount: '', sessions: 1 };
      paint();
      element.querySelector<HTMLInputElement>('.mdl-addbox input')?.focus();
    });
    element.replaceChildren(
      groupHead(state.t('tickets.settings.models.accounts.title'), add),
      ...(draft === null ? [] : [addBox()]),
      ...state.slots.map((slot) => (removing === slot.id ? confirmRow(slot) : accountRow(slot))),
    );
  }

  return { element, paint };
}
