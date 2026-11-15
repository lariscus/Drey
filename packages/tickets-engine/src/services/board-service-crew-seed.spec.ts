import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsGit } from '../core/tickets-git';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools } from '../fleet/protocol';
import { EngineBoardService } from './board-service';
import type { EngineHost, EngineVault, FleetPort } from './host';

/** req-256: "Initialize board" offers the default crew to the seeder, after the pipeline and the human persona, and only when it initialized. */

let vaultDir = '';
const vault = (): EngineVault => ({ id: 'v', name: 'tickets', path: vaultDir, exists: true, active: true });
const order: string[] = [];

function serviceOf(seed: { seed(target: EngineVault): Promise<unknown> } | undefined): EngineBoardService {
  const abs = (p: string): string => path.join(vaultDir, ...p.split('/'));
  const host = {
    listVaults: async () => [vault()],
    read: async (_v: string, p: string) => fsp.readFile(abs(p), 'utf8'),
    write: async (_v: string, p: string, text: string) => {
      order.push(`write ${p}`);
      await fsp.mkdir(path.dirname(abs(p)), { recursive: true });
      await fsp.writeFile(abs(p), text, 'utf8');
    },
    listMarkdownFiles: async () => [],
    resolveAssetPath: (_v: string, p: string) => abs(p),
    announceChanges: () => undefined,
    markManaged: () => undefined,
    configGet: async () => undefined,
    configSet: async () => undefined,
    emitBoardChanged: () => undefined,
    log: () => undefined,
  } as unknown as EngineHost;
  const git = new TicketsGit(() => 'git', async () => {
    throw new Error('no git in the spec');
  });
  const fleet: FleetPort = { runs: async () => [], start: async () => ({ ok: false, error: 'no' }), configureChain: async () => undefined };
  return new EngineBoardService(host, git, 'opencode', 'accept-edits', '', fleet, '/fleet', normalizeFleetCaps({}), normalizeFleetPools({}), normalizeFleetHandover({}), 'owner@test', seed === undefined ? {} : { crewSeeder: seed });
}

describe('EngineBoardService.initialize and the default crew (req-256)', () => {
  beforeEach(async () => {
    vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-init-crew-'));
    order.length = 0;
  });

  afterEach(async () => {
    await fsp.rm(vaultDir, { recursive: true, force: true });
  });

  it('seeds the crew once the pipeline and the human persona are written, for the vault it initialized', async () => {
    const seeded: string[] = [];
    const seeder = {
      seed: async (target: EngineVault) => {
        seeded.push(target.id);
        order.push('seed');
        return { kind: 'seeded' };
      },
    };
    expect(await serviceOf(seeder).initialize('v')).toMatchObject({ ok: true });
    expect(seeded).toEqual(['v']);
    expect(order.at(-1)).toBe('seed');
    expect(order.indexOf('write tickets/_meta/pipeline.md')).toBeLessThan(order.indexOf('seed'));
    expect(order.some((line) => line.startsWith('write tickets/_meta/prompts/'))).toBe(false);
  });

  it('seeds nothing when the vault already has a board, and works without a seeder', async () => {
    const seeded: string[] = [];
    const seeder = { seed: async (target: EngineVault) => void seeded.push(target.id) };
    expect(await serviceOf(seeder).initialize('v')).toMatchObject({ ok: true });
    seeded.length = 0;
    expect(await serviceOf(seeder).initialize('v')).toMatchObject({ ok: false });
    expect(seeded).toEqual([]);
    await fsp.rm(path.join(vaultDir, 'tickets'), { recursive: true });
    expect(await serviceOf(undefined).initialize('v')).toMatchObject({ ok: true });
  });
});
