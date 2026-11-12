import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crewOrderOf } from '../core/crew-order';
import { seededCrewOf } from '../core/crew-seed-marker';
import { DEFAULT_CREW_IDS } from '../core/default-crew';
import { parsePersonaFile } from '../core/persona';
import { CREW_SEED_COMMIT } from './crew-seeder';
import { CrewSeederRig, modelRow } from './crew-seeder-rig.fake';

const DIR = 'tickets/_meta/personas';
const CREW = 'tickets/_meta/crew.md';
const TABLE = [modelRow('opus-x', 'claude-code', 'A'), modelRow('glm-big', 'opencode', 'A'), modelRow('glm-small', 'opencode', 'C'), modelRow('glm-mid', 'opencode', 'B')];

describe('CrewSeeder — the default crew Pia, Paul, Ben, Ralf, Tessa (req-256, req-269)', () => {
  let rig: CrewSeederRig;

  afterEach(async () => {
    await rig.dispose();
  });

  describe('on a fresh board', () => {
    beforeEach(async () => {
      rig = await CrewSeederRig.create({ rows: TABLE });
    });

    it('writes all five personas, marks them in crew.md and commits once', async () => {
      expect(await rig.seeder.seed(rig.vault)).toEqual({ kind: 'seeded', ids: [...DEFAULT_CREW_IDS] });
      for (const id of DEFAULT_CREW_IDS) {
        const persona = parsePersonaFile(id, (await rig.read(`${DIR}/${id}/persona.md`))!);
        expect(persona.kind).toBe(id === 'pia' ? 'mission' : 'agent');
        expect(persona.summary).not.toBe('');
        expect((await rig.read(`${DIR}/${id}/prompt.md`))!).toContain(`## Who ${persona.title} is`);
      }
      expect(seededCrewOf(await rig.read(CREW))).toEqual([...DEFAULT_CREW_IDS]);
      expect(rig.commits).toHaveLength(1);
      expect(rig.commits[0]!.message).toBe(CREW_SEED_COMMIT);
      expect(rig.commits[0]!.paths).toContain(CREW);
      expect(rig.commits[0]!.paths).toContain(`${DIR}/tessa/prompt.md`);
      expect(rig.announced).toHaveLength(1);
      expect(rig.logs.filter((line) => line.startsWith('crew: seeded the default crew'))).toHaveLength(1);
    });

    it('req-258: writes the crew order, the human last, and the shipped run settings', async () => {
      await rig.seeder.seed(rig.vault);
      expect(crewOrderOf(await rig.read(CREW))).toEqual([...DEFAULT_CREW_IDS, 'you']);
      const settingsOf = async (id: string) => parsePersonaFile(id, (await rig.read(`${DIR}/${id}/persona.md`))!).settings;
      expect((await settingsOf('paul')).gate).toBe('structural');
      expect((await settingsOf('ralf')).readOnly).toBe(true);
      expect((await settingsOf('tessa')).readOnly).toBe(true);
      expect((await settingsOf('ben')).readOnly).toBeNull();
    });

    it('gives each persona its role, a distinct colour and the role\'s step below its character', async () => {
      await rig.seeder.seed(rig.vault);
      const personas = await Promise.all(DEFAULT_CREW_IDS.map(async (id) => parsePersonaFile(id, (await rig.read(`${DIR}/${id}/persona.md`))!)));
      expect(personas.map((p) => p.role)).toEqual(['custom', 'planner', 'builder', 'reviewer', 'tester']);
      expect(new Set(personas.map((p) => p.color)).size).toBe(5);
      const ben = (await rig.read(`${DIR}/ben/prompt.md`))!;
      expect(ben.startsWith('## Who Ben is\n')).toBe(true);
      expect(ben).toContain('## The build step');
      expect(ben).toContain('**What changed for you:**');
      expect(ben).not.toContain('drey-prompt-version');
      expect((await rig.read(`${DIR}/paul/prompt.md`))!).toContain('## The planning step');
    });

    it('req-269: seeds Pia as Mission Control\'s persona — her prompt as shipped, no worker, no models, no step', async () => {
      await rig.seeder.seed(rig.vault);
      const record = (await rig.read(`${DIR}/pia/persona.md`))!;
      expect(record).toContain('kind: mission');
      expect(record).not.toMatch(/^worker:/m);
      expect(record).not.toMatch(/^models:/m);
      const prompt = (await rig.read(`${DIR}/pia/prompt.md`))!;
      expect(prompt.startsWith('## Who Pia is\n')).toBe(true);
      expect(prompt).toContain('## How the owner works with Pia');
      expect(prompt).not.toContain('## The ');
      expect(rig.logs.join('\n')).not.toContain('no step prompt for pia');
    });

    it('takes the worker from the default and the models from the table, strongest first', async () => {
      await rig.seeder.seed(rig.vault);
      const ben = parsePersonaFile('ben', (await rig.read(`${DIR}/ben/persona.md`))!);
      expect(ben.worker).toBe('opencode');
      expect(ben.models).toEqual({ default: 'glm-big', pool: ['glm-big', 'glm-mid', 'glm-small'] });
    });

    it('is idempotent: a second seeding writes, commits and logs nothing', async () => {
      await rig.seeder.seed(rig.vault);
      const crew = await rig.read(CREW);
      rig.logs.length = 0;
      expect(await rig.seeder.seed(rig.vault)).toEqual({ kind: 'nothing' });
      expect(rig.commits).toHaveLength(1);
      expect(await rig.read(CREW)).toBe(crew);
      expect(rig.logs).toEqual([]);
    });
  });

  it('seeds only the two that are missing on a board that has two of them, folders untouched', async () => {
    rig = await CrewSeederRig.create({ rows: TABLE });
    await rig.write(`${DIR}/paul/persona.md`, "---\ntitle: Paul\nrole: planner\nworker: claude-code\nmodels:\n  default: owner-pick\n  pool: [owner-pick]\ncolor: '#111111'\nskills: []\n---\n");
    await rig.write(`${DIR}/ben/memory.md`, '# Memory\n');
    const before = await rig.read(`${DIR}/paul/persona.md`);
    expect(await rig.seeder.seed(rig.vault)).toEqual({ kind: 'seeded', ids: ['pia', 'ralf', 'tessa'] });
    expect(await rig.read(`${DIR}/paul/persona.md`)).toBe(before);
    expect(await rig.exists(`${DIR}/paul/prompt.md`)).toBe(false);
    expect(await rig.exists(`${DIR}/ben/persona.md`)).toBe(false);
    expect(await rig.read(`${DIR}/ben/memory.md`)).toBe('# Memory\n');
    expect(seededCrewOf(await rig.read(CREW))).toEqual([...DEFAULT_CREW_IDS]);
    expect(rig.logs.join('\n')).toContain('2 already had a folder');
  });

  it('seeds nothing once the marker is set, and a deleted persona stays deleted', async () => {
    rig = await CrewSeederRig.create({ rows: TABLE });
    await rig.write(CREW, '---\nseeded-crew: [pia, paul, ben, ralf, tessa]\ndefault-worker: opencode\n---\nProse.\n');
    await rig.write(`${DIR}/ralf/persona.md`, '---\ntitle: Ralf\nrole: reviewer\n---\n');
    expect(await rig.seeder.seed(rig.vault)).toEqual({ kind: 'nothing' });
    expect(await rig.exists(`${DIR}/paul/persona.md`)).toBe(false);
    expect(await rig.exists(`${DIR}/ben/persona.md`)).toBe(false);
    expect(await rig.exists(`${DIR}/tessa/persona.md`)).toBe(false);
    expect(rig.commits).toEqual([]);
  });

  it('req-269: a board seeded before Pia gets her alone, at the front of its order, and the deleted personas stay deleted', async () => {
    rig = await CrewSeederRig.create({ rows: TABLE });
    await rig.write(CREW, '---\nseeded-crew: [paul, ben, ralf, tessa]\norder: [paul, ben, you]\n---\nProse.\n');
    await rig.write(`${DIR}/ben/persona.md`, '---\ntitle: Ben\nrole: builder\n---\n');
    expect(await rig.seeder.seed(rig.vault)).toEqual({ kind: 'seeded', ids: ['pia'] });
    expect(await rig.exists(`${DIR}/paul/persona.md`)).toBe(false);
    expect(seededCrewOf(await rig.read(CREW))).toEqual(['paul', 'ben', 'ralf', 'tessa', 'pia']);
    expect(crewOrderOf(await rig.read(CREW))).toEqual(['pia', 'paul', 'ben', 'you']);
    expect(rig.commits).toHaveLength(1);
    expect(rig.commits[0]!.paths).toEqual([`${DIR}/pia/persona.md`, `${DIR}/pia/prompt.md`, CREW]);
  });

  it('req-269: an order that already names Pia, or a Pia the owner deleted, is left as it is', async () => {
    rig = await CrewSeederRig.create({ rows: TABLE });
    await rig.write(CREW, '---\nseeded-crew: [paul, ben, ralf, tessa]\norder: [ben, pia, you]\n---\n');
    await rig.seeder.seed(rig.vault);
    expect(crewOrderOf(await rig.read(CREW))).toEqual(['ben', 'pia', 'you']);
  });

  it('keeps every other key and the prose of an existing crew.md', async () => {
    rig = await CrewSeederRig.create({ rows: TABLE });
    await rig.write(CREW, '---\n# the owner\'s note\ndefault-worker: kimi\ncaps:\n  diff-stat-lines: 12\n---\nMy prose.\n');
    await rig.seeder.seed(rig.vault);
    const text = (await rig.read(CREW))!;
    expect(text).toContain("# the owner's note");
    expect(text).toContain('default-worker: kimi');
    expect(text).toContain('diff-stat-lines: 12');
    expect(text).toContain('seeded-crew: [pia, paul, ben, ralf, tessa]');
    expect(text.endsWith('---\nMy prose.\n')).toBe(true);
  });

  it('req-258: keeps an order the owner already set — Pia, offered for the first time, goes in front (req-269)', async () => {
    rig = await CrewSeederRig.create({ rows: TABLE });
    await rig.write(CREW, '---\norder: [you, ben]\n---\n');
    await rig.seeder.seed(rig.vault);
    expect(crewOrderOf(await rig.read(CREW))).toEqual(['pia', 'you', 'ben']);
  });

  describe('the worker and model rule', () => {
    it('uses the vault worker, and the table rows of that worker\'s provider', async () => {
      rig = await CrewSeederRig.create({ worker: 'claude-code', rows: TABLE });
      await rig.seeder.seed(rig.vault);
      const ralf = parsePersonaFile('ralf', (await rig.read(`${DIR}/ralf/persona.md`))!);
      expect(ralf.worker).toBe('claude-code');
      expect(ralf.models).toEqual({ default: 'opus-x', pool: ['opus-x'] });
    });

    it('leaves the parser default and says so when the table holds no model for the worker', async () => {
      rig = await CrewSeederRig.create({ worker: 'kimi', rows: TABLE });
      await rig.seeder.seed(rig.vault);
      const tessa = parsePersonaFile('tessa', (await rig.read(`${DIR}/tessa/persona.md`))!);
      expect(tessa.worker).toBe('kimi');
      expect(tessa.models).toEqual(parsePersonaFile('x', '---\ntitle: X\n---\n').models);
      expect(rig.logs.join('\n')).toContain('the model table names no model for it');
    });

    it('leaves the parser default and says so when the machine has no table at all', async () => {
      rig = await CrewSeederRig.create({ rows: null });
      expect(await rig.seeder.seed(rig.vault)).toMatchObject({ kind: 'seeded' });
      expect(rig.logs.join('\n')).toContain('the model table names no model for it');
    });
  });

  it('refuses a crew.md that does not parse and writes nothing', async () => {
    rig = await CrewSeederRig.create({ rows: TABLE });
    await rig.write(CREW, '---\nkey: [unclosed\n---\n');
    expect(await rig.seeder.seed(rig.vault)).toMatchObject({ kind: 'refused' });
    expect(await rig.exists(`${DIR}/paul/persona.md`)).toBe(false);
    expect(await rig.read(CREW)).toBe('---\nkey: [unclosed\n---\n');
    expect(rig.logs.join('\n')).toContain('the default crew is seeded once it parses');
  });

  it('versions the files without git as unversioned, once logged', async () => {
    rig = await CrewSeederRig.create({ rows: TABLE, git: { locate: async () => null, commitPaths: async () => undefined } });
    expect(await rig.seeder.seed(rig.vault)).toMatchObject({ kind: 'seeded' });
    expect(rig.logs.join('\n')).toContain('is not a git repository');
  });

  it('logs a failed commit and keeps the files', async () => {
    rig = await CrewSeederRig.create({
      rows: TABLE,
      git: { locate: async () => ({ root: '/repo', prefix: '' }), commitPaths: async () => Promise.reject(new Error('index locked')) },
    });
    expect(await rig.seeder.seed(rig.vault)).toMatchObject({ kind: 'seeded' });
    expect(rig.logs.join('\n')).toContain('git commit failed: index locked');
    expect(await rig.exists(`${DIR}/ben/persona.md`)).toBe(true);
  });
});
