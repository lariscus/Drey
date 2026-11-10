// i18n: catalog
/**
 * The page's footer (R11): Delete persona… at the far side, opposite Discard
 * and Save. The page tells it what the buttons may do after every change.
 */
import { h } from '../desk-deps';
import { outlineButton, type Translate } from './persona-dom';

export interface FootActions {
  discard(): void;
  save(): void;
  remove(): void;
}

export interface PageFoot {
  readonly element: HTMLElement;
  /** `canSave`: the prompt could be read; `busy`: a Save is running. */
  sync(state: { readonly canSave: boolean; readonly busy: boolean }): void;
}

export function pageFoot(t: Translate, saveTitle: string, actions: FootActions): PageFoot {
  const remove = outlineButton(t('persona.delete.action'), 'persona-btn persona-btn-32 persona-btn-danger persona-delete-open', actions.remove);
  const discard = outlineButton(t('persona.page.discard'), 'persona-btn persona-btn-32', actions.discard);
  const save = outlineButton(t('persona.page.save'), 'persona-save', actions.save);
  save.title = saveTitle;
  const element = h('footer', 'persona-foot');
  element.append(remove, h('span', 'persona-grow'), discard, save);
  return {
    element,
    sync: ({ canSave, busy }) => {
      save.disabled = !canSave || busy;
      discard.disabled = busy;
      remove.disabled = busy;
    },
  };
}
