// i18n: catalog
/**
 * The deletion ask (req-261): a modal in the host's overlay — the title, one
 * line saying what goes and what stays, the field that takes the persona's
 * exact title, a refusal in the engine's words, Cancel and Delete. Plain DOM
 * over `PersonaDeleteAsk`: Delete is disabled until the text matches, Enter in
 * the field submits only then, Escape cancels. A modal with a deletion on its
 * way keeps still: nothing closes it until the engine has answered.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { h } from '../desk-deps';
import type { PersonaDeleteAsk } from './persona-delete-state';
import { labelled, outlineButton, textInput, type Translate } from './persona-dom';

export function openDeleteAsk(api: DreyPluginApi, t: Translate, ask: PersonaDeleteAsk, onDeleted: () => void): void {
  const close = api.ui.showModal((host) => {
    const box = h('div', 'persona-delete');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', t('persona.delete.title', { name: ask.name }));
    const input = textInput('', (text) => ask.type(text), 'delete-confirm');
    input.autocomplete = 'off';
    input.spellcheck = false;
    const problem = h('div', 'persona-state-error persona-delete-error');
    problem.setAttribute('role', 'alert');
    const cancel = outlineButton(t('persona.delete.cancel'), 'persona-btn persona-btn-32', () => close());
    const confirm = outlineButton(t('persona.delete.confirm'), 'persona-btn persona-btn-32 persona-btn-danger', () => void run());
    const sync = (): void => {
      confirm.disabled = !ask.canDelete();
      input.disabled = ask.busy;
      cancel.disabled = ask.busy;
      problem.textContent = ask.refused;
      problem.hidden = ask.refused === '';
    };
    const run = async (): Promise<void> => {
      if (await ask.submit()) {
        close();
        onDeleted();
      }
    };
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !ask.busy) {
        event.preventDefault();
        close();
      } else if (event.key === 'Enter' && event.target === input && ask.canDelete()) {
        event.preventDefault();
        void run();
      }
    });
    const actions = h('div', 'persona-delete-actions');
    actions.append(cancel, confirm);
    box.append(h('h3', 'persona-delete-title', t('persona.delete.title', { name: ask.name })), h('p', 'persona-muted persona-delete-scope', t('persona.delete.scope')), labelled(t('persona.delete.field', { name: ask.name }), input), problem, actions);
    ask.subscribe(sync);
    sync();
    host.append(box);
    input.focus();
  });
}
