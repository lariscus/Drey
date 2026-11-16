// i18n: catalog
/**
 * Settings → Models, the top of the page (board 7l v3): the title with when
 * the harnesses were last asked and Find models again, the global cap with the
 * live load, and the Harnesses group — one row per harness on this machine.
 */
import { el } from './settings-dom';
import { checkedWords, harnessViewsOf, stepOf, capacityPayload, trimmedNumber, type HarnessView } from './models-model';
import { glyph, groupHead, iconButton, stepper, textButton } from './models-dom';
import type { ModelsState } from './models-state';

export interface HeadPart {
  readonly element: HTMLElement;
  paint(): void;
}

export function createHeadPart(state: ModelsState): HeadPart {
  const { api } = state;
  const title = el('h3', 'mdl-title', state.t('tickets.settings.models.title'));
  title.id = 'tset-models-head';
  const checked = el('span', 'mdl-sec');
  const again = iconButton('refresh', 16, state.t('tickets.settings.models.find_again'), 'mdl-ib mdl-ib-28');
  again.addEventListener('click', () => void state.discover(true));
  const titleRow = el('div', 'mdl-titlerow');
  titleRow.dataset['settingsSection'] = 'models';
  titleRow.append(title, el('span', 'mdl-grow'), checked, again);

  const capRow = el('div', 'mdl-caprow');
  const harnesses = el('div', 'mdl-harnesses');
  const harnessGroup = el('div');
  const element = el('div');
  element.append(titleRow, capRow, harnessGroup, harnesses);

  function harnessRow(view: HarnessView): HTMLElement {
    const row = el('div', 'mdl-row mdl-row-34');
    const lead = el('span', view.installed ? 'mdl-harness' : 'mdl-harness mdl-dim');
    const name = el('span', 'mdl-harness-name');
    name.append(el('b', undefined, view.label), ' ', el('span', 'mdl-sec', view.version));
    const stateText = el('span', 'mdl-sec', view.state);
    if (view.error !== '') {
      stateText.title = view.error;
    }
    lead.append(glyph('terminal', 16), name, stateText);
    row.append(lead);
    if (view.installed) {
      row.append(el('span', 'mdl-sec mdl-harness-count', view.models));
    } else {
      const install = textButton(state.t('tickets.settings.models.harness.install'));
      install.title = state.t('tickets.settings.models.harness.install_hint', { harness: view.label });
      install.disabled = true;
      row.append(install);
    }
    return row;
  }

  function paint(): void {
    const reply = state.reply;
    const discovery = reply?.discovery;
    checked.textContent = discovery === undefined ? '' : state.checking ? state.t('tickets.settings.models.checking') : checkedWords(discovery, new Date(), api.i18n);
    again.disabled = state.checking; // a sleeping runner: the write wakes it
    capRow.replaceChildren();
    harnessGroup.replaceChildren();
    harnesses.replaceChildren();
    if (reply === null) {
      return;
    }
    const global = reply.capacity.global;
    const cap = stepper(state.t, global === null ? '∞' : api.i18n.formatNumber(global), state.t('tickets.settings.models.cap.title'), (delta) =>
      void state.pool('poolModelsConfig', capacityPayload(reply, stepOf(global, delta))),
    );
    const now = reply.now;
    capRow.append(
      el('span', undefined, state.t('tickets.settings.models.cap.global')),
      cap.root,
      el(
        'span',
        'mdl-sec',
        now.global === null
          ? state.t('tickets.settings.models.cap.now_open', { used: trimmedNumber(api.i18n, now.used) })
          : state.t('tickets.settings.models.cap.now', { used: trimmedNumber(api.i18n, now.used), cap: trimmedNumber(api.i18n, now.global) }),
      ),
    );
    harnessGroup.append(groupHead(state.t('tickets.settings.models.harnesses')));
    harnesses.append(...harnessViewsOf(reply.discovery, api.i18n).map(harnessRow));
  }

  return { element, paint };
}
