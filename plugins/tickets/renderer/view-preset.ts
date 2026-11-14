import type { DreyPluginApi, ViewPresetContrib } from '../../../shared/plugin-api/renderer';
import { MISSION_CONTROL_TARGET } from './conversation/targets';

/**
 * The Work and Crew views (ADR-0089): the tickets plugin's layouts next to
 * Notes. What each opens with on its first showing and after `View → Reset
 * layout` is the owner's default-layout boards (req-297, ADR-0089 later
 * change): 7q `DeskViewWorkMC` -- the Board, Mission Control open in the
 * right dock, the Tickets panel in the folded left dock -- and 7r
 * `DeskViewCrew` -- the Crew tab with both side docks folded. No view has a
 * bottom band (the Capacity band is the Board's pool chip, req-271).
 */
export const WORK_VIEW_ID = 'tickets.work';

export const WORK_VIEW_LABEL = 'Work';

/**
 * The dock panel ids the presets arrange (`tickets` is this plugin's,
 * `assistant`, `outline` and `backlinks` other plugins'). The right dock
 * holds the Assistant alone, as 7q draws its strip; Outline and Backlinks
 * -- about the open note, right in Notes -- wait as icons in the left dock
 * beside Tickets.
 */
export const WORK_PANELS = {
  left: ['tickets', 'outline', 'backlinks'],
  right: ['assistant'],
  open: ['tickets', 'assistant'],
} as const;

/** The Crew view (boards 9a, 7h: Notes · Work · Crew). */
export const CREW_VIEW_ID = 'tickets.crew';

export const CREW_VIEW_LABEL = 'Crew';

/** The Board and Crew tabs (E13-8): doc kind + the one key each has. */
export const BOARD_KIND = 'tickets-board';
export const BOARD_KEY = 'board://all';
export const TEAM_KIND = 'tickets-team';
export const TEAM_KEY = 'team://all';

/** Board 7r: the Crew tab alone at full width, both side docks folded, the Assistant on Mission Control. */
export function createCrewPreset(): ViewPresetContrib {
  return {
    id: CREW_VIEW_ID,
    label: CREW_VIEW_LABEL,
    assistantTarget: MISSION_CONTROL_TARGET,
    layout: {
      left: [...WORK_PANELS.left],
      right: [...WORK_PANELS.right],
      bottom: [],
      open: [...WORK_PANELS.open],
      folded: ['left', 'right'],
      // The Crew view owns its tab -- it comes back on every visit (SDK 1.50).
      openTabs: [{ kind: TEAM_KIND, path: TEAM_KEY }],
    },
  };
}

/** Board 7q: the Board, Mission Control open on the right, Tickets in the folded left dock. */
export function createWorkPreset(): ViewPresetContrib {
  return {
    id: WORK_VIEW_ID,
    label: WORK_VIEW_LABEL,
    assistantTarget: MISSION_CONTROL_TARGET,
    layout: {
      left: [...WORK_PANELS.left],
      right: [...WORK_PANELS.right],
      bottom: [],
      open: [...WORK_PANELS.open],
      folded: ['left'],
      openTabs: [{ kind: BOARD_KIND, path: BOARD_KEY }],
    },
  };
}

/**
 * Registers the presets; the returned function undoes them. Opening a
 * ticket never switches the view (D-6): the document opens in the current
 * view's own layout, so a user's saved views stay theirs. There is no home
 * rule for ticket files and the Work view is reached on purpose (the
 * switcher, Ctrl+N, "Go to the Work view").
 */
export function registerWorkView(api: DreyPluginApi): () => void {
  const work = api.ui.registerViewPreset(createWorkPreset());
  const crew = api.ui.registerViewPreset(createCrewPreset());
  return () => {
    work();
    crew();
  };
}
