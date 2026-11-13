// i18n: catalog
/**
 * Settings → Models' slot edits (D-69): `Add slot…` draws a row — name,
 * provider, profile — that Enter adds and Escape drops; every slot card
 * carries a remove control. One slot travels per write (`slotAdd` /
 * `slotRemove`); the engine keeps every other entry of `service.json` as it
 * is written, and refuses a slot a model row still names. A refusal shows
 * under the slots. The page's full redesign is a design round of its own.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { SlotProfile, SlotView, WorkerProviderId } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { el } from '../settings-dom';
import { RUNNER_LABEL } from '../settings-workers';

type SlotsAnswer = { readonly ok: true; readonly slots: readonly SlotView[] } | { readonly ok: false; readonly error: string } | null | undefined;

export interface SlotEntry {
  readonly id: string;
  readonly label: string;
  readonly provider: WorkerProviderId;
  readonly profile: SlotProfile;
}

/** The entry a typed name makes: the name is the label, its id the name in lower case with `-` for anything an id may not hold; null when nothing is left. */
export function slotEntryOf(name: string, provider: WorkerProviderId, profile: SlotProfile): SlotEntry | null {
  const label = name.trim();
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '')
    .slice(0, 48);
  return id === '' ? null : { id, label, provider, profile };
}

export interface SlotEditor {
  /** `Add slot…`, the draft row it opens, and the line a refusal shows in. */
  readonly element: HTMLElement;
  /** The remove control a slot card carries. */
  removeButton(slot: { readonly id: string; readonly name: string }): HTMLButtonElement;
}

export function createSlotEditor(api: DreyPluginApi, onSlots: (slots: readonly SlotView[]) => void): SlotEditor {
  const t = api.i18n.t.bind(api.i18n);
  const element = el('div', 'tset-models-addslot');
  const draftBox = el('div', 'tset-models-slotdraftbox');
  const note = el('div', 'tset-models-slotnote tset-error');
  note.setAttribute('role', 'alert');
  note.hidden = true;
  const add = el('button', 'tset-models-btn', t('tickets.settings.models.add_slot'));
  add.type = 'button';
  element.append(draftBox, add, note);

  const say = (words: string): void => {
    note.textContent = words;
    note.hidden = words === '';
  };

  async function send(method: 'slotAdd' | 'slotRemove', payload: unknown): Promise<boolean> {
    try {
      const answer = (await api.backend.invoke(method, payload)) as SlotsAnswer;
      if (answer === null || answer === undefined) {
        say(t('tickets.settings.models.offline'));
        return false;
      }
      if (!answer.ok) {
        say(answer.error);
        return false;
      }
      say('');
      onSlots(answer.slots);
      return true;
    } catch (failure) {
      say(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
  }

  function draftRow(): HTMLElement {
    const row = el('div', 'tset-models-slotdraft');
    const name = el('input', 'tset-models-cellfield');
    name.type = 'text';
    name.spellcheck = false;
    name.setAttribute('aria-label', t('tickets.settings.models.slot.name'));
    const provider = el('select', 'tset-models-cellfield');
    provider.setAttribute('aria-label', t('tickets.settings.models.col.provider'));
    for (const id of Object.keys(RUNNER_LABEL) as WorkerProviderId[]) {
      provider.append(Object.assign(el('option', undefined, RUNNER_LABEL[id]), { value: id }));
    }
    const profile = el('select', 'tset-models-cellfield');
    profile.setAttribute('aria-label', t('tickets.settings.models.slot.profile'));
    for (const id of ['private', 'work'] as const) {
      profile.append(Object.assign(el('option', undefined, t(`tickets.settings.models.profile.${id}`)), { value: id }));
    }
    const commit = async (): Promise<void> => {
      const entry = slotEntryOf(name.value, provider.value as WorkerProviderId, profile.value as SlotProfile);
      if (entry === null) {
        name.setAttribute('aria-invalid', 'true');
        return;
      }
      name.removeAttribute('aria-invalid');
      if (await send('slotAdd', { slot: entry })) {
        draftBox.replaceChildren();
      }
    };
    for (const control of [name, provider, profile] as readonly HTMLElement[]) {
      control.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          void commit();
        } else if (event.key === 'Escape') {
          event.stopPropagation();
          draftBox.replaceChildren();
          say('');
        }
      });
    }
    row.append(name, provider, profile);
    return row;
  }

  add.addEventListener('click', () => {
    if (draftBox.firstElementChild === null) {
      draftBox.append(draftRow());
    }
    draftBox.querySelector<HTMLInputElement>('input')?.focus();
  });

  return {
    element,
    removeButton: (slot) => {
      const remove = el('button', 'tset-models-slotremove icon-btn');
      remove.type = 'button';
      remove.title = t('tickets.settings.models.remove_slot', { name: slot.name });
      remove.setAttribute('aria-label', remove.title);
      remove.append(api.ui.icon('x', 12));
      remove.addEventListener('click', () => void send('slotRemove', { id: slot.id }));
      return remove;
    },
  };
}
