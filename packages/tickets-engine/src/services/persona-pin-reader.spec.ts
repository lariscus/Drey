import { describe, expect, it } from 'vitest';
import { parseCrewFile } from '../core/crew-file';
import type { EngineVault } from './host';
import { PersonaPinReader } from './persona-pin-reader';

const VAULT: EngineVault = { id: 'v', name: 'tickets', path: '/tickets', exists: true, active: true };

const PIPELINE = `---
phases:
  - id: inbox
    title: Inbox
  - id: build
    title: Build
    persona: ben
  - id: review
    title: Review
    persona: ben
  - id: ship
    title: Ship
    persona: tessa
---
`;

function reader(files: { pipeline?: string; crew?: string | null }): PersonaPinReader {
  return new PersonaPinReader(
    { read: async (_id, rel) => (rel.endsWith('pipeline.md') && files.pipeline !== undefined ? files.pipeline : Promise.reject(new Error('absent'))) },
    { read: async () => ({ text: files.crew ?? null, parse: parseCrewFile(files.crew ?? null) }) },
  );
}

describe('PersonaPinReader', () => {
  it('names the columns whose persona: is the id, in pipeline order', async () => {
    expect(await reader({ pipeline: PIPELINE }).pinsOf(VAULT, 'ben')).toEqual({ columns: ['Build', 'Review'], crewDefault: false });
    expect(await reader({ pipeline: PIPELINE }).pinsOf(VAULT, 'ralf')).toEqual({ columns: [], crewDefault: false });
  });

  it('knows the crew\'s default-persona', async () => {
    const crew = '---\ndefault-persona: paul\n---\n';
    expect(await reader({ pipeline: PIPELINE, crew }).pinsOf(VAULT, 'paul')).toEqual({ columns: [], crewDefault: true });
    expect(await reader({ pipeline: PIPELINE, crew }).pinsOf(VAULT, 'ben')).toEqual({ columns: ['Build', 'Review'], crewDefault: false });
  });

  it('pins nobody when the pipeline or the crew file is absent or does not parse', async () => {
    expect(await reader({}).pinsOf(VAULT, 'ben')).toEqual({ columns: [], crewDefault: false });
    expect(await reader({ pipeline: 'no fence', crew: '---\n: [\n---\n' }).pinsOf(VAULT, 'ben')).toEqual({ columns: [], crewDefault: false });
  });
});
