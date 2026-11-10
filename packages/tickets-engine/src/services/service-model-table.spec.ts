import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../fleet/node-file-system';
import { ServiceModelTable } from './service-model-table';

describe('ServiceModelTable — the model table read from service.json (req-256)', () => {
  let dir = '';
  let file = '';
  const table = (): ServiceModelTable => new ServiceModelTable(new NodeFileSystem(), file);

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-service-json-'));
    file = path.join(dir, 'service.json');
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('reads the rows a provider serves, without a runner', async () => {
    await fsp.writeFile(file, JSON.stringify({ models: [{ model: 'glm-big', provider: 'opencode', category: 'frontier', class: 'A', cost: 2, sessions: 1 }, { model: 'bad row', provider: 'nowhere', class: 'A' }] }));
    const rows = await table().rows();
    expect(rows?.map((r) => [r.model, r.provider, r.class])).toEqual([['glm-big', 'opencode', 'A']]);
  });

  it('has no table when the file is absent, does not parse or holds no models key', async () => {
    expect(await table().rows()).toBeNull();
    await fsp.writeFile(file, '{ broken');
    expect(await table().rows()).toBeNull();
    await fsp.writeFile(file, JSON.stringify({ slots: [] }));
    expect(await table().rows()).toBeNull();
  });

  it('never writes the file', async () => {
    await fsp.writeFile(file, '{ broken');
    await table().rows();
    expect(await fsp.readFile(file, 'utf8')).toBe('{ broken');
  });
});
