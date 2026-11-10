// i18n: catalog
/**
 * Delete persona… (req-261): what the page's footer button starts. The ask
 * names the saved title (the engine compares against that one, not a draft),
 * sends the removal over `personaRemove` and, when the persona is gone, drops
 * the page's unsaved draft, has the Crew list read again and tells the page.
 */
import { openDeleteAsk } from './persona-delete-ask';
import { PersonaDeleteAsk } from './persona-delete-state';
import type { ActionEnv } from './persona-page-actions';
import { drafts } from './persona-page-state';

export function askPersonaDelete(env: ActionEnv, removed: () => void): void {
  const title = env.session.loaded?.view.title;
  if (title === undefined) {
    return;
  }
  const ask = new PersonaDeleteAsk({ i18n: env.deps.api.i18n, name: title, remove: (confirm) => env.deps.invoke('personaRemove', { persona: env.id, confirm }) });
  openDeleteAsk(env.deps.api, env.t, ask, () => {
    drafts.delete(env.id);
    void env.store.refresh();
    removed();
  });
}
