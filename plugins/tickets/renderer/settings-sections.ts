import type { PluginSettingsEntry, PluginSettingsSection } from '../../../shared/plugin-api/renderer';
import type { I18n } from '../../../shared/i18n/types';

/**
 * Settings -> Tickets as sections (E13-22, SDK 1.46): the entries listed
 * under the category in Settings, in page order. The page marks the first
 * element of each part `data-settings-section="<id>"`. The first four are
 * the headings board 7g shows (Crew, Flow, Autopilot, Budget and runners,
 * Walkthrough videos, Devices); the store and the pipeline are the
 * parts the board no longer shows but the page still has.
 */
export const TICKETS_SECTIONS: readonly PluginSettingsSection[] = [
  { id: 'crew', label: 'Crew' },
  { id: 'flow', label: 'Flow' },
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'budget', label: 'Budget and runners' },
  { id: 'videos', label: 'Walkthrough videos' },
  { id: 'devices', label: 'Devices' },
  { id: 'store', label: 'Store and Git' },
  { id: 'pipeline', label: 'Pipeline and prompts' },
];

/** The sections above, plus Models (board 7l, req-186): its words come from the catalog, so it joins through `ticketsSections` / `ticketsEntries`. */
export type TicketsSectionId = (typeof TICKETS_SECTIONS)[number]['id'] | 'models';

const e = (
  section: TicketsSectionId,
  key: string,
  label: string,
  description: string,
  scope: PluginSettingsEntry['scope'] = 'vault',
): PluginSettingsEntry => ({ key, label, description, section, scope });

/** What the Settings search finds on this page. */
export const TICKETS_ENTRIES: readonly PluginSettingsEntry[] = [
  e('crew', 'team', 'Crew', 'Personas, default crew'),
  e('crew', 'humanName', 'Your name', 'The human persona'),
  e('flow', 'flow', 'Default flow', 'Standard flow, flow editor'),
  e('autopilot', 'autopilot', 'Autopilot', 'On, paused or off: whether the chain starts new runs'),
  e('autopilot', 'autopilot.resumeAt', 'Resume paused autopilot at', 'The time a paused autopilot starts again'),
  e('budget', 'budget', 'Daily budget', 'Pause new runs when it is spent'),
  e('budget', 'runners', 'Runners', 'Slots and the sessions they serve'),
  e('videos', 'videos.inGit', 'Walkthrough videos', 'Keep in Git'),
  e('videos', 'videos.maxMb', 'Largest video', 'Size limit per video'),
  e('budget', 'defaultWorker', 'Default worker', 'OpenCode, Claude Code, Kimi Code'),
  e('budget', 'fleet.resumePauseTtlMin', 'Resume pause TTL', 'Warm resume window in minutes'),
  e('budget', 'fleet.contextCapTokens', 'Context cap', 'Tokens before a worker compacts'),
  e('budget', 'gitPath', 'Git executable', 'Only needed when git is not on PATH', 'device'),
  e('devices', 'remote', 'Serve the phone and iPad app', 'Serve the phone and iPad app, port, Tailscale', 'all-devices'),
  e('devices', 'pairing', 'Pair a device', 'Pairing code and QR, revoke devices', 'all-devices'),
  e('store', 'repository', 'Tickets repository', 'Path of the tickets folder'),
  e('store', 'dk.checkout', 'Ticket store checkout', 'Working copy of the ticket branch', 'device'),
  e('store', 'dk.syncSeconds', 'Sync interval', 'Seconds, remote stores only', 'device'),
  e('store', 'repositories', 'Repositories', 'Launch command, default branch, found repositories'),
  e('pipeline', 'pipeline', 'Pipeline', 'Columns, handover mode, worker per column'),
  e('pipeline', 'prompts', 'Prompts', 'Prompt files of the agent columns'),
];

/** The page's sections in order: Models sits after Autopilot, as board 7l's nav has it. */
export function ticketsSections(i18n: I18n): readonly PluginSettingsSection[] {
  const models: PluginSettingsSection = { id: 'models', label: i18n.t('tickets.settings.models.nav') };
  const at = TICKETS_SECTIONS.findIndex((section) => section.id === 'autopilot');
  return [...TICKETS_SECTIONS.slice(0, at + 1), models, ...TICKETS_SECTIONS.slice(at + 1)];
}

/** What the Settings search finds: the entries above and the Models page's. */
export function ticketsEntries(i18n: I18n): readonly PluginSettingsEntry[] {
  return [
    ...TICKETS_ENTRIES,
    e('models', 'models.table', i18n.t('tickets.settings.models.entry.table'), i18n.t('tickets.settings.models.entry.table_desc'), 'device'),
    e('models', 'models.cap', i18n.t('tickets.settings.models.cap.global'), i18n.t('tickets.settings.models.entry.cap_desc'), 'device'),
    e('models', 'models.slots', i18n.t('tickets.settings.models.group.slots'), i18n.t('tickets.settings.models.entry.slots_desc'), 'device'),
    e('models', 'models.ledgers', i18n.t('tickets.settings.models.group.ledgers'), i18n.t('tickets.settings.models.entry.ledgers_desc'), 'device'),
  ];
}
