import { execFileSync } from 'node:child_process';
import { promises as fsp, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_PIPELINE_TEXT } from '../core/pipeline-states';
import { TicketsGit } from '../core/tickets-git';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools, type RunInfo, type RunRequest } from '../fleet/protocol';
import { assertDkVersion, MIN_DK_VERSION } from '../store/dk-process';
import { EngineBoardService } from './board-service';
import type { EngineHost, EngineVault, FleetPort } from './host';
import { writeLifecycleStages } from './lifecycle-store.fake';

/**
 * Accept on You's last chain entry (req-99a, build plan Q8): the commit step on the
 * target repository — since req-267 You's `commit` leaving action, a machine run — and
 * Done as its bookkeeping result, over a REAL `dk` and a scratch store on the
 * lifecycle stages (skipped, with the reason, when `dk` is missing), because dk's own rule
 * shapes this: an agent never releases into the terminal stage.
 */

/** The owner's persona; `leaving` is its key line (req-267: the sign-off's merge is its `commit`). */
const YOU = (leaving: string): string => `---\ntitle: You\nkind: human\nrole: custom\n${leaving}---\n`;
const WITH_COMMIT = 'leaving: [commit]\n';
const REPOS = (repoPath: string): string => `---\nrepos:\n  kt:\n    url: https://example.test/kt.git\n    path: '${repoPath}'\n    branch: main\n---\n`;

function runInfo(id: string, ticketId: string, state: RunInfo['state'], extra: Partial<RunInfo> = {}): RunInfo {
  return { id, ticketId, provider: 'opencode', state, pid: null, startedAt: '2026-11-06T10:00:00Z', endedAt: '2026-11-06T10:05:00Z', sessionRef: null, tokensIn: 0, tokensOut: 0, costUsd: null, lastActivity: '2026-11-06T10:05:00Z', ...extra } as RunInfo;
}

function hostOver(vaultDir: string, vault: EngineVault, config: Record<string, string>): EngineHost {
  const abs = (p: string): string => path.join(vaultDir, ...p.split('/'));
  const write = async (_v: string, p: string, text: string): Promise<void> => {
    await fsp.mkdir(path.dirname(abs(p)), { recursive: true });
    await fsp.writeFile(abs(p), text, 'utf8');
  };
  const list = async (dir = ''): Promise<string[]> => {
    const out: string[] = [];
    for (const entry of await fsp.readdir(dir === '' ? vaultDir : abs(dir), { withFileTypes: true }).catch(() => [])) {
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        out.push(...(await list(rel)));
      } else if (entry.name.endsWith('.md')) {
        out.push(rel);
      }
    }
    return out;
  };
  return {
    listVaults: async () => [vault],
    read: async (_v, p) => fsp.readFile(abs(p), 'utf8'),
    writeAnnounced: write,
    write,
    listMarkdownFiles: () => list(),
    resolveAssetPath: (_v, p) => abs(p),
    announceChanges: () => undefined,
    markManaged: () => undefined,
    configGet: async <T>(key: string) => config[key] as T | undefined,
    configSet: async () => undefined,
    emitBoardChanged: () => undefined,
    log: () => undefined,
    pickFolder: async () => null,
    revealPath: async () => '',
    launchInConsole: () => undefined,
  };
}

function serviceOver(host: EngineHost, fleet: FleetPort): EngineBoardService {
  return new EngineBoardService(host, new TicketsGit(() => 'git', async () => { throw new Error('no git in the spec'); }), 'opencode', 'accept-edits', '', fleet, '/fleet', normalizeFleetCaps({}), normalizeFleetPools({}), normalizeFleetHandover({}), 'owner@test', {});
}

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
  console.warn(`[commit step on a store] SKIPPED: ${found.reason}`);
}

describe.skipIf(!found.ok)('Accept on a store on the lifecycle stages (real dk)', { timeout: 240_000 }, () => {
  let root = '';
  let storeDir = '';
  let vaultDir = '';
  let service: EngineBoardService;
  const saved: Record<string, string | undefined> = {};
  const started: RunRequest[] = [];
  let runs: RunInfo[] = [];

  const envSet = (key: string, value: string): void => {
    if (!(key in saved)) {
      saved[key] = process.env[key];
    }
    process.env[key] = value;
  };
  const dk = (args: string[], owner?: string): string =>
    execFileSync(bin, args, { windowsHide: true, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...(owner === undefined ? {} : { DK_OWNER: owner }) } });
  const stageOf = (id: string): string => /^stage: (.*)$/m.exec((JSON.parse(dk(['show', id, '--json'])) as { data: { content: string } }).data.content)?.[1]?.trim() ?? '';

  /** The way a run works the ticket: an agent's claim (dk moves it into `running`), then its stay-put release. */
  function agentRun(id: string, runId: string): void {
    dk(['--json', 'claim', id, '--size', 'S', '--kind', 'agent'], `agent-${runId}@test`);
  }

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'drey-commit-dk-'));
    const home = path.join(root, 'home');
    mkdirSync(home);
    storeDir = path.join(root, 'store');
    for (const [k, v] of Object.entries({
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, 'AppData'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Board Test',
      GIT_AUTHOR_EMAIL: 'board@test.invalid',
      GIT_COMMITTER_NAME: 'Board Test',
      GIT_COMMITTER_EMAIL: 'board@test.invalid',
      DK_DATA_DIR: path.join(root, 'data'),
      DK_OWNER: 'owner@test',
    })) {
      envSet(k, v);
    }
    dk(['init', storeDir, 't']);
    writeLifecycleStages(storeDir);
    envSet('DK_STORE', storeDir);

    vaultDir = path.join(root, 'meta');
    const kt = path.join(root, 'kt');
    mkdirSync(kt);
    await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta', 'prompts'), { recursive: true });
    await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'pipeline.md'), DEFAULT_PIPELINE_TEXT, 'utf8');
    await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'repos.md'), REPOS(kt.split(path.sep).join('/')), 'utf8');
    await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta', 'personas', 'you'), { recursive: true });
    await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'personas', 'you', 'persona.md'), YOU(WITH_COMMIT), 'utf8');

    const fleet: FleetPort = {
      runs: async () => runs,
      start: async (request) => {
        started.push(request);
        return { ok: true, run: runInfo(`R-${started.length}`, request.ticketId, 'running') };
      },
      configureChain: async () => undefined,
    };
    const config = { backend: 'dricket', 'dk.path': bin === 'dk' ? '' : bin, 'dk.store': storeDir, 'dk.dataDir': path.join(root, 'data') };
    service = serviceOver(hostOver(vaultDir, { id: 'v', name: 'vault', path: vaultDir, exists: true, active: true }, config), fleet);
  });

  afterAll(async () => {
    service.dispose();
    await service.idle();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  /** An `active` ticket whose only chain entry is You: Accept there is the sign-off, You's `commit` runs. */
  async function readyTicket(title: string): Promise<{ id: string; dkId: string }> {
    const dkId = dk(['add', '--unclaimed', '-m', title]).trim();
    const text = (JSON.parse(dk(['show', dkId, '--json'])) as { data: { content: string; rev?: number } }).data.content;
    const file = path.join(root, `${dkId}.md`);
    writeFileSync(file, `${text.replace(/^stage: .*$/m, 'stage: active\nx-chain: you\nx-at: 1').replace(/^repos:.*$/m, 'repos: kt').replace(/\s*$/, '\n')}\n## Plan\n\n### Acceptance criteria\n\n- [ ] \`echo ok\`\n`);
    const rev = /^rev: (\d+)$/m.exec(text)?.[1] ?? '1';
    dk(['put', dkId, '-F', file, '--claim', '--if-version', rev]);
    return { id: `T-${dkId.slice(2).padStart(4, '0')}`, dkId };
  }

  it('dk itself forbids the short way: an agent may not release into Done', async () => {
    const { dkId } = await readyTicket('Rule check');
    agentRun(dkId, 'probe');
    expect(stageOf(dkId)).toBe('running');
    expect(() => dk(['--json', 'release', '--stage', 'done', '-m', 'x', dkId], 'agent-probe@test')).toThrow(/may not release/);
    dk(['--json', 'release', '--stage', 'active', '-m', 'x', dkId], 'agent-probe@test');
    expect(stageOf(dkId)).toBe('active');
  });

  it('a green commit step leaves the ticket for the bookkeeping move, which lands it in Done', async () => {
    const { id, dkId } = await readyTicket('Green');
    const accepted = await service.acceptTicket({ id });
    expect(accepted).toMatchObject({ ok: true });
    const request = started[started.length - 1]!;
    expect(request).toMatchObject({ ticketId: id, machine: { action: 'commit', persona: 'you' } });
    expect(request.dk).toMatchObject({ store: storeDir });
    const runId = (accepted as { runId?: string }).runId!;

    // Still running: nothing moves.
    runs = [runInfo(runId, id, 'running')];
    await service.settleCommitSteps();
    expect(stageOf(dkId)).toBe('active');

    // The run claims, works and hands back as the runner does when it moved nothing.
    agentRun(dkId, 'green');
    dk(['--json', 'release', '--stage', 'active', '-m', 'merged', dkId], 'agent-green@test');
    runs = [runInfo(runId, id, 'done', { gateResult: 'green' })];
    await service.settleCommitSteps();
    expect(stageOf(dkId)).toBe('done');

    // Idempotent: the list is empty now.
    await service.settleCommitSteps();
    expect(stageOf(dkId)).toBe('done');
    expect(() => dk(['validate'])).not.toThrow();
  });

  it('a run that reads done while its claim is still held waits for the release, then lands in Done (D-32)', async () => {
    const { id, dkId } = await readyTicket('Late release');
    const accepted = (await service.acceptTicket({ id })) as { runId?: string };
    const runId = accepted.runId!;
    // The runner's record says done + green, but its claim is not released yet: the ticket is still in `running`.
    agentRun(dkId, 'late');
    runs = [runInfo(runId, id, 'done', { gateResult: 'green' })];
    await service.settleCommitSteps();
    expect(stageOf(dkId)).toBe('running');
    // The release a moment later: the next settle books the move.
    dk(['--json', 'release', '--stage', 'active', '-m', 'merged', dkId], 'agent-late@test');
    await service.settleCommitSteps();
    expect(stageOf(dkId)).toBe('done');
  });

  it('a blocked or failed commit step leaves the ticket where Accept found it', async () => {
    const blocked = await readyTicket('Blocked');
    const a = (await service.acceptTicket({ id: blocked.id })) as { runId?: string };
    runs = [runInfo(a.runId!, blocked.id, 'done', { blocked: 'the policy merge awaits the owner' })];
    await service.settleCommitSteps();
    expect(stageOf(blocked.dkId)).toBe('active');

    const failed = await readyTicket('Failed');
    const b = (await service.acceptTicket({ id: failed.id })) as { runId?: string };
    runs = [runInfo(b.runId!, failed.id, 'failed')];
    await service.settleCommitSteps();
    expect(stageOf(failed.dkId)).toBe('active');
  });

  it('reading the board settles a finished step', async () => {
    const { id, dkId } = await readyTicket('By read');
    const accepted = (await service.acceptTicket({ id })) as { runId?: string };
    runs = [runInfo(accepted.runId!, id, 'done', { gateResult: 'green' })];
    await service.snapshot();
    await service.idle();
    expect(stageOf(dkId)).toBe('done');
  });
});
