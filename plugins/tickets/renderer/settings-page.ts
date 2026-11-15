import type { DreyPluginApi, PluginSettingsPageContrib } from '../../../shared/plugin-api/renderer';
import type { ChainStatus } from '../../../packages/tickets-engine/src/fleet/protocol';
import type { BoardSnapshot, ReposListing } from '../shared/tickets';
import { parseWorkerValue } from '../../../packages/tickets-engine/src/fleet/assignment';
import { el, iconButton, kv, mutate, numberConfig, selectConfig, textConfig } from './settings-dom';
import { createRemoteSection } from './settings-remote';
import { createReposSection } from './settings-repos';
import { createDeskSettings, type DeskSettingsHooks } from './settings/desk-settings';
import { ticketsEntries, ticketsSections, type TicketsSectionId } from './settings-sections';
import { createModelsSection } from './settings/models-section';
import { createSkillsLibrarySection } from './settings/skills-library-section';
import { createWorkersSection } from './settings-workers';
import { CrewSettings } from './settings-crew';

/** Marks the first element of a part of the page (`data-settings-section`). */
function anchored<T extends HTMLElement>(element: T, id: TicketsSectionId): T {
  element.dataset['settingsSection'] = id;
  return element;
}

/**
 * Settings — Tickets (M85, req-46, reworked in req-50): the tickets
 * repository's path, then the fleet's own settings — the shared ones,
 * then each CLI runner's behind a switch (settings-workers.ts, req-71).
 * Everything shown is read from the board on every refresh, and the page
 * follows the board's change events, so it never shows a copy that
 * drifted from disk.
 */
export function createTicketsSettingsPage(api: DreyPluginApi, hooks: Pick<DeskSettingsHooks, 'openTeam' | 'openFlow' | 'openAutopilot'>): PluginSettingsPageContrib {
  return {
    id: 'tickets',
    label: 'Tickets',
    hint: 'Crew, flow, budget, devices',
    sections: ticketsSections(api.i18n),
    entries: ticketsEntries(api.i18n),
    mount: (body) => {
      body.classList.add('tset');

      const repo = el('div', 'tset-repo');
      const repoPath = el('span', 'tset-repo-path');
      const openRepo = iconButton(api, 'folder', 'Open the tickets folder');
      openRepo.addEventListener('click', () => void mutate(api, 'openFolder'));
      repo.append(el('span', 'tset-muted', 'Tickets repository'), repoPath, openRepo);

      let disposed = false;
      // req-173: the vault layer (tickets/_meta/crew.md) behind the default worker, the permissions and the thresholds.
      const crew = new CrewSettings(api);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const load = async (): Promise<void> => {
        const [snap, reposListing, configured] = await Promise.all([
          api.backend.invoke('board') as Promise<BoardSnapshot>,
          api.backend.invoke('reposListing') as Promise<ReposListing>,
          crew.resolved('defaultWorker').then((value) => (typeof value === 'string' ? value : undefined)),
        ]);
        if (disposed) {
          return;
        }
        repoPath.textContent = snap.vaultPath ?? 'No tickets vault detected';
        openRepo.disabled = snap.vaultPath === undefined;
        desk.update(snap);
        void models.refresh();
        void skillsLibrary.refresh();
        repos.update(reposListing);
        if (!workersOpened) {
          workersOpened = true;
          workers.select(parseWorkerValue((configured ?? '') || 'opencode')?.provider ?? 'opencode');
        }
      };
      const reload = (): Promise<void> => load().catch(() => undefined);

      const repos = createReposSection(api, reload);
      // Opens on the default worker's runner once the first load knows it.
      const workers = createWorkersSection(api, 'opencode', crew);
      let workersOpened = false;
      const remote = createRemoteSection(api);
      const models = createModelsSection(api);
      // req-289: Settings → Skills library sits after Models, as board 7o's nav has it.
      const skillsLibrary = createSkillsLibrarySection(api);
      const afterAutopilot = el('div', 'tset-after-autopilot');
      afterAutopilot.append(models.root, skillsLibrary.root);
      const desk = createDeskSettings(api, {
        ...hooks,
        afterAutopilot,
        manageRunners: () => {
          workers.root.scrollIntoView({ block: 'start', behavior: 'smooth' });
        },
      });
      // One scrolling page; the sections of TICKETS_SECTIONS in this order.
      anchored(repo, 'store');
      anchored(remote.root, 'devices');
      body.append(
        desk.root,
        fleetSection(api, crew),
        workers.root,
        desk.videos,
        remote.root,
        repo,
        storeSection(api),
        repos.root,
      );

      // The board's change events cover every write here and the runner's.
      const off = api.backend.on('board-changed', () => {
        if (timer !== null) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          timer = null;
          void reload();
        }, 250);
      });
      // The Autopilot row follows the fleet: the popover's switch and the runner's own exit (D-51).
      const offFleet = api.backend.on('fleet-changed', (payload) => {
        desk.repaintAutopilot();
        models.update(((payload ?? {}) as { chain?: ChainStatus | null }).chain ?? null);
      });
      void reload();
      return () => {
        disposed = true;
        off();
        offFleet();
        if (timer !== null) {
          clearTimeout(timer);
        }
        remote.dispose();
        models.dispose();
        skillsLibrary.dispose();
      };
    },
  };
}

// --- the fleet's own settings (plugin config; applied on restart) ----------

function fleetSection(api: DreyPluginApi, crew: CrewSettings): HTMLElement {
  const section = el('section', 'tset-section');
  section.setAttribute('aria-labelledby', 'tset-fleet-head');
  const head = el('div', 'tset-section-head');
  const title = el('h3', undefined, 'Fleet');
  title.id = 'tset-fleet-head';
  // req-173 (R13): the section's keys live in the vault (tickets/_meta/crew.md) and apply on the next board round.
  head.append(title);
  const rows = el('div', 'tset-kv');
  rows.append(
    ...kv(
      'tset-default-worker',
      'Default worker',
      crew.select('defaultWorker', [
        ['opencode', 'OpenCode'],
        ['claude-code', 'Claude Code'],
        ['kimi', 'Kimi Code'],
        ['copilot', 'Copilot CLI'],
      ]),
      'For a run no ticket, column or repository assigns a worker to.',
    ),
  );
  // Rarely worth touching: folded away, every empty field showing its default.
  const advanced = el('details', 'tset-advanced');
  advanced.append(el('summary', undefined, 'Advanced'));
  const advancedRows = el('div', 'tset-kv');
  advancedRows.append(
    ...kv('tset-git', 'Git executable', textConfig(api, 'gitPath'), 'Only needed when git is not on PATH.'),
    ...kv(
      'tset-handover-ttl',
      'Resume pause TTL — minutes',
      crew.number('handover.resumePauseTtlMin'),
      'A pause within this window counts as warm: the previous session resumes and re-pays its transcript as cache reads.',
    ),
    ...kv(
      'tset-context-cap',
      'Context cap — tokens',
      crew.number('handover.contextCapTokens'),
      'OpenCode compacts a running worker\'s context once it reaches this size instead of the model\'s full window. 0 = the model\'s own window.',
    ),
  );
  advanced.append(advancedRows);
  section.append(head, rows, advanced);
  return section;
}

// --- the dricket ticket store (E14-4c; plugin config, read live by the engine) --

function storeSection(api: DreyPluginApi): HTMLElement {
  const section = el('section', 'tset-section');
  section.setAttribute('aria-labelledby', 'tset-store-head');
  const head = el('div', 'tset-section-head');
  const title = el('h3', undefined, 'Ticket store');
  title.id = 'tset-store-head';
  head.append(title);
  const sync = numberConfig(api, 'dk.syncSeconds');
  sync.placeholder = '30';
  const rows = el('div', 'tset-kv');
  rows.append(
    ...kv('tset-dk-checkout', 'Checkout', textConfig(api, 'dk.checkout'), 'Working copy of the store\'s ticket branch. Empty: the store folder itself. Not in OneDrive.'),
    ...kv('tset-dk-sync', 'Sync interval — seconds', sync, '0 turns it off. Remote stores only.'),
  );
  section.append(head, rows);
  return section;
}
