import type { PluginSettingsEntry, PluginSettingsSection } from '../../../../../shared/plugin-api/renderer';
import type { I18n } from '../../../../../shared/i18n/types';

/**
 * Settings -> Tickets as sections (E13-22, SDK 1.46): the entries listed
 * under the category in Settings, in page order. The page marks the first
 * element of each part `data-settings-section="<id>"`. The headings are
 * board 7g's (Crew, Flow, Autopilot, Budget and runners, Walkthrough
 * videos, Devices); the store part closes the page.
 */
export const TICKETS_SECTIONS: readonly PluginSettingsSection[] = [
  { id: 'crew', label: 'Crew' },
  { id: 'flow', label: 'Flow' },
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'budget', label: 'Budget and runners' },
  { id: 'videos', label: 'Walkthrough videos' },
  { id: 'devices', label: 'Devices' },
  { id: 'store', label: 'Store and Git' },
];

/** The sections above, plus Models (board 7l, req-186): its words come from the catalog, so it joins through `ticketsSections` / `ticketsEntries`. */
export type TicketsSectionId = (typeof TICKETS_SECTIONS)[number]['id'] | 'models' | 'skills';

const e = (section: TicketsSectionId, key: string, label: string, description: string): PluginSettingsEntry => ({
  key,
  label,
  description,
  section,
});

/** What the Settings search finds on this page. */
export const TICKETS_ENTRIES: readonly PluginSettingsEntry[] = [
  e('crew', 'team', 'Crew', 'Personas, default crew'),
  e('crew', 'humanName', 'Your name', 'The human persona'),
  e('flow', 'flow', 'Default flow', 'Standard flow, flow editor'),
  e('flow', 'flow.propose', 'Propose a flow for every new plan', 'The plan persona writes a flow into each new plan'),
  e('autopilot', 'autopilot', 'Autopilot', 'On, paused or off: whether the chain starts new runs'),
  e('autopilot', 'autopilot.resumeAt', 'Resume paused autopilot at', 'The time a paused autopilot starts again'),
  e('budget', 'budget', 'Daily budget', 'Pause new runs when it is spent'),
  e('budget', 'runners', 'Runners', 'Slots and the sessions they serve'),
  e('videos', 'videos.inGit', 'Walkthrough videos', 'Keep in Git'),
  e('videos', 'videos.maxMb', 'Largest video', 'Size limit per video'),
  e('budget', 'defaultWorker', 'Default worker', 'OpenCode, Claude Code, Kimi Code'),
  e('budget', 'fleet.resumePauseTtlMin', 'Resume pause TTL', 'Warm resume window in minutes'),
  e('budget', 'fleet.contextCapTokens', 'Context cap', 'Tokens before a worker compacts'),
  e('budget', 'gitPath', 'Git executable', 'Only needed when git is not on PATH'),
  e('devices', 'remote', 'Serve the phone and iPad app', 'Serve the phone and iPad app, port, Tailscale'),
  e('devices', 'pairing', 'Pair a device', 'Pairing code and QR, revoke devices'),
  e('store', 'repository', 'Tickets repository', 'Path of the tickets folder'),
  e('store', 'dk.store', 'Ticket store', 'Folder of the dricket store, or remote#branch'),
  e('store', 'dk.path', 'dk executable', 'Only needed when dk is not on PATH'),
  e('store', 'dk.checkout', 'Ticket store checkout', 'Working copy of the ticket branch'),
  e('store', 'dk.syncSeconds', 'Sync interval', 'Seconds, remote stores only'),
  e('store', 'repositories', 'Repositories', 'Launch command, default branch, found repositories'),
];

/** The page's sections in order: Models sits after Autopilot, as board 7l's nav has it, and the Skills library after Models (board 7o). */
export function ticketsSections(i18n: I18n): readonly PluginSettingsSection[] {
  const models: PluginSettingsSection = { id: 'models', label: i18n.t('tickets.settings.models.nav') };
  const skills: PluginSettingsSection = { id: 'skills', label: i18n.t('tickets.settings.skills.nav') };
  const at = TICKETS_SECTIONS.findIndex((section) => section.id === 'autopilot');
  return [...TICKETS_SECTIONS.slice(0, at + 1), models, skills, ...TICKETS_SECTIONS.slice(at + 1)];
}

/** What the Settings search finds: the entries above and the Models page's. */
export function ticketsEntries(i18n: I18n): readonly PluginSettingsEntry[] {
  return [
    ...TICKETS_ENTRIES,
    e('models', 'models.classes', i18n.t('tickets.settings.models.classes.title'), i18n.t('tickets.settings.models.entry.table_desc')),
    e('models', 'models.cap', i18n.t('tickets.settings.models.cap.global'), i18n.t('tickets.settings.models.entry.cap_desc')),
    e('models', 'models.accounts', i18n.t('tickets.settings.models.accounts.title'), i18n.t('tickets.settings.models.entry.slots_desc')),
    e('models', 'models.routing', i18n.t('tickets.settings.models.routing.title'), i18n.t('tickets.settings.models.entry.ledgers_desc')),
    e('skills', 'skills.sources', i18n.t('tickets.settings.skills.sources'), i18n.t('tickets.settings.skills.entry.sources_desc')),
    e('skills', 'skills.list', i18n.t('tickets.settings.skills.skills'), i18n.t('tickets.settings.skills.entry.skills_desc')),
  ];
}
