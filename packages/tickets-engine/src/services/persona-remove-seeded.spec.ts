import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seededCrewOf } from '../core/crew-seed-marker';
import { DEFAULT_CREW_IDS } from '../core/default-crew';
import { parsePersonaFile } from '../core/persona';
import { CrewSeederRig } from './crew-seeder-rig.fake';
import { PersonaRemoveService } from './persona-remove-service';

/** req-261 and req-256 together: a seeded persona the owner deletes stays deleted, at every later start. */

const DIR = 'tickets/_meta/personas';
const CREW = 'tickets/_meta/crew.md';
let rig: CrewSeederRig;

function removal(): PersonaRemoveService {
  return new PersonaRemoveService({
    board: {
      detect: async () => rig.vault,
      loadPersona: async (_vault, id) => {
        const text = await rig.read(`${DIR}/${id}/persona.md`);
        return text === null ? null : parsePersonaFile(id, text);
      },
    },
    fleet: { runs: async () => [] },
    host: { announceChanges: vi.fn(), log: vi.fn() },
    git: { locate: async () => null, commitTree: async () => undefined },
    fsFor: () => ({
      readText: (rel) => rig.read(rel),
      list: async () => [],
      files: async (rel) => ((await rig.exists(`${rel}/persona.md`)) ? ['persona.md', 'prompt.md'] : []),
      writeFile: (rel, data) => rig.write(rel, String(data)),
      remove: (rel) => rig.removeFolder(rel),
    }),
  });
}

describe('a removed seeded persona', () => {
  beforeEach(async () => {
    rig = await CrewSeederRig.create();
    expect(await rig.seeder.seed(rig.vault)).toEqual({ kind: 'seeded', ids: [...DEFAULT_CREW_IDS] });
  });

  afterEach(async () => {
    await rig.dispose();
  });

  it('is not brought back by the next seeding: the marker written when Paul was first offered still lists him', async () => {
    expect(seededCrewOf((await rig.read(CREW))!)).toContain('paul');
    expect(await removal().personaRemove({ persona: 'paul', confirm: 'Paul' })).toMatchObject({ ok: true, persona: 'paul' });
    expect(await rig.exists(`${DIR}/paul/persona.md`)).toBe(false);
    rig.commits.length = 0;
    expect(await rig.seeder.seed(rig.vault)).toEqual({ kind: 'nothing' });
    expect(await rig.exists(`${DIR}/paul/persona.md`)).toBe(false);
    expect(await rig.exists(`${DIR}/ben/persona.md`)).toBe(true);
    expect(rig.commits).toEqual([]);
  });
});

