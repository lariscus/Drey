/**
 * The Flow tab (E13-11, design boards 5i "Shape the flow" and 7a–7c): one
 * ticket's chain (or one plan part's) as a list of gates with `+`
 * connectors, every gate's actions in its own menu (click, right-click or
 * the row's ⋯ — run as, tell me, move, remove this gate), and a foot with
 * reset and "Save flow". The inspector column is gone: the list is the one
 * surface, and the menu shows the engine's rules as disabled rows with
 * their reason instead of refusals.
 *
 * Nothing is written before "Save flow": the tab keeps a draft, and every
 * edit is a round trip to the engine (`flowEdit`) that returns the next
 * draft — the same grammar and guard the phone's editor goes through
 * (`core/flow-edit.ts`). This file is the DOM and the controller; the
 * wording and the rules about what may move are in `flow-model.ts`.
 */
import type { FlowOp, FlowStepView } from '../../../../packages/tickets-engine/src/contracts/flow';
import type { DeskDeps } from '../board/desk-deps';
import { h, textButton } from '../board/desk-deps';
import {
  addablePersonasOf,
  changedIndicesOf,
  changesLabelOf,
  eyebrowOf,
  isDirty,
  isStandardFlow,
  marksOf,
  moveRoomOf,
  runAsOptionsOf,
  whoOf,
  type FlowDraft,
  type FlowTarget,
} from './flow-model';

export type FlowDeps = Pick<DeskDeps, 'invoke' | 'subscribe' | 'titleOf'>;

interface FlowState {
  draft: FlowDraft | null;
  /** The flow as the file holds it; the dashed marks compare against it. */
  saved: FlowDraft | null;
  error: string;
  adding: number | null;
  message: string;
  notice: string;
  busy: boolean;
}

type EditReply = { readonly ok: true; readonly [key: string]: unknown } | { readonly ok: false; readonly error: string };

/** Mounts the Flow tab for one target; returns the dispose. */
export function mountFlow(deps: FlowDeps, host: HTMLElement, target: FlowTarget): () => void {
  const state: FlowState = { draft: null, saved: null, error: '', adding: null, message: '', notice: '', busy: false };
  let disposed = false;
  const payload = { id: target.ticketId, part: target.part };

  const root = h('section', 'flow-tab');
  root.setAttribute('aria-label', 'Flow editor');
  const head = h('header', 'flow-head');
  const body = h('div', 'flow-body');
  const foot = h('footer', 'flow-foot');
  const messageLine = h('p', 'flow-message');
  messageLine.setAttribute('role', 'alert');
  const resetButton = textButton('Reset to standard flow', 'desk-btn desk-btn-link', 'Drop every change and run the standard flow', () => void run({ op: 'reset' }));
  resetButton.hidden = isStandardFlow(target);
  const saveButton = textButton('Save flow', 'desk-btn desk-btn-primary', isStandardFlow(target) ? 'Write this flow as the default for new tickets' : 'Write this flow to the ticket', () => void save());
  const buttons = h('div', 'flow-buttons');
  buttons.append(resetButton, h('span', 'flow-grow'), saveButton);
  foot.append(messageLine, buttons);
  root.append(head, body, foot);
  host.replaceChildren(root);

  const readOnly = (): boolean => state.draft?.readOnly != null;

  const toggleAdding = (after: number): void => {
    state.adding = state.adding === after ? null : after;
    state.message = '';
    paint();
  };

  async function call(method: string, extra: Record<string, unknown>): Promise<EditReply> {
    try {
      return (await deps.invoke(method, { ...payload, ...extra })) as EditReply;
    } catch (failure) {
      return { ok: false, error: failure instanceof Error ? failure.message : String(failure) };
    }
  }

  async function load(): Promise<void> {
    const reply = await call('flow', {});
    if (disposed) {
      return;
    }
    closeGateMenus();
    if (reply.ok) {
      const flow = reply as unknown as FlowDraft;
      state.draft = flow;
      state.saved = flow;
      state.error = '';
    } else {
      state.error = reply.error;
    }
    paint();
  }

  /** One engine round trip; the refusal comes back as text under the list. */
  async function guarded(work: () => Promise<boolean>): Promise<boolean> {
    if (state.busy) {
      return false;
    }
    state.busy = true;
    state.message = '';
    state.notice = '';
    paint();
    try {
      return await work();
    } finally {
      state.busy = false;
      if (!disposed) {
        paint();
      }
    }
  }

  function run(op: FlowOp): Promise<boolean> {
    return guarded(async () => {
      if (state.draft === null) {
        return false;
      }
      const reply = await call('flowEdit', { chain: state.draft.chain, edit: op });
      if (!disposed && reply.ok) {
        state.draft = reply as unknown as FlowDraft;
        return true;
      }
      state.message = reply.ok ? '' : reply.error;
      return false;
    });
  }

  function save(): Promise<boolean> {
    return guarded(async () => {
      if (state.draft === null) {
        return false;
      }
      const reply = await call('flowSave', { chain: state.draft.chain });
      if (!reply.ok) {
        state.message = reply.error;
        return false;
      }
      const warning = typeof reply['warning'] === 'string' ? reply['warning'] : '';
      await load();
      state.notice = warning === '' ? 'Saved' : `Saved · ${warning}`;
      return true;
    });
  }

  // --- painting ---------------------------------------------------------------

  function paintHead(): void {
    const flow = state.draft;
    head.replaceChildren();
    head.append(h('span', 'flow-id', isStandardFlow(target) ? 'Default flow' : target.ticketId));
    const title = isStandardFlow(target) ? null : deps.titleOf(target.ticketId);
    if (title !== null && flow === null) {
      head.append(h('span', 'flow-head-title', title));
    }
    head.append(h('span', 'flow-grow'));
    if (flow !== null) {
      const dirty = isDirty(flow, state.saved);
      head.append(h('span', `flow-chip${dirty ? ' is-dirty' : ''}`, dirty ? `${changesLabelOf(flow.chain)} · not saved` : changesLabelOf(flow.chain)));
    }
  }

  function gateNode(flow: FlowDraft, index: number, changed: ReadonlySet<number>): HTMLElement {
    const gate = flow.steps[index]!;
    const item = h('li', 'flow-item');
    const persona = flow.personas.find((p) => p.id === gate.persona);
    const row = h('button', 'flow-gate');
    row.type = 'button';
    for (const [flag, name] of [
      [changed.has(gate.index), 'is-dashed'],
      [gate.state === 'current', 'is-current'],
    ] as const) {
      row.classList.toggle(name, flag);
    }
    row.setAttribute('aria-haspopup', 'menu');
    row.setAttribute('aria-label', `${gate.title}, ${whoOf(gate, flow)}${gate.state === 'current' ? ', current gate' : ''}`);
    const dot = h('span', 'flow-dot');
    dot.style.background = persona?.color ?? 'var(--text-3)';
    const text = h('span', 'flow-gate-main');
    text.append(h('b', 'flow-gate-title', gate.title), h('span', 'flow-gate-who', [whoOf(gate, flow), gate.model].filter((x) => x !== null && x !== '').join(' · ')));
    row.append(dot, text);
    if (gate.state === 'current') {
      row.append(h('span', 'flow-mark is-running', 'Current'));
    }
    for (const mark of marksOf(gate)) {
      row.append(h('span', 'flow-mark', mark));
    }
    const openAt = (x: number, y: number): void => openGateMenu(flow, gate, { x, y }, row);
    row.addEventListener('click', () => {
      const rect = row.getBoundingClientRect();
      openAt(rect.left, rect.bottom + 2);
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openAt(event.clientX, event.clientY);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        openAt(rect.left, rect.bottom + 2);
      }
    });
    item.append(row);

    const more = h('button', 'flow-more', '⋯');
    more.type = 'button';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-label', `Options for ${gate.title}`);
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = more.getBoundingClientRect();
      openAt(rect.left, rect.bottom + 2);
    });
    item.append(more);

    const plus = h('button', `flow-plus${state.adding === gate.index ? ' is-open' : ''}`);
    plus.type = 'button';
    plus.disabled = readOnly();
    plus.title = `Add a persona after ${gate.title}`;
    plus.setAttribute('aria-label', `Add a persona after ${gate.title}`);
    plus.setAttribute('aria-expanded', String(state.adding === gate.index));
    plus.append(h('span', 'flow-plus-line'), h('span', 'flow-plus-dot', '+'));
    plus.addEventListener('click', () => toggleAdding(gate.index));
    item.append(plus);
    if (state.adding === gate.index) {
      item.append(addNode(flow, gate.index));
    }
    return item;
  }

  function addNode(flow: FlowDraft, after: number): HTMLElement {
    const box = h('div', 'flow-add');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Add a persona');
    for (const persona of addablePersonasOf(flow)) {
      const chip = textButton(persona.title, 'flow-chipbtn', `Add ${persona.title}`, () => {
        void run({ op: 'insert', persona: persona.id, after }).then((ok) => {
          if (ok) {
            state.adding = null;
            paint();
          }
        });
      });
      chip.disabled = state.busy;
      box.append(chip);
    }
    return box;
  }

  function paintBody(): void {
    const flow = state.draft;
    body.replaceChildren();
    if (flow === null) {
      body.append(h('p', state.error === '' ? 'flow-note' : 'flow-note is-error', state.error === '' ? 'Loading…' : state.error));
      return;
    }
    const title = h('div', 'flow-title');
    title.append(h('span', 'flow-eyebrow', eyebrowOf(flow)), h('h2', 'flow-h', flow.scope.kind === 'part' ? flow.scope.title : flow.title));
    body.append(title);
    if (flow.readOnly != null) {
      body.append(h('p', 'flow-note', flow.readOnly));
    }
    const changed = changedIndicesOf(flow, state.saved);
    const list = h('ol', 'flow-list');
    list.setAttribute('aria-label', 'Gates');
    flow.steps.forEach((_, index) => list.append(gateNode(flow, index, changed)));
    body.append(list);
  }

  function paintFoot(): void {
    const flow = state.draft;
    foot.hidden = flow === null;
    const locked = readOnly() || state.busy;
    resetButton.disabled = locked;
    saveButton.disabled = locked || !isDirty(flow, state.saved);
    messageLine.textContent = state.message !== '' ? state.message : state.notice;
    messageLine.classList.toggle('is-error', state.message !== '');
    messageLine.hidden = messageLine.textContent === '';
  }

  function paint(): void {
    if (disposed) {
      return;
    }
    paintHead();
    paintBody();
    paintFoot();
  }

  // --- the gate's menu --------------------------------------------------------

  function closeGateMenus(): void {
    for (const menu of document.querySelectorAll('.flow-gate-menu')) {
      menu.remove();
    }
  }

  /** ArrowUp / ArrowDown move the focus through the menu's enabled rows. */
  function cycleMenuFocus(menu: HTMLElement, event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const items = [...menu.querySelectorAll<HTMLButtonElement>('.tickets-menu-item:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : items.length - 1;
    items[(at === -1 ? (step === 1 ? 0 : step) : at + step) % items.length]?.focus();
  }

  /**
   * The gate's actions where the gate is (the list is the one surface):
   * run as — the crew, the position's rules shown as disabled rows with
   * their reason —, the tell-me rule, moving, removing. Click, right-click
   * and the row's ⋯ all land here.
   */
  function openGateMenu(flow: FlowDraft, gate: FlowStepView, at: { readonly x: number; readonly y: number }, focusBack: HTMLElement): void {
    closeGateMenus();
    if (state.busy || disposed) {
      return;
    }
    const menu = h('div', 'tickets-menu flow-gate-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `${gate.title} — gate options`);
    const outside = (event: Event): void => {
      if (!menu.contains(event.target as Node)) {
        close();
      }
    };
    const close = (): void => {
      menu.remove();
      window.removeEventListener('mousedown', outside, true);
    };
    const stop = flow.readOnly ?? (gate.locked ? 'the current step stays as it is' : null);
    const row = (content: HTMLElement, action: (() => void) | null, reason: string | null, danger = false): void => {
      const button = h('button', `tickets-menu-item${danger ? ' is-remove' : ''}`);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.append(content);
      if (reason !== null) {
        button.disabled = true;
        button.title = reason;
      } else if (action !== null) {
        button.addEventListener('click', () => {
          close();
          action();
        });
      }
      menu.append(button);
    };
    const checked = (label: string, on: boolean): HTMLElement => {
      const span = h('span', 'tickets-menu-radio');
      span.append(h('span', 'tickets-menu-check', on ? '✓' : ''), h('span', 'tickets-menu-label', label));
      return span;
    };
    const dotted = (label: string, color: string | undefined, on: boolean): HTMLElement => {
      const span = h('span', 'tickets-menu-radio');
      const dot = h('span', 'flow-dot is-small');
      dot.style.background = color ?? 'var(--text-3)';
      span.append(dot, h('span', 'tickets-menu-label', label), h('span', 'tickets-menu-check', on ? '✓' : ''));
      return span;
    };

    menu.append(h('p', 'tickets-menu-label', 'Run as'));
    for (const option of runAsOptionsOf(flow, gate)) {
      row(
        dotted(option.persona.title, option.persona.color, option.persona.id === gate.persona),
        () => void run({ op: 'persona', step: gate.index, persona: option.persona.id }),
        option.reason,
      );
    }
    menu.append(h('div', 'tickets-menu-sep'));
    row(
      checked('Tell me when it is done', gate.notify),
      () => void run({ op: 'notify', step: gate.index, on: !gate.notify }),
      flow.readOnly,
    );
    menu.append(h('div', 'tickets-menu-sep'));
    const room = moveRoomOf(flow, gate);
    row(
      h('span', 'tickets-menu-label', 'Move earlier'),
      () => void run({ op: 'move', step: gate.index, dir: -1 }),
      stop ?? (room.earlier ? null : 'that is the first position'),
    );
    row(
      h('span', 'tickets-menu-label', 'Move later'),
      () => void run({ op: 'move', step: gate.index, dir: 1 }),
      stop ?? (room.later ? null : 'that is the last position'),
    );
    menu.append(h('div', 'tickets-menu-sep'));
    row(
      h('span', 'tickets-menu-label', 'Remove this gate'),
      () => void run({ op: 'remove', step: gate.index }),
      stop,
      true,
    );
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        focusBack.focus();
      } else {
        cycleMenuFocus(menu, event);
      }
    });
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(at.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(0, Math.min(at.y, window.innerHeight - rect.height - 8))}px`;
    window.addEventListener('mousedown', outside, true);
    menu.querySelector<HTMLButtonElement>('.tickets-menu-item:not(:disabled)')?.focus();
  }

  // A board change reloads the flow while the draft has no edits of its own.
  const off = deps.subscribe(() => {
    if (!state.busy && !isDirty(state.draft, state.saved)) {
      void load();
    }
  });
  paint();
  void load();
  return () => {
    disposed = true;
    closeGateMenus();
    off();
  };
}
