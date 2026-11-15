import { execFileSync } from 'node:child_process';
import { promises as fsp, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DEFAULT_PIPELINE_TEXT } from '../core/pipeline/pipeline-states';
import { TicketsGit } from '../core/git/tickets-git';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools } from '../fleet/protocol';
import { assertDkVersion, MIN_DK_VERSION } from '../store/dk-process';
import { toDricketId } from '../store/ids';
import { EngineBoardService } from './board-service';
import type { EngineHost, EngineVault, FleetPort } from './host';
import { writeLifecycleStages } from './lifecycle-store.fake';

/**
 * The rig of the persona-board service specs (`board-service-persona*.spec.ts`): an `EngineBoardService`
 * over a REAL dk scratch store on the lifecycle stages and a temp meta vault holding the standard
 * pipeline and a small crew (ben, paul, ralf, tessa agents; pia mission; you human). Nothing of the
 * owner's repos, store or home is touched: HOME, git identity and the dk dirs point into the temp root.
 */

export const dkBin = process.env['DREY_DK_BIN'] ?? 'dk';

export function probeDk(): { ok: true } | { ok: false; reason: string } {
  try {
    const out = execFileSync(dkBin, ['--version'], { encoding: 'utf8', windowsHide: true });
    assertDkVersion(/version:\s*(\S+)/.exec(out)?.[1] ?? out.trim(), dkBin);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : `dk was not found ("${dkBin}"); set DREY_DK_BIN to a dk >= ${MIN_DK_VERSION}` };
  }
}

const PERSONA = (kind: string): string => `---\ntitle: P\nkind: ${kind}\nrole: custom\nworker: opencode\n---\n`;

/** What one call changed in the store: the ticket's revisions (puts) and the commits on the tickets branch. */
export interface Writes<T> {
  readonly result: T;
  readonly puts: number;
  readonly commits: number;
}

export interface PersonaRig {
  readonly service: EngineBoardService;
  /** The ticket's whole dk document (frontmatter, Description, Plan, Log); the id is `T-0001` or `t-1`. */
  content(id: string): string;
  /** One frontmatter key of the document; null when it is absent. */
  field(id: string, key: string): string | null;
  /** The path of a file under the meta vault's `tickets/_meta/`. */
  meta(rel: string): string;
  /** Runs `call` and reports how many puts and commits it made on the ticket / the tickets branch. */
  writes<T>(id: string, call: () => Promise<T>): Promise<Writes<T>>;
  /** A captured ticket: stage inbox, the standard flow copied in at cursor 1. */
  capture(title: string, description?: string): Promise<string>;
  /** An `active` ticket with this chain (`a;b;c`) and cursor, put straight into the document. */
  chained(title: string, chain: string, at: number): string;
  close(): Promise<void>;
}

export async function openPersonaRig(): Promise<PersonaRig> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'drey-persona-dk-'));
  const home = path.join(root, 'home');
  mkdirSync(home);
  const storeDir = path.join(root, 'store');
  const saved: Record<string, string | undefined> = {};
  const envSet = (key: string, value: string): void => {
    if (!(key in saved)) {
      saved[key] = process.env[key];
    }
    process.env[key] = value;
  };
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
  const dk = (args: string[]): string => execFileSync(dkBin, args, { windowsHide: true, encoding: 'utf8', stdio: 'pipe' });
  dk(['init', storeDir, 't']);
  writeLifecycleStages(storeDir);
  envSet('DK_STORE', storeDir);

  const metaDir = path.join(root, 'meta');
  const meta = (rel: string): string => path.join(metaDir, 'tickets', '_meta', ...rel.split('/'));
  await fsp.mkdir(meta('prompts'), { recursive: true });
  await fsp.writeFile(meta('pipeline.md'), DEFAULT_PIPELINE_TEXT, 'utf8');
  for (const [id, kind] of [['ben', 'agent'], ['paul', 'agent'], ['ralf', 'agent'], ['tessa', 'agent'], ['pia', 'mission'], ['you', 'human']] as const) {
    await fsp.mkdir(meta(`personas/${id}`), { recursive: true });
    await fsp.writeFile(meta(`personas/${id}/persona.md`), PERSONA(kind), 'utf8');
  }
  const abs = (p: string): string => path.join(metaDir, ...p.split('/'));
  const write = async (_v: string, p: string, text: string): Promise<void> => {
    await fsp.mkdir(path.dirname(abs(p)), { recursive: true });
    await fsp.writeFile(abs(p), text, 'utf8');
  };
  const list = async (dir = ''): Promise<string[]> => {
    const out: string[] = [];
    for (const entry of await fsp.readdir(dir === '' ? metaDir : abs(dir), { withFileTypes: true }).catch(() => [])) {
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
      out.push(...(entry.isDirectory() ? await list(rel) : entry.name.endsWith('.md') ? [rel] : []));
    }
    return out;
  };
  const vault: EngineVault = { id: 'v', name: 'vault', path: metaDir, exists: true, active: true };
  const config: Record<string, string> = { backend: 'dricket', 'dk.path': dkBin === 'dk' ? '' : dkBin, 'dk.store': storeDir, 'dk.dataDir': path.join(root, 'data') };
  const host: EngineHost = {
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
  const fleet: FleetPort = { runs: async () => [], start: async () => ({ ok: false, error: 'not in the spec' }), configureChain: async () => true };
  const git = new TicketsGit(() => 'git', async () => {
    throw new Error('no git in the spec');
  });
  const service = new EngineBoardService(host, git, 'opencode', 'accept-edits', '', fleet, '/fleet', normalizeFleetCaps({}), normalizeFleetPools({}), normalizeFleetHandover({}), 'owner@test', {});
  // A mutation reads the store settings the last snapshot cached (waitForOwner takes them before its own snapshot).
  await service.snapshot();

  const content = (id: string): string => (JSON.parse(dk(['show', toDricketId(id) ?? id, '--json'])) as { data: { content: string } }).data.content;
  const field = (id: string, key: string): string | null => new RegExp(`^${key}: (.*)$`, 'm').exec(content(id))?.[1]?.trim() ?? null;
  const commits = (): number => Number(execFileSync('git', ['rev-list', '--count', 'refs/heads/tickets', '--'], { cwd: storeDir, encoding: 'utf8', windowsHide: true }).trim());

  return {
    service,
    content,
    field,
    meta,
    async writes<T>(id: string, call: () => Promise<T>): Promise<Writes<T>> {
      const [r0, c0] = [Number(field(id, 'rev')), commits()];
      const result = await call();
      return { result, puts: Number(field(id, 'rev')) - r0, commits: commits() - c0 };
    },
    async capture(title: string, description = 'Body.'): Promise<string> {
      const reply = await service.createTicket({ title, priority: 'normal', repo: null, description });
      if (!reply.ok) {
        throw new Error(reply.error);
      }
      return (reply as unknown as { id: string }).id;
    },
    chained(title: string, chain: string, at: number): string {
      const dkId = dk(['add', '--unclaimed', '-m', title]).trim();
      const doc = content(dkId);
      const file = path.join(root, `${dkId}.md`);
      writeFileSync(file, `${doc.replace(/^stage: .*$/m, `stage: active\nx-chain: ${chain}\nx-at: ${at}`).replace(/\s*$/, '\n')}\n## Description\n\nBody.\n`);
      dk(['put', dkId, '-F', file, '--claim', '--if-version', /^rev: (\d+)$/m.exec(doc)?.[1] ?? '1']);
      return `T-${dkId.slice(2).padStart(4, '0')}`;
    },
    async close(): Promise<void> {
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
    },
  };
}
