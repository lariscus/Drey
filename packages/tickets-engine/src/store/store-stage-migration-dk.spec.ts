import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertDkVersion, DkProcess, MIN_DK_VERSION } from './dk-process';
import { DricketFileStore } from './dricket-file-store';
import { DricketTicketStore } from './dricket-ticket-store';
import { FileStoreReader } from './file-store-reader';
import { readStoreConfigText } from './store-config-text';
import { StoreConfigWriter, type GitPlumbingRun } from './store-config-writer';
import { StoreStageMigration, type StageConfigCommitter, type StageMigrationStore } from './store-stage-migration';
import { parseStoreStages } from './store-stages';

/**
 * req-265 against a REAL `dk` and a scratch store (temp dir, temp HOME — never the owner's store): a
 * store on the six phase stages with tickets in Shaping, Building and Ready Migrates to the lifecycle
 * stages — two config commits on `main` (the ticket checkout untouched), the tickets in `active` with
 * their column pinned, `dk validate` green over the whole history. A crash between the two config
 * commits resumes. Skipped when `dk` is missing or too old.
 */
const bin = process.env['DREY_DK_BIN'] ?? 'dk';

function probe(): { ok: true } | { ok: false; reason: string } {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
    assertDkVersion(/version:\s*(\S+)/.exec(out)?.[1] ?? out.trim(), bin);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : `dk was not found ("${bin}"); set DREY_DK_BIN to a dk >= ${MIN_DK_VERSION}` };
  }
}
const found = probe();
if (!found.ok) {
  console.warn(`[stage migration] SKIPPED: ${found.reason}`);
}

const OLD_STAGES = '[stages]\nvalues = ["inbox", "shaping", "prioritized", "building", "ready", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["building"]\ncancelled = "cancelled"\n';

describe.skipIf(!found.ok)('the stage migration over a real dk store (req-265)', { timeout: 180_000 }, () => {
  let root = '';
  let storeDir = '';
  let env: NodeJS.ProcessEnv;
  let files: DricketFileStore;

  const dk = (args: string[], owner = 'owner@scratch'): string =>
    execFileSync(bin, args, { env: { ...env, DK_OWNER: owner }, windowsHide: true, encoding: 'utf8', stdio: 'pipe' });
  const git = (args: readonly string[], input?: string): string =>
    execFileSync('git', [...args], { cwd: storeDir, env, windowsHide: true, encoding: 'utf8', stdio: 'pipe', ...(input === undefined ? {} : { input }) }).trim();
  const plumbing: GitPlumbingRun = (args, _cwd, input) => Promise.resolve(git(args, input));
  const configText = (): Promise<{ ref: string; text: string } | null> => readStoreConfigText(storeDir, (args) => Promise.resolve(git(args)));
  const migrationStore = (): StageMigrationStore => ({
    configText,
    records: () => files.readAll(),
    show: (id) => files.show(id),
    write: (id, text, options) => files.write(id, text, options),
  });
  const move = async (id: string, stage: string): Promise<void> => {
    const record = await files.show(id);
    await files.write(id, record.text.replace(/^stage: .*$/m, `stage: ${stage}`), { expectedRev: record.rev!, actor: 'owner@scratch' });
  };

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'drey-dk-stages-'));
    const home = path.join(root, 'home');
    mkdirSync(home);
    storeDir = path.join(root, 'store');
    env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, 'AppData'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Stage Test',
      GIT_AUTHOR_EMAIL: 'stages@test.invalid',
      GIT_COMMITTER_NAME: 'Stage Test',
      GIT_COMMITTER_EMAIL: 'stages@test.invalid',
      DK_DATA_DIR: path.join(root, 'data'),
    };
    dk(['init', storeDir, 't']);
    git(['checkout', '-q', 'main']);
    const tomlPath = path.join(storeDir, 'dricket.toml');
    writeFileSync(tomlPath, `${readFileSync(tomlPath, 'utf8').replace(/\[transitions\.agent\][\s\S]*?(?=\n\[|$)/, '')}\n${OLD_STAGES}`);
    git(['commit', '-q', '-am', 'the six phase stages']);
    git(['checkout', '-q', 'tickets']);
    env = { ...env, DK_STORE: storeDir };
    for (const title of ['Shape me', 'Build me', 'Try me', 'Idea', 'Accepted']) {
      dk(['add', '--unclaimed', '-m', title]);
    }
    files = new DricketFileStore(
      new FileStoreReader({ root: storeDir }),
      new DricketTicketStore(new DkProcess({ bin, store: storeDir, dataDir: path.join(root, 'data'), env, readConcurrency: 1 })),
      storeDir,
    );
    await move('T-0001', 'shaping');
    await move('T-0002', 'building');
    await move('T-0003', 'ready');
    await move('T-0005', 'done');
  }, 180_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('offers the migration, refuses while a ticket is claimed, and resumes after a crash between the config commits', async () => {
    const writer = new StoreConfigWriter(storeDir, plumbing);
    const logs: string[] = [];
    const offer = await new StoreStageMigration(migrationStore(), writer, 'owner@scratch', (m) => logs.push(m)).offer();
    expect(offer).toMatchObject({ mode: 'local', legacy: ['shaping', 'building', 'ready'], moves: 3, configCommits: 2, waitFor: null });

    // A claimed ticket blocks the whole migration: nothing is written.
    dk(['claim', 't-4', '--size', 'S'], 'agent-r-9@scratch');
    const mainBefore = git(['rev-parse', 'main']);
    const refused = await new StoreStageMigration(migrationStore(), writer, 'owner@scratch', (m) => logs.push(m)).run();
    expect(refused).toMatchObject({ ok: false });
    expect(git(['rev-parse', 'main'])).toBe(mainBefore);
    dk(['release', 't-4', '--stage', 'inbox'], 'agent-r-9@scratch');

    // A crash right after step 1: the second config commit never happens.
    let commits = 0;
    const crashing: StageConfigCommitter = {
      refusal: () => writer.refusal(),
      commit: async (text, message) => {
        commits += 1;
        if (commits === 2) {
          throw new Error('crash between the two config commits');
        }
        return writer.commit(text, message);
      },
    };
    await expect(new StoreStageMigration(migrationStore(), crashing, 'owner@scratch', (m) => logs.push(m)).run()).rejects.toThrow(/crash/);
    const midway = parseStoreStages((await configText())!.text);
    expect(midway?.values).toEqual(['inbox', 'prioritized', 'shaping', 'building', 'ready', 'active', 'running', 'done']);
    expect(midway?.claim).toEqual(['running']);

    // The next Migrate plans only what is left: the removal.
    const resumed = await new StoreStageMigration(migrationStore(), writer, 'owner@scratch', (m) => logs.push(m)).run();
    expect(resumed).toEqual({ ok: true, configCommits: 1, moved: [] });
    const after = parseStoreStages((await configText())!.text);
    expect(after).toEqual({ values: ['inbox', 'prioritized', 'active', 'running', 'done'], initial: 'inbox', terminal: ['done'], claim: ['running'], cancelled: 'cancelled' });

    const byId = new Map((await files.readAll()).map((r) => [r.id, r] as const));
    expect([byId.get('T-0001')?.stage, byId.get('T-0001')?.extensions['x-phase']]).toEqual(['active', 'shaping']);
    expect([byId.get('T-0002')?.stage, byId.get('T-0002')?.extensions['x-phase']]).toEqual(['active', 'building']);
    expect([byId.get('T-0003')?.stage, byId.get('T-0003')?.extensions['x-phase']]).toEqual(['active', 'ready']);
    expect(byId.get('T-0004')?.stage).toBe('inbox');
    expect(byId.get('T-0005')?.stage).toBe('done');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('tickets'); // the ticket checkout was never switched
    expect(git(['status', '--porcelain'])).toBe('');
    expect(() => dk(['validate'])).not.toThrow(); // R-03: the history replays under each commit's stage set

    // Migrated: nothing more is offered, a further Migrate writes nothing, and a run claims into running.
    expect(await new StoreStageMigration(migrationStore(), writer, 'owner@scratch', () => undefined).offer()).toBeNull();
    expect(await new StoreStageMigration(migrationStore(), writer, 'owner@scratch', () => undefined).run()).toEqual({ ok: true, configCommits: 0, moved: [] });
    dk(['claim', 't-2', '--size', 'S'], 'agent-r-1@scratch');
    expect((await files.show('T-0002')).stage).toBe('running');
    dk(['release', 't-2', '--stage', 'active'], 'agent-r-1@scratch');
    expect((await files.show('T-0002')).stage).toBe('active');
  });

  it('refuses to write main while it is checked out in the store directory', async () => {
    git(['checkout', '-q', 'main']);
    try {
      expect(await new StoreConfigWriter(storeDir, plumbing).refusal()).toMatch(/checked out/);
    } finally {
      git(['checkout', '-q', 'tickets']);
    }
  });
});
