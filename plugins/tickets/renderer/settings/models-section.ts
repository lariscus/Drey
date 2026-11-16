// i18n: catalog
/**
 * Settings → Tickets → Models (board 7l v3, req-286/287): the harnesses on
 * this machine, the classes with the models in them, the accounts and the
 * routing fold. No model is typed in — the harnesses are asked, a new model
 * arrives as a card and is added to a class. The page reads what the engine
 * answers (`poolModels`, `slots`, the chain status's live load) and writes
 * only what it accepts, as the edits are made. The parts live beside this
 * file (`models-head`, `-classes`, `-accounts`, `-routing`), the state and
 * its calls in `models-state.ts`, the pure halves in `models-*-model.ts`.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { ChainStatus } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { el } from './settings-dom';
import { createAccountsPart } from './models-accounts';
import { createClassesPart } from './models-classes';
import { createHeadPart } from './models-head';
import { createRoutingPart } from './models-routing';
import { ModelsState } from './models-state';

export interface ModelsSection {
  readonly root: HTMLElement;
  /** A chain status arrived: the live load of the Now line, and a look at the accounts. */
  update(chain: ChainStatus | null): void;
  refresh(): Promise<void>;
  dispose(): void;
}

const REFRESH_MS = 5_000;

export function createModelsSection(api: DreyPluginApi): ModelsSection {
  let disposed = false;
  const state = new ModelsState(api, () => paint());
  const head = createHeadPart(state);
  const classes = createClassesPart(state);
  const accounts = createAccountsPart(state);
  const routing = createRoutingPart(state);
  const note = el('div', 'tset-error mdl-note');
  note.setAttribute('role', 'alert');

  const root = el('section', 'tset-section mdl');
  root.setAttribute('aria-labelledby', 'tset-models-head');
  // The head's note sits between the cap line and the harnesses; the rest follow the board's order.
  root.append(head.element, note, classes.element, accounts.element, routing.element);

  /** True while a field of the page has the caret: a background read must not rebuild it under the typist. */
  const typing = (): boolean => {
    const active = document.activeElement;
    return active !== null && root.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) && active.type !== 'checkbox';
  };

  function paint(): void {
    if (disposed) {
      return;
    }
    head.paint();
    classes.paint();
    accounts.paint();
    routing.paint();
    note.textContent = state.reply === null ? state.t('tickets.settings.models.offline') : state.error;
    note.hidden = note.textContent === '';
  }

  async function refresh(): Promise<void> {
    await state.load();
    if (!disposed) {
      paint();
    }
  }

  paint();
  return {
    root,
    refresh,
    update: (chain) => {
      if (state.reply !== null && chain?.pool !== undefined) {
        state.reply = { ...state.reply, now: chain.pool };
        head.paint();
        if (classes.idle() && !typing()) {
          classes.paint();
        }
      }
      if (state.age() > REFRESH_MS && !typing() && classes.idle()) {
        void refresh();
      }
    },
    dispose: () => {
      disposed = true;
      classes.dispose();
    },
  };
}
