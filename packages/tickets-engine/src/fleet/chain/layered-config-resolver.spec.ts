import { describe, expect, it } from 'vitest';
import { parseCrewFile } from '../../core/persona/crew-file';
import { DEFAULT_FLEET_CAPS } from '../protocol';
import { BUILT_IN_WORKER, CREW_DEFAULTS, LayeredConfigResolver } from './layered-config-resolver';

const resolver = new LayeredConfigResolver();

describe('LayeredConfigResolver (req-173, R13)', () => {
  it('without a vault file every key is its built-in default', () => {
    const crew = resolver.crew(null);
    expect(crew.defaultWorker).toBe(BUILT_IN_WORKER);
    expect(crew.permissionMode).toBe('accept-edits');
    expect(crew.defaultPersona).toBeNull();
    expect(crew.caps).toEqual(DEFAULT_FLEET_CAPS);
    expect(Object.values(crew.sources).every((s) => s === 'default')).toBe(true);
    expect(crew.values).toEqual(CREW_DEFAULTS);
  });

  it('the vault wins over the default, key by key, and says so', () => {
    const vault = parseCrewFile('---\ndefault-worker: kimi\npermission-mode: bypass\ncaps:\n  diff-stat-lines: 9\ntranche:\n  runs: off\nhandover:\n  context-cap-tokens-by:\n    opencode: 1000\n---\n').config;
    const crew = resolver.crew(vault);
    expect(crew.defaultWorker).toBe('kimi');
    expect(crew.permissionMode).toBe('bypass');
    expect(crew.caps).toEqual({ ...DEFAULT_FLEET_CAPS, diffStatLines: 9 });
    expect(crew.handover.contextCapTokensOverrides).toEqual({ opencode: 1000 });
    expect(crew.sources.defaultWorker).toBe('vault');
    expect(crew.sources['caps.gateFailureLines']).toBe('default');
  });

  it('the session record wins over the vault; the persona model sits between', () => {
    const crew = resolver.crew(parseCrewFile('---\npermission-mode: bypass\n---\n').config);
    expect(resolver.session(crew, 'sonnet', {})).toEqual({ permissionMode: 'bypass', model: 'sonnet', poolClass: null });
    expect(resolver.session(crew, 'sonnet', { permissionMode: 'read-only', model: 'opus', poolClass: 'A' })).toEqual({ permissionMode: 'read-only', model: 'opus', poolClass: 'A' });
    expect(resolver.session(crew, 'sonnet', { model: null }).model).toBeNull();
  });
});
