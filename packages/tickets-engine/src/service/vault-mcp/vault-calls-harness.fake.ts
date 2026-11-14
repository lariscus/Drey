/**
 * The vault MCP's call specs' harness (req-167, req-283): registered vaults
 * and project folders on a memory disk, the board's projects and personas as
 * a mutable source, one minted token and its run stream.
 */
import type { ProjectRecord } from '../../contracts/projects';
import type { NormalizedEvent } from '../../fleet/harness/contract';
import type { PersonaRecordsGrant, VaultScope } from '../../fleet/orchestrate/worker-vault';
import type { VaultSite } from './disk-tool-vault';
import { MemoryVaultDisk } from './memory-vault-disk.fake';
import { PersonaRecordTools, type PersonaRecordsPort } from './persona-record-tools';
import { ProjectRights, type RightsSource } from './project-rights';
import { RunTokens, type TokenSession } from './run-tokens';
import { VaultCallAuditor } from './vault-call-auditor';
import { VaultMcpCalls } from './vault-mcp-calls';
import type { VaultPathsChange } from './vault-paths-change';

export const SITES: VaultSite[] = [
  { id: 'notes', name: 'Notes', path: '/v/notes', active: true, exists: true },
  { id: 'work', name: 'Work', path: '/v/work', active: false, exists: true },
  { id: 'private', name: 'Private', path: '/v/private', active: false, exists: true },
  { id: 'loose', name: 'Loose', path: '/v/loose', active: false, exists: true },
];

const record = (id: string, vaults: ProjectRecord['vaults'], folders: readonly string[] = []): ProjectRecord => ({ id, name: id, color: '', repos: [], folders, vaults, purpose: '' });

/** drey: Notes read, Work write, the specs folder; lariscus: Private read, Work none, the shared folder. Loose is in no project. */
export function boardProjects(): ProjectRecord[] {
  return [record('drey', { Notes: 'read', Work: 'write' }, ['/f/specs']), record('lariscus', { Private: 'read', Work: 'none' }, ['/f/shared', 'relative/ignored'])];
}

export interface HarnessOptions {
  readonly persona?: string | null;
  readonly readOnly?: boolean;
  readonly tools?: readonly string[];
  readonly scope?: VaultScope;
  /** req-226: the grant's persona writes and the engine's writer behind the two tools. */
  readonly records?: PersonaRecordsGrant;
  readonly port?: PersonaRecordsPort;
}

/** The board as the rights read it: ben may change notes, ralf may not; the records can change between calls. */
export class BoardFake implements RightsSource {
  projectList: ProjectRecord[] | null = boardProjects();
  readonly writers = new Set(['ben']);

  projects(): Promise<readonly ProjectRecord[]> {
    return this.projectList === null ? Promise.reject(new Error('the engine is not up')) : Promise.resolve(this.projectList);
  }

  writesNotes(id: string): Promise<boolean> {
    return Promise.resolve(this.writers.has(id));
  }
}

export function harness(options: HarnessOptions = {}) {
  const disk = new MemoryVaultDisk()
    .seed('/v/notes', { 'a.md': '# A\n\nalpha\n', 'tickets/T-1.md': 'ticket\n' })
    .seed('/v/work', { 'w.md': 'work one\n', 'index.md': 'See [w](w.md).\n' })
    .seed('/v/private', { 'p.md': 'private\n' })
    .seed('/v/loose', { 'l.md': 'loose\n' })
    .seed('/f/specs', { 'spec.md': '# Spec\n\nthe rule\n', '.git/HEAD': 'ref\n' })
    .seed('/f/shared', { 's.md': 'shared\n' });
  const board = new BoardFake();
  const events: NormalizedEvent[] = [];
  const logged: string[] = [];
  const changes: VaultPathsChange[] = [];
  let clock = 0;
  const calls = new VaultMcpCalls({
    vaults: { current: async () => SITES },
    disk,
    rights: new ProjectRights(board, disk),
    auditor: new VaultCallAuditor({ now: () => new Date(Date.UTC(2026, 10, 9, 12, 0, 0, (clock += 5))), log: (m) => logged.push(m) }),
    changed: (change) => changes.push(change),
    ...(options.port === undefined ? {} : { records: new PersonaRecordTools(options.port) }),
  });
  const tokens = new RunTokens({ token: () => 'tok', hash: (t) => t });
  const { persona = 'ben', readOnly = false, tools, scope = { kind: 'project', project: 'drey' } } = options;
  const records = options.records === undefined ? {} : { records: options.records };
  const grant = { runId: 'run-1', ticketId: 'T-9', persona, readOnly, scope, ...(tools === undefined ? {} : { tools }), ...records, emit: (e: NormalizedEvent) => events.push(e) };
  const session: TokenSession = tokens.resolve(tokens.mint(grant))!;
  const call = async (name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => {
    const result = await calls.call(session, name, args);
    return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError === true };
  };
  return { calls, disk, board, events, logged, changes, session, call };
}
