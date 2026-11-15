// i18n: catalog
/**
 * The Model block of Mission Control's persona (req-293, board 7k v4
 * `DeskPersonaPia`): the provider is the assistant's, shown and not chosen
 * (one connection is configured at a time; `Settings → LLM` changes it), the
 * model is `Same as the assistant`, one of the endpoint's models or `Other
 * model…` typed — the id stays hand-enterable, the list may be empty. The
 * draft's `chatModel` is '' for the first choice; a Save sends null for it.
 */
import { h } from '../board/desk-deps';
import type { BlockContext } from './persona-block-context';
import { blockHead, labelled, outlineButton, selectOf, textInput } from './persona-dom';

/** The select's value for `Other model…`; never a model id the endpoint lists. */
export const OTHER_MODEL = 'model:other';

export interface ModelChoices {
  readonly providerLabel: string | null;
  readonly assistantModel: string;
  readonly models: readonly string[];
  /** Why the endpoint could not be asked; '' = it answered. */
  readonly problem: string;
}

/** What the engine's reply offers; anything that is not a full answer leaves the two fixed choices and says why. */
export function modelChoicesOf(reply: unknown): ModelChoices {
  const answer = reply as { ok?: unknown; providerLabel?: unknown; assistantModel?: unknown; models?: unknown; error?: unknown } | null;
  if (answer !== null && answer.ok === true && typeof answer.providerLabel === 'string') {
    const models = Array.isArray(answer.models) ? answer.models.filter((entry): entry is string => typeof entry === 'string') : [];
    return { providerLabel: answer.providerLabel, assistantModel: typeof answer.assistantModel === 'string' ? answer.assistantModel : '', models, problem: '' };
  }
  const error = answer !== null && typeof answer.error === 'string' ? answer.error : '';
  return { providerLabel: null, assistantModel: '', models: [], problem: error };
}

/** The select's value for a draft model: '' (same), a listed id, or Other. */
export function selectionOf(chatModel: string, models: readonly string[]): string {
  const id = chatModel.trim();
  return id === '' ? '' : models.includes(id) ? id : OTHER_MODEL;
}

export function modelBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const choices = modelChoicesOf(ctx.extras.chatModels);
  const draft = ctx.draft().chatModel;
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.model.title'));
  block.append(blockHead(t('persona.model.title')));

  if (choices.providerLabel !== null) {
    const provider = h('div', 'persona-readonly-field');
    provider.dataset['field'] = 'provider';
    provider.append(h('span', 'persona-grow', choices.providerLabel), outlineButton(t('persona.model.settings_link'), 'persona-link persona-link-inline', () => ctx.api.commands.run('settings.open', { category: 'llm' })));
    block.append(labelled(t('persona.model.provider'), provider));
  }

  const options = [
    { value: '', label: t('persona.model.same') },
    ...choices.models.map((model) => ({ value: model, label: model })),
    { value: OTHER_MODEL, label: t('persona.model.other') },
  ];
  const select = selectOf(options, selectionOf(draft, choices.models), (value) => choose(value));
  select.dataset['field'] = 'chat-model';
  select.setAttribute('aria-label', t('persona.model.model'));
  const assistant = h('span', 'persona-muted persona-mono persona-model-assistant', choices.assistantModel);
  const other = textInput(selectionOf(draft, choices.models) === OTHER_MODEL ? draft : '', (value) => ctx.edit({ chatModel: value.trim() }), 'chat-model-other');
  other.setAttribute('aria-label', t('persona.model.other_id'));
  const show = (value: string): void => {
    other.hidden = value !== OTHER_MODEL;
    assistant.hidden = value !== '' || choices.assistantModel === '';
  };
  const choose = (value: string): void => {
    show(value);
    if (value === OTHER_MODEL) {
      ctx.edit({ chatModel: other.value.trim() });
      other.focus();
    } else {
      ctx.edit({ chatModel: value });
    }
  };
  show(select.value);
  const row = h('div', 'persona-model-row');
  row.append(select, assistant);
  block.append(labelled(t('persona.model.model'), row, 'persona-field-model'), other);
  if (choices.problem !== '') {
    block.append(h('small', 'persona-muted persona-model-problem', t('persona.model.unavailable', { error: choices.problem })));
  }
  return block;
}
