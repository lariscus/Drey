import { describe, expect, it } from 'vitest';
import type { PipelinePhase } from '../../../../packages/tickets-engine/src/contracts/tickets';
import type { PersonaView } from '../../shared/remote-protocol';
import { autopilotStateOf, budgetLineOf, maxMbOf, parseDeskVideos, defaultFlowLine, usd } from './desk-model';

const persona = (id: string, extra: Partial<PersonaView> = {}): PersonaView => ({
  id,
  title: id.charAt(0).toUpperCase() + id.slice(1),
  role: 'builds',
  class: 'heavy',
  model: '',
  color: '#abc',
  budget: null,
  ...extra,
});

describe('desk settings model', () => {
  it('strings the flow of pipeline.md into one line of persona titles, the interactive entry marked', () => {
    const entry = (id: string, mode: 'shape' | null = null) => ({ persona: id, mode, notify: false });
    expect(defaultFlowLine([entry('paul', 'shape'), entry('ben'), entry('zed')], [persona('paul'), persona('ben')])).toBe('Paul (shape) → Ben → zed');
    expect(defaultFlowLine([], [persona('paul')])).toBe('No default flow');
    expect(defaultFlowLine(undefined, [])).toBe('No default flow');
  });

  it('adds the daily budgets up, leaves the owner out, and says when there are none', () => {
    expect(budgetLineOf([persona('a')])).toBe('No persona has a daily budget');
    expect(
      budgetLineOf([persona('a', { budget: 10, dailyCost: 4.1 }), persona('b', { budget: 5 }), persona('you', { kind: 'human', budget: 99 })]),
    ).toBe('$15 across 2 personas · $4.10 spent today');
    expect(budgetLineOf([persona('a', { budget: 2.5 })])).toBe('$2.50 across 1 persona · $0 spent today');
    expect(usd(7)).toBe('$7');
  });


  it('reads the engine settings answer tolerantly', () => {
    expect(parseDeskVideos({ ok: true, devices: [], engine: { videos: { inGit: true, maxMb: 25, existing: 3, notice: 'x' } } })).toEqual({
      inGit: true,
      maxMb: 25,
      existing: 3,
      notice: 'x',
    });
    expect(parseDeskVideos({ ok: false })).toBeNull();
    expect(parseDeskVideos({ ok: true, engine: {} })).toBeNull();
    expect(parseDeskVideos(null)).toBeNull();
  });

  it('parses the largest-video field as whole megabytes', () => {
    expect(maxMbOf(' 25 ')).toBe(25);
    expect(maxMbOf('')).toBeNull();
    expect(maxMbOf('2.5')).toBeNull();
    expect(maxMbOf('-3')).toBeNull();
  });
});

describe('autopilotStateOf', () => {
  it('reads the chain master: run is On, anything else Off', () => {
    expect(autopilotStateOf('run')).toBe('on');
    expect(autopilotStateOf('halted')).toBe('off');
    expect(autopilotStateOf(null)).toBe('off');
  });
});
