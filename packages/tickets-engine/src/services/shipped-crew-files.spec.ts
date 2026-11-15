import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CREW_IDS } from '../core/persona/default-crew';
import { ShippedCrewFiles, SHIPPED_PERSONAS_DIR } from './shipped-crew-files';

describe('ShippedCrewFiles', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-shipped-crew-'));
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('reads the package: the five personas in crew order', async () => {
    const crew = await new ShippedCrewFiles().load();
    expect(SHIPPED_PERSONAS_DIR.endsWith(path.join('tickets-engine', 'personas'))).toBe(true);
    expect(crew.problems).toEqual([]);
    expect(crew.personas.map((p) => p.id)).toEqual([...DEFAULT_CREW_IDS]);
  });

  it('reports a persona whose files are missing or broken and still reads the rest', async () => {
    await fsp.mkdir(path.join(dir, 'paul'));
    await fsp.writeFile(path.join(dir, 'paul', 'persona.md'), '---\ntitle: Paul\nrole: planner\n---\n');
    await fsp.writeFile(path.join(dir, 'paul', 'prompt.md'), '## Who Paul is\n\nPlans.\n');
    await fsp.mkdir(path.join(dir, 'ben'));
    await fsp.writeFile(path.join(dir, 'ben', 'persona.md'), '---\ntitle: Ben\nrole: custom\n---\n');
    await fsp.writeFile(path.join(dir, 'ben', 'prompt.md'), '## Who Ben is\n');
    const crew = await new ShippedCrewFiles(dir).load();
    expect(crew.personas.map((p) => p.id)).toEqual(['paul']);
    expect(crew.problems).toHaveLength(4);
    expect(crew.problems.join('\n')).toContain('shipped persona ben: its role must be');
    expect(crew.problems.join('\n')).toContain('shipped persona ralf: persona.md or prompt.md is missing');
  });
});
