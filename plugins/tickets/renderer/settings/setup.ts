import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { el, mutate, textButton } from './dom.ts/settings-dom';

/**
 * The settings page's setup block (D-74): what Settings → Tickets shows
 * while no tickets repository is configured. Two entries into the same
 * OS folder dialog (an empty folder becomes a git repository there, an
 * existing repository is taken as it is); the main process does the rest
 * — register, start the service, initialize the board (`setup/
 * tickets-setup.ts`). One `board-changed` after the setup the page shows
 * its full self, so the block just calls the reload.
 */
export interface TicketsSetup {
  readonly root: HTMLElement;
}

export function createTicketsSetup(api: DreyPluginApi, onConfigured: () => void): TicketsSetup {
  const section = el('section', 'tset-section tset-setup');
  section.setAttribute('aria-labelledby', 'tset-setup-head');
  const head = el('div', 'tset-section-head');
  const title = el('h3', undefined, 'Tickets repository');
  title.id = 'tset-setup-head';
  head.append(title);
  const line = el(
    'p',
    'tset-setup-line',
    'No tickets repository is configured. Pick a folder — Drey creates the board and the ticket store in it.',
  );
  const create = textButton('Create a tickets repository…', 'primary');
  const existing = textButton('Use an existing folder…');
  const actions = el('div', 'tset-setup-actions');
  actions.append(create, existing);
  const error = el('p', 'tset-setup-error');
  section.append(head, line, actions, error);

  const CREATE_LABEL = 'Create a tickets repository…';
  let busy = false;
  const run = async (dialogTitle: string): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    error.textContent = '';
    create.disabled = true;
    existing.disabled = true;
    create.textContent = 'Setting up…';
    try {
      const picked = await mutate(api, 'pickFolder', { title: dialogTitle });
      const folder = (picked as { path?: unknown }).path;
      if (typeof folder !== 'string') {
        return; // the dialog was cancelled
      }
      const reply = await mutate(api, 'setupTicketsVault', { folder });
      if (reply.ok) {
        onConfigured();
        return;
      }
      error.textContent = reply.error ?? 'The setup failed.';
    } finally {
      busy = false;
      create.textContent = CREATE_LABEL;
      create.disabled = false;
      existing.disabled = false;
    }
  };
  create.addEventListener('click', () => void run('New tickets repository — pick or create its folder'));
  existing.addEventListener('click', () => void run('Tickets repository — pick its folder'));
  return { root: section };
}
