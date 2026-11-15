// i18n: catalog
/**
 * Settings → Models, the Routing group (board 7l v3): one folded row that
 * reads the three routing values; open, it holds the fields (Upgrade above q,
 * Reserve per window, Burn rate) and the three ledger defaults. Every field
 * writes as it is left, through `poolModelsConfig`; a refusal shows under it.
 */
import { el } from './dom.ts/settings-dom';
import { glyph, groupHead, textField } from './models-dom';
import {
  ledgerPayload,
  moneyText,
  parseMoney,
  parseRouting,
  routingPayload,
  routingSummary,
  routingViewOf,
  type LedgerKey,
  type RoutingKey,
} from './models-routing-model';
import type { ModelsState } from './models-state';

export interface RoutingPart {
  readonly element: HTMLElement;
  paint(): void;
}

export function createRoutingPart(state: ModelsState): RoutingPart {
  const { api } = state;
  const element = el('div');
  let open = false;
  let error = '';

  function field(label: string, input: HTMLInputElement, unit: string | null): HTMLElement {
    const line = el('label', 'mdl-setting');
    line.append(el('span', 'mdl-sec', label), input);
    if (unit !== null) {
      line.append(el('span', 'mdl-sec mdl-small', unit));
    }
    return line;
  }

  function routingField(key: RoutingKey, label: string, unit: string | null): HTMLElement {
    const reply = state.reply!;
    const input = textField(routingViewOf(reply.routing, api.i18n)[key], label, 'mdl-fld mdl-fld-80');
    input.addEventListener('change', () => {
      const parsed = parseRouting(key, input.value);
      if (!parsed.ok) {
        input.setAttribute('aria-invalid', 'true');
        error = state.t(key === 'upgradeAboveQ' ? 'tickets.settings.models.routing.invalid_q' : 'tickets.settings.models.routing.invalid_share');
        paint();
        return;
      }
      input.removeAttribute('aria-invalid');
      error = '';
      void state.pool('poolModelsConfig', routingPayload(reply.routing, key, parsed.value)).then((ok) => {
        if (!ok) {
          error = state.error;
          paint();
        }
      });
    });
    return field(label, input, unit);
  }

  function ledgerField(key: LedgerKey, label: string, unit: string | null): HTMLElement {
    const reply = state.reply!;
    const input = textField(moneyText(reply.ledgers[key], api.i18n), label, 'mdl-fld mdl-fld-80');
    input.addEventListener('change', () => {
      const parsed = parseMoney(input.value);
      if (!parsed.ok) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.removeAttribute('aria-invalid');
      void state.pool('poolModelsConfig', ledgerPayload(reply, key, parsed.value));
    });
    return field(label, input, unit);
  }

  function paint(): void {
    const reply = state.reply;
    if (reply === null) {
      element.replaceChildren();
      return;
    }
    const fold = el('button', 'mdl-row mdl-fold');
    fold.type = 'button';
    fold.setAttribute('aria-expanded', String(open));
    const words = el('span');
    words.append(el('b', undefined, state.t('tickets.settings.models.routing.title')), ' ', el('span', 'mdl-sec', `· ${routingSummary(reply.routing, api.i18n)}`));
    fold.append(el('span', 'mdl-chevron'), words);
    fold.firstElementChild?.append(glyph(open ? 'down' : 'right', 14));
    fold.addEventListener('click', () => {
      open = !open;
      paint();
    });
    const body = el('div', 'mdl-fields');
    if (open) {
      body.append(
        routingField('upgradeAboveQ', state.t('tickets.settings.models.routing.upgrade'), null),
        routingField('reservePerWindow', state.t('tickets.settings.models.routing.reserve'), state.t('tickets.settings.models.routing.reserve_unit')),
        routingField('burnRate', state.t('tickets.settings.models.routing.burn'), state.t('tickets.settings.models.routing.burn_unit')),
        ledgerField('ticketAllowance', state.t('tickets.settings.models.ledgers.ticket'), state.t('tickets.settings.models.ledgers.ticket_unit')),
        ledgerField('personaPerDay', state.t('tickets.settings.models.ledgers.persona'), null),
        ledgerField('providerPerDay', state.t('tickets.settings.models.ledgers.provider'), null),
      );
      if (error !== '') {
        const note = el('div', 'tset-error mdl-note', error);
        note.setAttribute('role', 'alert');
        body.append(note);
      }
    }
    element.replaceChildren(groupHead(state.t('tickets.settings.models.routing.title')), fold, ...(open ? [body] : []));
  }

  return { element, paint };
}
