// i18n: catalog
/**
 * Settings → Tickets → Models (board 7l, req-186): the model table, the
 * capacity caps, the slots with their quota windows, the routing group and
 * the ledger defaults. The page reads what the engine answers (`poolModels`,
 * `slots`, the chain status's live load) and writes only what the engine
 * accepts — the whole model table, the global cap, the routing (req-178's
 * `Upgrade above q` and `Reserve per window`, req-181's `Burn rate`) and the
 * three ledger defaults through `poolModelsConfig`; a refusal shows where it
 * was typed. The pure half is `models-model.ts`.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { DEFAULT_ROUTING, type CapabilityClass, type ChainStatus, type ModelRow, type ModelsReply, type SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { el } from '../settings-dom';
import {
  blankRowOf,
  capacityPayload,
  capacityViewOf,
  ledgerPayload,
  modelRowsOf,
  modelsPayload,
  moneyText,
  parseCap,
  parseCostFactor,
  parseMoney,
  parseRouting,
  parseSessions,
  placeChoiceOf,
  placeOptionsOf,
  rowPlaced,
  routingPayload,
  routingViewOf,
  slotCardsOf,
  type LedgerKey,
  type ModelRowView,
  type Parsed,
  type PlaceChoice,
  type RoutingKey,
  type SlotCardView,
} from './models-model';

export interface ModelsSection {
  readonly root: HTMLElement;
  /** A chain status arrived: the live load of the Now line, and a look at the slots. */
  update(chain: ChainStatus | null): void;
  refresh(): Promise<void>;
  dispose(): void;
}

type Refusal = { readonly ok: false; readonly error: string };
type Field = 'model' | 'provider' | 'category' | 'class' | 'cost' | 'sessions';

const CLASSES: readonly CapabilityClass[] = ['A', 'B', 'C'];
const SLOT_REFRESH_MS = 5_000;

export function createModelsSection(api: DreyPluginApi): ModelsSection {
  const t = (key: Parameters<typeof api.i18n.t>[0], params?: Parameters<typeof api.i18n.t>[1]): string => api.i18n.t(key, params);
  let reply: ModelsReply | null = null;
  let slots: readonly SlotView[] = [];
  let draft: ModelRow | null = null;
  let error = '';
  /** A refused routing write: the engine's words (or the field's own), shown under the group. */
  let routingError = '';
  let disposed = false;
  let lastSlotRead = 0;

  const root = el('section', 'tset-section tset-models');
  root.setAttribute('aria-labelledby', 'tset-models-head');
  // The anchor the Settings nav scrolls to: its 6 px put the title where the board's h1 sits once the host has left 12 px above it.
  const head = el('div', 'tset-models-head');
  head.dataset['settingsSection'] = 'models';
  const title = el('h3', 'tset-models-title', t('tickets.settings.models.title'));
  title.id = 'tset-models-head';
  head.append(title);
  const group = (key: Parameters<typeof api.i18n.t>[0]): HTMLElement => el('h4', 'tset-models-group', t(key));

  // --- Model table ------------------------------------------------------------
  const tableBox = el('div', 'tset-models-tablebox');
  const note = el('div', 'tset-models-error tset-error');
  note.setAttribute('role', 'alert');
  const addModel = el('button', 'tset-models-btn', t('tickets.settings.models.add_model'));
  addModel.type = 'button';
  const addRow = el('div', 'tset-models-addrow');
  addRow.append(addModel, el('span', 'tset-models-note', t('tickets.settings.models.table_note')));

  // --- Capacity ---------------------------------------------------------------
  const globalInput = el('input', 'tset-models-field tset-models-field-cap');
  globalInput.type = 'text';
  globalInput.spellcheck = false;
  globalInput.setAttribute('aria-label', t('tickets.settings.models.cap.global'));
  const nowLine = el('span', 'tset-models-unit');
  const perProvider = el('div', 'tset-models-perprovider');
  const capacity = el('div', 'tset-models-cols');
  capacity.append(
    field(t('tickets.settings.models.cap.global'), [globalInput, el('span', 'tset-models-unit', t('tickets.settings.models.cap.global_unit'))], nowLine),
    field(t('tickets.settings.models.cap.per_provider'), [], perProvider),
  );

  // --- Slots --------------------------------------------------------------------
  const slotCards = el('div', 'tset-models-slots');
  const addSlot = el('button', 'tset-models-btn', t('tickets.settings.models.add_slot'));
  addSlot.type = 'button';
  addSlot.title = t('tickets.settings.models.add_slot_title');
  addSlot.addEventListener('click', () => void api.backend.invoke('serviceOpenLogFolder').catch(() => undefined));

  // --- Routing (req-178 / req-181): the engine's values, written as they are made --
  const routingInputs = new Map<RoutingKey, HTMLInputElement>();
  const routingField = (key: RoutingKey, label: string, unit: string | null): HTMLElement => {
    const input = el('input', 'tset-models-field tset-models-field-cap');
    input.type = 'text';
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => void writeRouting(key, input));
    routingInputs.set(key, input);
    return field(label, [input, ...(unit === null ? [] : [el('span', 'tset-models-unit', unit)])]);
  };
  const rule = el('div', 'tset-models-rule', t('tickets.settings.models.routing.rule'));
  const routingNote = el('div', 'tset-models-error tset-error');
  routingNote.setAttribute('role', 'alert');

  // --- Ledgers ------------------------------------------------------------------
  const ledgerInputs = new Map<LedgerKey, HTMLInputElement>();
  const ledger = (key: LedgerKey, label: string, unit: string | null): HTMLElement => {
    const input = el('input', 'tset-models-field tset-models-field-money');
    input.type = 'text';
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => void writeLedger(key, input, parseMoney(input.value)));
    ledgerInputs.set(key, input);
    return field(label, [input, ...(unit === null ? [] : [el('span', 'tset-models-unit', unit)])]);
  };

  root.append(
    head,
    group('tickets.settings.models.group.table'),
    tableBox,
    addRow,
    note,
    group('tickets.settings.models.group.capacity'),
    capacity,
    group('tickets.settings.models.group.slots'),
    slotCards,
    el('div', 'tset-models-addslot'),
    group('tickets.settings.models.group.routing'),
    routingField('upgradeAboveQ', t('tickets.settings.models.routing.upgrade'), null),
    routingField('reservePerWindow', t('tickets.settings.models.routing.reserve'), t('tickets.settings.models.routing.reserve_unit')),
    routingField('burnRate', t('tickets.settings.models.routing.burn'), t('tickets.settings.models.routing.burn_unit')),
    routingNote,
    rule,
    group('tickets.settings.models.group.ledgers'),
    ledger('ticketAllowance', t('tickets.settings.models.ledgers.ticket'), t('tickets.settings.models.ledgers.ticket_unit')),
    ledger('personaPerDay', t('tickets.settings.models.ledgers.persona'), null),
    ledger('providerPerDay', t('tickets.settings.models.ledgers.provider'), null),
  );
  root.querySelector('.tset-models-addslot')!.append(addSlot);

  // --- writing ------------------------------------------------------------------
  /** One write; its refusal lands under the table, or (`routing`) under the Routing group. */
  async function write(payload: Record<string, unknown>, where: 'table' | 'routing' = 'table'): Promise<boolean> {
    const said = (words: string): void => {
      if (where === 'routing') {
        routingError = words;
      } else {
        error = words;
      }
    };
    try {
      const answer = (await api.backend.invoke('poolModelsConfig', payload)) as ModelsReply | Refusal | null;
      if (answer === null || answer === undefined) {
        said(t('tickets.settings.models.offline'));
        return false;
      }
      if (answer.ok === false) {
        said(answer.error);
        return false;
      }
      reply = answer;
      said('');
      return true;
    } catch (failure) {
      said(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      paintAll();
    }
  }

  async function writeRouting(key: RoutingKey, input: HTMLInputElement): Promise<void> {
    if (reply === null) {
      return;
    }
    const parsed = parseRouting(key, input.value);
    if (!parsed.ok) {
      input.setAttribute('aria-invalid', 'true');
      routingError = t(key === 'upgradeAboveQ' ? 'tickets.settings.models.routing.invalid_q' : 'tickets.settings.models.routing.invalid_share');
      paintRouting();
      return;
    }
    input.removeAttribute('aria-invalid');
    if (!(await write(routingPayload(reply.routing, key, parsed.value), 'routing'))) {
      input.setAttribute('aria-invalid', 'true');
    }
  }

  async function writeRows(rows: readonly ModelRow[]): Promise<boolean> {
    return write(modelsPayload(rows));
  }

  async function writeLedger(key: LedgerKey, input: HTMLInputElement, parsed: Parsed<number | null>): Promise<void> {
    if (reply === null || !parsed.ok) {
      input.setAttribute('aria-invalid', 'true');
      paintLedgers();
      return;
    }
    input.removeAttribute('aria-invalid');
    await write(ledgerPayload(reply, key, parsed.value));
  }

  globalInput.addEventListener('change', () => {
    const parsed = parseCap(globalInput.value);
    if (reply === null || !parsed.ok) {
      globalInput.setAttribute('aria-invalid', 'true');
      return;
    }
    globalInput.removeAttribute('aria-invalid');
    void write(capacityPayload(reply, parsed.value));
  });

  addModel.addEventListener('click', () => {
    if (draft === null && reply !== null) {
      draft = blankRowOf(placeOptionsOf(slots), slots);
      paintTable();
      tableBox.querySelector<HTMLInputElement>('.tset-models-draft input')?.focus();
    }
  });

  // --- the table ----------------------------------------------------------------
  function headerCell(label: string, className: string): HTMLElement {
    return el('th', className, label);
  }

  function paintTable(): void {
    const table = el('table', 'tset-models-table');
    const head = el('tr');
    head.append(
      headerCell(t('tickets.settings.models.col.model'), 'tset-models-c-model'),
      headerCell(t('tickets.settings.models.col.provider'), 'tset-models-c-provider'),
      headerCell(t('tickets.settings.models.col.category'), 'tset-models-c-category'),
      headerCell(t('tickets.settings.models.col.class'), 'tset-models-c-class'),
      headerCell(t('tickets.settings.models.col.cost'), 'tset-models-c-cost'),
      headerCell(t('tickets.settings.models.col.sessions'), 'tset-models-c-sessions'),
    );
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const view of modelRowsOf(reply, slots, api.i18n)) {
      body.append(rowOf(view));
    }
    if (draft !== null) {
      body.append(draftRow());
    }
    table.append(thead, body);
    tableBox.replaceChildren(table);
    note.textContent = reply === null ? t('tickets.settings.models.offline') : error;
    note.hidden = note.textContent === '';
  }

  function rowOf(view: ModelRowView): HTMLElement {
    const tr = el('tr', view.work ? 'tset-models-work' : undefined);
    const cell = (className: string, text: string, fieldName: Field): HTMLElement => {
      const td = el('td', className, text);
      td.tabIndex = 0;
      td.addEventListener('click', () => editCell(td, view, fieldName));
      td.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          editCell(td, view, fieldName);
        }
      });
      return td;
    };
    const provider = cell('tset-models-c-provider', view.provider, 'provider');
    if (view.work) {
      const chip = el('span', 'tset-models-chipwrap');
      chip.append(el('span', 'tset-models-chip', t('tickets.settings.models.profile.work')));
      // The board's markup has a space before the chip, then its 6 px margin.
      provider.append(document.createTextNode(' '), chip);
    }
    const remove = el('button', 'tset-models-remove icon-btn');
    remove.type = 'button';
    remove.title = t('tickets.settings.models.remove_row', { model: view.row.model });
    remove.setAttribute('aria-label', remove.title);
    remove.append(api.ui.icon('x', 12));
    remove.addEventListener('click', () => void writeRows((reply?.models ?? []).filter((_, i) => i !== view.index)));
    const model = cell('tset-models-c-model tset-models-mono', view.row.model, 'model');
    model.append(remove);
    tr.append(
      model,
      provider,
      cell('tset-models-c-category', view.row.category, 'category'),
      cell('tset-models-c-class', view.row.class, 'class'),
      cell('tset-models-c-cost', view.cost, 'cost'),
      cell('tset-models-c-sessions', view.sessions, 'sessions'),
    );
    return tr;
  }

  function controlFor(fieldName: Field, row: ModelRow): HTMLInputElement | HTMLSelectElement {
    if (fieldName === 'provider' || fieldName === 'class') {
      const select = el('select', 'tset-models-cellfield');
      const options =
        fieldName === 'provider'
          ? placeOptionsOf(slots).map((o) => ({ value: o.value as string, label: o.label }))
          : CLASSES.map((c) => ({ value: c as string, label: c as string }));
      for (const option of options) {
        select.append(Object.assign(el('option', undefined, option.label), { value: option.value }));
      }
      select.value = fieldName === 'provider' ? placeChoiceOf(row) : row.class;
      select.setAttribute('aria-label', t(`tickets.settings.models.col.${fieldName}`));
      return select;
    }
    const input = el('input', 'tset-models-cellfield');
    input.type = 'text';
    input.spellcheck = false;
    input.value = fieldName === 'model' ? row.model : fieldName === 'category' ? row.category : fieldName === 'cost' ? String(row.cost) : String(row.sessions);
    input.setAttribute('aria-label', t(`tickets.settings.models.col.${fieldName}`));
    return input;
  }

  /** The row with one typed value applied, or null when the value does not read. */
  function applied(row: ModelRow, fieldName: Field, value: string): ModelRow | null {
    switch (fieldName) {
      case 'model':
        return value.trim() === '' ? null : { ...row, model: value.trim() };
      case 'category':
        return { ...row, category: value.trim() };
      case 'class':
        return { ...row, class: value as CapabilityClass };
      case 'provider':
        return rowPlaced(row, value as PlaceChoice, slots);
      case 'cost': {
        const parsed = parseCostFactor(value);
        return parsed.ok ? { ...row, cost: parsed.value } : null;
      }
      case 'sessions': {
        const parsed = parseSessions(value);
        return parsed.ok ? { ...row, sessions: parsed.value } : null;
      }
    }
  }

  function editCell(td: HTMLElement, view: ModelRowView, fieldName: Field): void {
    if (td.querySelector('.tset-models-cellfield') !== null) {
      return;
    }
    const control = controlFor(fieldName, view.row);
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      const next = commit ? applied(view.row, fieldName, control.value) : null;
      if (next === null || JSON.stringify(next) === JSON.stringify(view.row)) {
        if (commit && next === null) {
          error = '';
        }
        paintTable();
        return;
      }
      void writeRows((reply?.models ?? []).map((row, i) => (i === view.index ? next : row)));
    };
    onKey(control, (key, event) => {
      if (key === 'Enter') {
        finish(true);
      } else if (key === 'Escape') {
        event.stopPropagation();
        finish(false);
      }
    });
    control.addEventListener('change', () => control instanceof HTMLSelectElement && finish(true));
    control.addEventListener('blur', () => finish(true));
    td.replaceChildren(control);
    control.focus();
  }

  function draftRow(): HTMLElement {
    const tr = el('tr', 'tset-models-draft');
    const fields: Field[] = ['model', 'provider', 'category', 'class', 'cost', 'sessions'];
    const classes = ['tset-models-c-model', 'tset-models-c-provider', 'tset-models-c-category', 'tset-models-c-class', 'tset-models-c-cost', 'tset-models-c-sessions'];
    const controls = fields.map((name) => controlFor(name, draft!));
    const commit = (): void => {
      let row: ModelRow | null = draft;
      fields.forEach((name, i) => {
        row = row === null ? null : applied(row, name, controls[i]!.value);
      });
      controls.forEach((control) => control.removeAttribute('aria-invalid'));
      if (row === null) {
        controls.forEach((control, i) => applied(draft!, fields[i]!, control.value) === null && control.setAttribute('aria-invalid', 'true'));
        return;
      }
      const added = row;
      draft = null;
      void writeRows([...(reply?.models ?? []), added]).then((ok) => {
        if (!ok) {
          draft = added;
          paintTable();
        }
      });
    };
    controls.forEach((control, i) => {
      onKey(control, (key, event) => {
        if (key === 'Enter') {
          commit();
        } else if (key === 'Escape') {
          event.stopPropagation();
          draft = null;
          paintTable();
        }
      });
      const td = el('td', classes[i]);
      td.append(control);
      tr.append(td);
    });
    return tr;
  }

  // --- capacity, slots, ledgers -----------------------------------------------------
  function paintCapacity(): void {
    const view = capacityViewOf(reply, api.i18n);
    if (document.activeElement !== globalInput) {
      globalInput.value = view.global;
    }
    globalInput.disabled = reply === null;
    nowLine.textContent = view.now;
    perProvider.replaceChildren(
      ...view.perProvider.map((entry) => {
        const item = el('span', 'tset-models-pp');
        item.append(el('span', 'tset-models-ppname', entry.label), entry.cap);
        return item;
      }),
    );
    perProvider.style.gridTemplateRows = `repeat(${Math.max(1, Math.min(3, view.perProvider.length))}, auto)`;
  }

  function cardOf(card: SlotCardView): HTMLElement {
    const box = el('div', 'tset-models-card');
    const head = el('div', 'tset-models-cardhead');
    head.append(el('span', 'tset-models-cardname', card.name), el('span', 'tset-models-chip', card.profile), el('span', 'tset-models-billing', card.billing));
    const rows = el('div', 'tset-models-windows');
    for (const window of card.windows) {
      const line = el('div', 'tset-models-window');
      line.append(el('span', 'tset-models-wlabel', window.label));
      if (window.bar !== null) {
        const bar = el('span', 'tset-models-bar');
        bar.setAttribute('aria-hidden', 'true');
        const fill = el('span', window.bar.low ? 'tset-models-fill tset-models-fill-low' : 'tset-models-fill');
        fill.style.width = `${window.bar.width}px`;
        bar.append(fill);
        line.append(bar);
      } else {
        line.append(el('span', 'tset-models-bar tset-models-bar-none'));
      }
      line.append(el('span', 'tset-models-wtext', window.text), reliabilityChip(window.reliability, false));
      rows.append(line);
    }
    if (card.unknownRow !== null) {
      const line = el('div', 'tset-models-unknownrow');
      line.append(card.unknownRow, reliabilityChip('unknown', true));
      rows.append(line);
    }
    const body = el('div', 'tset-models-cardbody');
    body.append(rows, el('div', 'tset-models-q', card.q));
    box.append(head, body);
    return box;
  }

  function reliabilityChip(kind: 'measured' | 'estimated' | 'unknown', tall: boolean): HTMLElement {
    const chip = el('span', `tset-models-chip tset-models-rel-${kind}${tall ? ' tset-models-chip-tall' : ' tset-models-chip-small'}`);
    chip.textContent = api.i18n.lookup(`tickets.settings.models.reliability.${kind}`);
    return chip;
  }

  function paintSlots(): void {
    const pool = reply === null ? { rows: [], routing: DEFAULT_ROUTING } : { rows: reply.models, routing: reply.routing };
    slotCards.replaceChildren(...slotCardsOf(slots, pool, new Date(), api.i18n).map(cardOf));
  }

  function paintRouting(): void {
    const view = reply === null ? null : routingViewOf(reply.routing, api.i18n);
    for (const [key, input] of routingInputs) {
      if (document.activeElement !== input && input.getAttribute('aria-invalid') !== 'true') {
        input.value = view === null ? '' : view[key];
      }
      input.disabled = reply === null;
    }
    routingNote.textContent = routingError;
    routingNote.hidden = routingError === '';
  }

  function paintLedgers(): void {
    for (const [key, input] of ledgerInputs) {
      if (document.activeElement !== input) {
        input.value = reply === null ? '' : moneyText(reply.ledgers[key], api.i18n);
      }
      input.disabled = reply === null;
    }
  }

  function paintAll(): void {
    if (disposed) {
      return;
    }
    paintTable();
    paintCapacity();
    paintSlots();
    paintRouting();
    paintLedgers();
  }

  async function refresh(): Promise<void> {
    lastSlotRead = Date.now();
    const [models, slotsReply] = await Promise.all([
      (api.backend.invoke('poolModels') as Promise<ModelsReply | null>).catch(() => null),
      (api.backend.invoke('slots') as Promise<{ readonly slots: readonly SlotView[] } | null>).catch(() => null),
    ]);
    if (disposed) {
      return;
    }
    reply = models;
    slots = slotsReply?.slots ?? [];
    paintAll();
  }

  paintAll();
  return {
    root,
    refresh,
    update: (chain) => {
      if (reply !== null && chain?.pool !== undefined) {
        reply = { ...reply, now: chain.pool };
        paintCapacity();
      }
      if (Date.now() - lastSlotRead > SLOT_REFRESH_MS) {
        void refresh();
      }
    },
    dispose: () => {
      disposed = true;
    },
  };
}

/** A 7g setting: the name in bold, the control row, then what sits under it (the page's `.tset-set` look). */
function field(name: string, controls: readonly HTMLElement[], ...below: HTMLElement[]): HTMLElement {
  const box = el('div', 'tset-set');
  box.append(el('b', 'tset-set-name', name));
  if (controls.length > 0) {
    const row = el('div', 'tset-models-row');
    row.append(...controls);
    box.append(row);
  }
  box.append(...below);
  return box;
}

function onKey(control: HTMLElement, handler: (key: string, event: KeyboardEvent) => void): void {
  control.addEventListener('keydown', (event) => handler((event as KeyboardEvent).key, event as KeyboardEvent));
}
