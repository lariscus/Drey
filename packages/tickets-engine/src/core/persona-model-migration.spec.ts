import { describe, expect, it } from 'vitest';
import { parsePersonaFile, type PersonaLegacyModels } from './persona';
import { MIGRATION_FALLBACK_CLASS, migratedModelOf, raisedToFloor, shippedClassRank, type MigrationClassTable } from './persona-model-migration';

const CLASSES: Readonly<Record<string, string>> = { 'claude-code/opus': 'heavy', 'claude-code/sonnet': 'standard', 'opencode/glm-5.3': 'standard', 'kimi/k2': 'light' };
const table: MigrationClassTable = {
  classOf: (provider, model) => CLASSES[`${provider ?? ''}/${model}`] ?? null,
  rank: shippedClassRank,
};
const legacy = (worker: string, def: string, pool: readonly string[], minClass: string | null = null): PersonaLegacyModels => ({ worker, models: { default: def, pool }, minClass });

describe('migratedModelOf — the one-time move onto Persona v3 (req-288)', () => {
  it('takes the class of the old default, on the v2 worker; a pool of several pins nothing', () => {
    expect(migratedModelOf(legacy('claude-code', 'opus', ['opus', 'sonnet']), table)).toEqual({ class: 'heavy', model: null, why: "class the default's class heavy" });
  });

  it('pins the old default only when the pool held that one model, on its harness', () => {
    expect(migratedModelOf(legacy('opencode', 'glm-5.3', ['glm-5.3']), table)).toMatchObject({ class: 'standard', model: 'opencode/glm-5.3' });
    expect(migratedModelOf(legacy('opencode', 'kimi/k2', ['kimi/k2']), table)).toMatchObject({ class: 'light', model: 'kimi/k2' });
  });

  it('folds the floor in — raised, never lowered', () => {
    expect(migratedModelOf(legacy('claude-code', 'sonnet', ['sonnet', 'opus'], 'heavy'), table)).toMatchObject({ class: 'heavy', why: "class the default's class standard, raised to the floor heavy" });
    expect(migratedModelOf(legacy('claude-code', 'opus', ['opus', 'sonnet'], 'light'), table)).toMatchObject({ class: 'heavy' });
  });

  it('a default the table does not hold takes the floor, else the fallback class', () => {
    expect(migratedModelOf(legacy('claude-code', 'unknown', ['unknown', 'opus'], 'standard'), table)).toMatchObject({ class: 'standard', model: null });
    expect(migratedModelOf(legacy('claude-code', 'unknown', ['unknown', 'opus']), table)).toMatchObject({ class: MIGRATION_FALLBACK_CLASS });
    expect(MIGRATION_FALLBACK_CLASS).toBe('heavy');
  });
});

describe('raisedToFloor — the board migration\'s moved min-class (req-268 × req-288)', () => {
  it('raises a lighter class, never lowers; a v2 record keeps the floor in its legacy keys', () => {
    const light = parsePersonaFile('ben', '---\ntitle: Ben\nclass: light\n---\n');
    expect(raisedToFloor(light, 'standard').class).toBe('standard');
    expect(raisedToFloor(raisedToFloor(light, 'heavy'), 'standard').class).toBe('heavy');
    const v2 = parsePersonaFile('ben', '---\ntitle: Ben\nworker: opencode\nmodels:\n  default: x\n  pool: [x]\n---\n');
    expect(raisedToFloor(v2, 'heavy').legacy?.minClass).toBe('heavy');
    expect(raisedToFloor(v2, null)).toBe(v2);
  });
});
