import { describe, expect, it } from 'vitest';
import type { StoreStageMigrationOffer } from '../shared/tickets';
import { storeMigrationModel } from './store-migration-bar';

const t = (key: string, params?: Record<string, unknown>): string => `${key}${params === undefined ? '' : ` ${JSON.stringify(params)}`}`;

const LOCAL: StoreStageMigrationOffer = {
  mode: 'local',
  legacy: ['shaping', 'building', 'ready'],
  moves: 2,
  configCommits: 2,
  toml: '[stages]',
  reason: null,
  waitFor: null,
};

describe('the stage migration line of the Tickets panel (req-265)', () => {
  it('a local store: the old stages named, Migrate enabled, nothing to copy', () => {
    const model = storeMigrationModel(t, LOCAL);
    expect(model.text).toBe('work.store_migration {"stages":"shaping, building, ready"}');
    expect(model.detail).toBe('work.store_migration.detail {"commits":2,"moves":2}');
    expect(model.migrate).toEqual({ enabled: true, title: model.detail });
    expect(model.copy).toBeNull();
  });

  it('a claimed ticket disables Migrate and says why', () => {
    const model = storeMigrationModel(t, { ...LOCAL, waitFor: 't-3 is claimed by agent-r-1@h' });
    expect(model.migrate).toEqual({ enabled: false, title: 't-3 is claimed by agent-r-1@h' });
  });

  it('a remote store: Copy stages; Migrate only once there are tickets it can move', () => {
    const manual = { ...LOCAL, mode: 'manual' as const, moves: 0, reason: 'a remote store' };
    expect(storeMigrationModel(t, manual).copy).toBe('[stages]');
    expect(storeMigrationModel(t, manual).migrate).toBeNull();
    expect(storeMigrationModel(t, manual).detail).toContain('a remote store');
    expect(storeMigrationModel(t, { ...manual, moves: 1 }).migrate?.enabled).toBe(true);
  });
});
