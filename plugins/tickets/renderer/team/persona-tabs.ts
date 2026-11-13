// i18n: catalog
/**
 * The tabs at the top of the Persona page's right column (board 7k v4,
 * req-295): Instructions · Memory · 1:1. Instructions is the editor with its
 * blocks; Memory and 1:1 are the Crew detail's panes, mounted into the
 * page. The choice lives in the page (it survives a repaint); this file
 * draws the strip and mounts a pane.
 */
import type { PersonaView } from '../../shared/remote-protocol';
import { h, type DeskDeps } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { mountMemoryPane } from './memory-pane';
import { mountOneOnOnePane } from './one-on-one-pane';

export const PERSONA_TABS = ['instructions', 'memory', 'talk'] as const;

export type PersonaTab = (typeof PERSONA_TABS)[number];

export interface TabStripParts {
  readonly active: PersonaTab;
  /** The count of memory entries; null = unknown. */
  readonly memory: number | null;
  readonly select: (tab: PersonaTab) => void;
  /** What sits at the right end of the row (the Instructions tab's token figure and Preview full prompt). */
  readonly trailing: readonly HTMLElement[];
}

export function tabStrip(ctx: BlockContext, parts: TabStripParts): HTMLElement {
  const { t } = ctx;
  const row = h('div', 'persona-tabrow');
  const tabs = h('div', 'persona-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('persona.tabs.label', { name: ctx.draft().title }));
  const label = (tab: PersonaTab): string =>
    tab === 'instructions' ? t('persona.page.instructions') : tab === 'memory' ? (parts.memory === null || parts.memory === 0 ? t('persona.tabs.memory') : t('persona.tabs.memory_count', { count: parts.memory })) : t('persona.tabs.talk');
  for (const tab of PERSONA_TABS) {
    const button = h('button', `persona-tab${tab === parts.active ? ' persona-tab-on' : ''}`, label(tab));
    button.type = 'button';
    button.dataset['tab'] = tab;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab === parts.active));
    button.addEventListener('click', () => parts.select(tab));
    tabs.append(button);
  }
  row.append(tabs, h('span', 'persona-grow'), ...parts.trailing);
  return row;
}

/** The Memory or 1:1 pane of the Crew detail, mounted in a column of its own. */
export function tabPane(deps: DeskDeps, persona: PersonaView, tab: Exclude<PersonaTab, 'instructions'>): HTMLElement {
  const pane = h('div', 'persona-pane');
  pane.dataset['pane'] = tab;
  if (tab === 'memory') {
    mountMemoryPane(deps, persona, pane);
  } else {
    mountOneOnOnePane(deps, persona, pane);
  }
  return pane;
}
