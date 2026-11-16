// i18n: catalog
/**
 * Settings → Models, the Classes group (board 7l v3): one card per model the
 * harnesses found and the table does not hold (Add to a class or Ignore), then
 * one group per class, strongest first — its session cap, its live load and
 * its models. A model moves by dragging its row into another group or by its
 * class menu; a class is added in a row of its own and removed while empty.
 */
import { el } from './settings-dom';
import {
  classAdded,
  classGroupsOf,
  classRemoved,
  classSessionsPayload,
  classesPayload,
  foundCardsOf,
  modelsPayload,
  stepOf,
  type ClassGroupView,
  type FoundCardView,
} from './models-model';
import { classRowOf, type RowContext } from './models-class-row';
import { glyphButton, groupHead, iconButton, labelled, onEnterEscape, selectOf, stepper, textButton, textField } from './models-dom';
import type { ModelsState } from './models-state';

export interface ClassesPart {
  readonly element: HTMLElement;
  paint(): void;
  /** No menu, cost field, add row or drag is open — a live-load repaint will not take anything from under the hand. */
  idle(): boolean;
  dispose(): void;
}

export function createClassesPart(state: ModelsState): ClassesPart {
  const { api } = state;
  const element = el('div');
  let adding = false;
  let menu: number | null = null;
  let cost: number | null = null;
  let drag: number | null = null;
  let typed = '';
  let before = '';
  let nameError = '';

  const repaint = (): void => paint();
  const moveRow = (index: number, className: string): void => {
    const reply = state.reply;
    if (reply !== null && reply.models[index] !== undefined && reply.models[index]!.class !== className) {
      void state.pool('poolModelsConfig', modelsPayload(reply.models, index, { class: className }));
    }
  };
  // One document listener closes an open class menu; it is the page's only global one.
  const closeMenu = (): void => {
    if (menu !== null) {
      menu = null;
      repaint();
    }
  };
  document.addEventListener('click', closeMenu);
  const ctx = (classNames: readonly string[]): RowContext => ({
    state,
    classNames,
    menuFor: () => menu,
    openMenu: (index) => {
      menu = index;
      repaint();
    },
    costFor: () => cost,
    editCost: (index) => {
      cost = index;
      repaint();
    },
    dragging: (index) => {
      drag = index;
    },
    moveRow,
  });

  function addRow(classNames: readonly string[]): HTMLElement {
    const box = el('div', 'mdl-addbox');
    const name = textField(typed, state.t('tickets.settings.models.classes.name'));
    name.addEventListener('input', () => {
      typed = name.value;
    });
    const where = selectOf(
      [...classNames.map((value) => ({ value, label: state.t('tickets.settings.models.classes.above', { name: value }) })), { value: '', label: state.t('tickets.settings.models.classes.last') }],
      before,
      state.t('tickets.settings.models.classes.position'),
    );
    where.addEventListener('change', () => {
      before = where.value;
    });
    const commit = (): void => {
      const reply = state.reply;
      if (reply === null) {
        return;
      }
      const added = classAdded(reply.classes, name.value, where.value === '' ? null : where.value);
      if (!added.ok) {
        nameError = added.error;
        name.setAttribute('aria-invalid', 'true');
        name.title = state.t(added.error === 'taken' ? 'tickets.settings.models.classes.taken' : 'tickets.settings.models.classes.invalid');
        return;
      }
      void state.pool('poolModelsConfig', classesPayload(added.classes)).then((ok) => {
        if (ok) {
          adding = false;
          typed = '';
          before = '';
          nameError = '';
          repaint();
        }
      });
    };
    const cancel = (): void => {
      adding = false;
      typed = '';
      before = '';
      nameError = '';
      repaint();
    };
    onEnterEscape(name, commit, cancel);
    const add = textButton(state.t('tickets.settings.models.add'), 'primary', false);
    add.addEventListener('click', commit);
    const no = textButton(state.t('tickets.settings.models.cancel'), '', false);
    no.addEventListener('click', cancel);
    if (nameError !== '') {
      name.setAttribute('aria-invalid', 'true');
    }
    box.append(labelled(state.t('tickets.settings.models.classes.name'), name), labelled(state.t('tickets.settings.models.classes.position'), where), el('span', 'mdl-grow'), add, no);
    return box;
  }

  function foundCard(card: FoundCardView, classNames: readonly string[]): HTMLElement {
    const box = el('div', 'mdl-found');
    box.append(el('span', 'mdl-dot'));
    const words = el('span');
    words.append(el('span', 'mdl-sec', state.t('tickets.settings.models.found.new')), ' ', el('span', 'mdl-mono', card.model));
    const pick = selectOf(
      classNames.map((value) => ({ value, label: value })),
      classNames.includes(card.suggested) ? card.suggested : (classNames[classNames.length - 1] ?? ''),
      state.t('tickets.settings.models.found.class_of', { model: card.model }),
      'mdl-fld mdl-fld-28',
    );
    const label = el('label', 'mdl-sec mdl-foundclass');
    label.append(state.t('tickets.settings.models.found.class'), pick);
    const add = textButton(state.t('tickets.settings.models.add'), 'primary');
    add.addEventListener('click', () => void state.pool('poolModelAdd', { provider: card.provider, model: card.model, class: pick.value }));
    const ignore = textButton(state.t('tickets.settings.models.found.ignore'));
    ignore.addEventListener('click', () => void state.pool('poolModelIgnore', { provider: card.provider, model: card.model }));
    box.append(words, el('span', 'mdl-chip', card.chip), el('span', 'mdl-grow'), label, add, ignore);
    return box;
  }

  function group(view: ClassGroupView, rowCtx: RowContext, removable: boolean): HTMLElement {
    const box = el('div', 'mdl-class');
    const head = el('div', 'mdl-classhead');
    head.append(el('b', 'mdl-classname', view.name), el('span', 'mdl-sec mdl-small', view.count), el('span', 'mdl-grow'));
    if (removable && view.rows.length === 0) {
      head.append(iconButton('close', 14, state.t('tickets.settings.models.classes.remove', { name: view.name })));
      head.lastElementChild?.addEventListener('click', () => {
        const reply = state.reply;
        if (reply !== null) {
          void state.pool('poolModelsConfig', classesPayload(classRemoved(reply.classes, reply.models, view.name)));
        }
      });
    }
    const cap = stepper(state.t, view.sessions === null ? '∞' : api.i18n.formatNumber(view.sessions), state.t('tickets.settings.models.classes.cap_title'), (delta) => {
      if (state.reply !== null) {
        void state.pool('poolModelsConfig', classSessionsPayload(state.reply.classes, view.name, stepOf(view.sessions, delta)));
      }
    });
    head.append(el('span', 'mdl-sec mdl-small', state.t('tickets.settings.models.classes.at_most')), cap.root, el('span', 'mdl-sec mdl-small mdl-busy', view.busy));
    box.append(head, ...view.rows.map((row) => classRowOf(rowCtx, row)));
    box.addEventListener('dragover', (event) => {
      if (drag !== null) {
        event.preventDefault();
        box.classList.add('mdl-drop');
      }
    });
    box.addEventListener('dragleave', (event) => {
      if (!box.contains(event.relatedTarget as Node | null)) {
        box.classList.remove('mdl-drop');
      }
    });
    box.addEventListener('drop', (event) => {
      event.preventDefault();
      box.classList.remove('mdl-drop');
      if (drag !== null) {
        const index = drag;
        drag = null;
        moveRow(index, view.name);
      }
    });
    return box;
  }

  function paint(): void {
    const reply = state.reply;
    if (reply === null) {
      element.replaceChildren();
      return;
    }
    const names = reply.classes.map((c) => c.name);
    const add = glyphButton('plus', state.t('tickets.settings.models.classes.add'), 'dashed');
    add.addEventListener('click', () => {
      adding = true;
      repaint();
      element.querySelector<HTMLInputElement>('.mdl-addbox input')?.focus();
    });
    const groups = classGroupsOf(reply, state.slots, api.i18n);
    const rowCtx = ctx(groups.map((g) => g.name));
    element.replaceChildren(
      groupHead(state.t('tickets.settings.models.classes.title'), add),
      ...(adding ? [addRow(names)] : []),
      ...foundCardsOf(reply, state.slots, api.i18n).map((card) => foundCard(card, groups.map((g) => g.name))),
      ...groups.map((view) => group(view, rowCtx, groups.length > 1)),
    );
  }

  return { element, paint, idle: () => menu === null && cost === null && drag === null && !adding, dispose: () => document.removeEventListener('click', closeMenu) };
}
