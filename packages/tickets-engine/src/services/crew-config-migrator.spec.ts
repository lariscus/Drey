import { describe, expect, it } from 'vitest';
import { CREW_FILE } from '../contracts/crew-config';
import { parseCrewFile } from '../core/persona/crew-file';
import { CrewConfigFiles } from './crew-config-files';
import { CREW_MIGRATED_KEY, CrewConfigMigrator, vaultKeyOf, type CrewLegacyPort } from './crew-config-migrator';
import { CrewConfigService } from './crew-config-service';
import type { EngineVault } from './host';

/**
 * req-173's one-time key migration, on fakes only: no disk, no git, and
 * never the owner's `~/.drey-engine/config.json`.
 */

const VAULT: EngineVault = { id: 'v1', name: 'tickets', path: 'E:\\Tickets', exists: true, active: true };

class FakeWorld {
  readonly files = new Map<string, string>();
  readonly commits: string[] = [];
  readonly logs: string[] = [];
  config: Record<string, unknown> = {};
  chain: Record<string, unknown> | null = null;

  readonly legacy: CrewLegacyPort = {
    config: async () => ({ ...this.config }),
    chainConfig: async () => this.chain,
    markDone: async (key, at) => {
      this.config = { ...this.config, [CREW_MIGRATED_KEY]: { ...((this.config[CREW_MIGRATED_KEY] as object | undefined) ?? {}), [key]: at } };
    },
  };

  service(): CrewConfigService {
    const host = {
      read: async (_id: string, path: string): Promise<string> => {
        const text = this.files.get(path);
        if (text === undefined) {
          throw new Error('ENOENT');
        }
        return text;
      },
      write: async (_id: string, path: string, text: string): Promise<void> => void this.files.set(path, text),
      announceChanges: (): void => undefined,
      log: (message: string): void => void this.logs.push(message),
    };
    const git = { locate: async () => ({ root: 'E:\\Tickets', prefix: '' }), commitPaths: async (_r: string, _p: readonly string[], message: string) => void this.commits.push(message) };
    const files = new CrewConfigFiles(host, git);
    const log = (message: string): void => void this.logs.push(message);
    return new CrewConfigService(files, new CrewConfigMigrator(files, this.legacy, log, () => new Date('2026-11-09T10:00:00Z')), log);
  }

  crew(): ReturnType<typeof parseCrewFile>['config']['values'] {
    return parseCrewFile(this.files.get(CREW_FILE) ?? null).config.values;
  }
}

describe('CrewConfigMigrator (req-173)', () => {
  it('old config only: the non-default keys move into crew.md, one commit, every move logged', async () => {
    const w = new FakeWorld();
    w.config = {
      defaultWorker: 'claude-code',
      autoPermissionMode: 'bypass',
      'personas.default': 'ben',
      'fleet.cap.diffStatLines': 80,
      'fleet.cap.gateFailureLines': 40, // the default: not written
      'fleet.resumePauseTtlMin': '12',
      'fleet.compactAboveTokens.kimi': 50000,
      'engine.token': 'secret',
    };
    const crew = await w.service().effective(VAULT);
    expect(w.crew()).toEqual({
      defaultPersona: 'ben',
      defaultWorker: 'claude-code',
      permissionMode: 'bypass',
      'caps.diffStatLines': 80,
      'handover.resumePauseTtlMin': 12,
    });
    expect(parseCrewFile(w.files.get(CREW_FILE)!).config.overrides.compactAboveTokensBy).toEqual({ kimi: 50000 });
    expect(crew.defaultWorker).toBe('claude-code');
    expect(w.commits).toEqual(['tickets: crew settings move into _meta/crew.md (req-173)']);
    expect(w.logs.some((l) => l === 'crew.md: defaultWorker = claude-code (moved from config.json defaultWorker)')).toBe(true);
    expect(w.config[CREW_MIGRATED_KEY]).toEqual({ [vaultKeyOf(VAULT.path)]: '2026-11-09T10:00:00.000Z' });
    expect(w.config['defaultWorker']).toBe('claude-code'); // the old key stays where it was, read by nothing
  });

  it('the old chain.json config fills what config.json lacks', async () => {
    const w = new FakeWorld();
    w.config = { defaultWorker: 'kimi' };
    w.chain = { defaultWorker: 'opencode', defaultPersona: 'paul', caps: { diffStatBytes: 9000 }, handover: { contextCapTokensOverrides: { opencode: 64000 } } };
    await w.service().effective(VAULT);
    expect(w.crew()).toEqual({ defaultWorker: 'kimi', defaultPersona: 'paul', 'caps.diffStatBytes': 9000 });
    expect(parseCrewFile(w.files.get(CREW_FILE)!).config.overrides.contextCapTokensBy).toEqual({ opencode: 64000 });
  });

  it('_meta only: the vault wins, nothing is written, the marker is set', async () => {
    const w = new FakeWorld();
    w.files.set(CREW_FILE, '---\ndefault-worker: kimi\n---\nOurs.\n');
    await w.service().effective(VAULT);
    expect(w.commits).toEqual([]);
    expect(w.files.get(CREW_FILE)).toBe('---\ndefault-worker: kimi\n---\nOurs.\n');
    expect(Object.keys(w.config[CREW_MIGRATED_KEY] as object)).toEqual([vaultKeyOf(VAULT.path)]);
  });

  it('both: a key the file holds is never overwritten; only the absent ones are added', async () => {
    const w = new FakeWorld();
    w.files.set(CREW_FILE, '---\ndefault-worker: kimi\n---\n');
    w.config = { defaultWorker: 'claude-code', 'personas.default': 'tessa' };
    await w.service().effective(VAULT);
    expect(w.crew()).toEqual({ defaultWorker: 'kimi', defaultPersona: 'tessa' });
  });

  it('is idempotent: a second process with the marker set does nothing, and without it adds nothing new', async () => {
    const w = new FakeWorld();
    w.config = { defaultWorker: 'claude-code' };
    await w.service().effective(VAULT);
    await w.service().effective(VAULT); // the marker keeps it from running
    expect(w.commits).toHaveLength(1);
    delete w.config[CREW_MIGRATED_KEY];
    const before = w.files.get(CREW_FILE);
    await w.service().effective(VAULT); // runs again, finds every key present
    expect(w.files.get(CREW_FILE)).toBe(before);
    expect(w.commits).toHaveLength(1);
  });

  it('leaves a crew.md that does not parse alone and resolves the defaults', async () => {
    const w = new FakeWorld();
    w.files.set(CREW_FILE, '---\ncaps: [\n---\n');
    w.config = { defaultWorker: 'claude-code' };
    const crew = await w.service().effective(VAULT);
    expect(crew.defaultWorker).toBe('opencode');
    expect(w.commits).toEqual([]);
    expect(w.config[CREW_MIGRATED_KEY]).toBeUndefined(); // tried again once the file parses
  });

  it('a patch writes the file once with one commit; an unchanged patch writes nothing', async () => {
    const w = new FakeWorld();
    const service = w.service();
    expect(await service.set(VAULT, [{ key: 'permissionMode', value: 'bypass' }])).toEqual({ ok: true });
    expect(await service.set(VAULT, [{ key: 'permissionMode', value: 'bypass' }])).toEqual({ ok: true });
    expect(w.commits).toEqual(['tickets: crew settings (permissionMode)']);
    const reply = await service.reply(VAULT);
    expect(reply.ok && reply.sources.permissionMode).toBe('vault');
    expect(reply.ok && reply.sources.defaultWorker).toBe('default');
    expect(await service.set(VAULT, [{ key: 'permissionMode', value: 'read-only' }])).toMatchObject({ ok: false });
  });
});
