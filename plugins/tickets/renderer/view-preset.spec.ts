import { describe, expect, it, vi } from 'vitest';
import type { DreyPluginApi, PluginDocKindContrib } from '../../../shared/plugin-api/renderer';
import { registerFlowKind } from './flow/register';
import { MISSION_CONTROL_TARGET } from './conversation/targets';
import { BOARD_KEY, BOARD_KIND, CREW_VIEW_ID, TEAM_KEY, TEAM_KIND, WORK_VIEW_ID, createCrewPreset, createWorkPreset, registerWorkView } from './view-preset';
import type { DeskDeps } from './desk-deps';

describe('the Work preset (board 7q DeskViewWorkMC, req-297)', () => {
  it('opens the Board, Mission Control open in the right dock, Tickets in the folded left dock, nothing below', () => {
    const preset = createWorkPreset();
    expect(preset.id).toBe(WORK_VIEW_ID);
    expect(preset.label).toBe('Work');
    expect(preset.assistantTarget).toBe(MISSION_CONTROL_TARGET);
    expect(preset.layout).toEqual({
      left: ['tickets', 'outline', 'backlinks'],
      right: ['assistant'],
      bottom: [],
      open: ['tickets', 'assistant'],
      folded: ['left'],
      openTabs: [{ kind: BOARD_KIND, path: BOARD_KEY }],
    });
  });
});

describe('the Crew preset (board 7r DeskViewCrew, req-297)', () => {
  it('opens the Crew tab with both side docks folded, the Assistant on Mission Control, nothing below', () => {
    const preset = createCrewPreset();
    expect(preset.id).toBe(CREW_VIEW_ID);
    expect(preset.label).toBe('Crew');
    expect(preset.assistantTarget).toBe(MISSION_CONTROL_TARGET);
    expect(preset.layout).toEqual({
      left: ['tickets', 'outline', 'backlinks'],
      right: ['assistant'],
      bottom: [],
      open: ['tickets', 'assistant'],
      folded: ['left', 'right'],
      openTabs: [{ kind: TEAM_KIND, path: TEAM_KEY }],
    });
  });
});

describe('selecting a ticket never changes the active view (D-6)', () => {
  it('registerWorkView registers the preset only -- no home rule that pulls ticket files into Work', () => {
    const offPreset = vi.fn();
    const registerHomeViewRule = vi.fn(() => vi.fn());
    const api = {
      ui: { registerViewPreset: vi.fn(() => offPreset) },
      documents: { registerHomeViewRule },
    } as unknown as DreyPluginApi;
    const off = registerWorkView(api);
    expect(api.ui.registerViewPreset).toHaveBeenCalledTimes(2); // Work and Crew
    expect(registerHomeViewRule).not.toHaveBeenCalled();
    off();
    expect(offPreset).toHaveBeenCalledTimes(2);
  });

  it('the Flow tab (opened from a selected ticket) names no home view', () => {
    let kind: PluginDocKindContrib | null = null;
    const api = {
      ui: {
        registerDocKind: vi.fn((k: PluginDocKindContrib) => {
          kind = k;
          return () => undefined;
        }),
      },
    } as unknown as DreyPluginApi;
    registerFlowKind(api, {} as DeskDeps);
    expect(kind).not.toBeNull();
    expect((kind as unknown as PluginDocKindContrib).homeView).toBeUndefined();
  });
});
