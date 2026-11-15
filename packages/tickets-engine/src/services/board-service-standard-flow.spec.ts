import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineBoardService } from './board-service';
import type { EngineHost, EngineVault, FleetPort } from './host';
import { TicketsGit } from '../core/git/tickets-git';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools } from '../fleet/protocol';

/**
 * E10-5b: the standard flow as a flow-editor target (`flow://standard`,
 * pipeline.md's `flow:`) and the proposal switch (`propose-flow:`), against a
 * real temp vault: the view, the edits, the save into pipeline.md, the
 * refusals, and the snapshot's read of the switch.
 */

const PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: build, title: Build, handover: manual, persona: ben }
  - { id: review, title: Review, handover: manual, persona: ralf }
  - { id: verify, title: Verify, handover: manual }
  - { id: security, title: Security, handover: manual }
  - { id: commit, title: Commit, handover: manual }
  - { id: done, title: Done, handover: none }
flow: paul:shape; paul; ben; ralf
---
The pipeline.
`;

let vaultDir = '';
let vault: EngineVault;

beforeEach(async () => {
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-standard-flow-'));
  vault = { id: 'v', name: 'vault', path: vaultDir, exists: true, active: true };
  await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta'), { recursive: true });
  await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'pipeline.md'), PIPELINE, 'utf8');
  for (const [id, title, model] of [
    ['ben', 'Ben', 'sonnet'],
    ['paul', 'Paul', 'opus'],
    ['ralf', 'Ralf', 'opus'],
  ] as const) {
    await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta', 'personas', id), { recursive: true });
    await fsp.writeFile(
      path.join(vaultDir, 'tickets', '_meta', 'personas', id, 'persona.md'),
      `---\ntitle: ${title}\nrole: builder\nworker: opencode\nmodels:\n  default: ${model}\n  pool: [${model}]\n  router: off\ncolor: '#a78bfa'\n---\n\nWho.\n`,
      'utf8',
    );
  }
});

afterEach(async () => {
  await fsp.rm(vaultDir, { recursive: true, force: true });
});

async function listMarkdownFiles(root: string, dir = ''): Promise<string[]> {
  const abs = dir === '' ? root : path.join(root, dir);
  const out: string[] = [];
  for (const entry of await fsp.readdir(abs, { withFileTypes: true }).catch(() => [])) {
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFiles(root, rel)));
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

function hostOf(): EngineHost {
  const abs = (p: string): string => path.join(vaultDir, ...p.split('/'));
  const write = async (_v: string, p: string, text: string): Promise<void> => {
    await fsp.mkdir(path.dirname(abs(p)), { recursive: true });
    await fsp.writeFile(abs(p), text, 'utf8');
  };
  return {
    listVaults: async () => [vault],
    read: async (_v, p) => fsp.readFile(abs(p), 'utf8'),
    writeAnnounced: write,
    write,
    listMarkdownFiles: async () => listMarkdownFiles(vaultDir),
    resolveAssetPath: (_v, p) => abs(p),
    announceChanges: () => undefined,
    markManaged: () => undefined,
    configGet: async () => undefined,
    configSet: async () => undefined,
    emitBoardChanged: () => undefined,
    log: () => undefined,
    pickFolder: async () => null,
    revealPath: async () => '',
    launchInConsole: () => undefined,
  };
}

function serviceOf(): EngineBoardService {
  const git = new TicketsGit(() => 'git', async () => {
    throw new Error('no git in the spec');
  });
  const fleet: FleetPort = {
    runs: async () => [],
    start: async () => ({ ok: false, error: 'not in the spec' }),
    configureChain: async () => undefined,
  };
  return new EngineBoardService(hostOf(), git, 'opencode', 'accept-edits', '', fleet, '/fleet', normalizeFleetCaps({}), normalizeFleetPools({}), normalizeFleetHandover({}), 'owner@test', {});
}

const read = (rel: string): Promise<string> => fsp.readFile(path.join(vaultDir, ...rel.split('/')), 'utf8');

describe('the standard flow and the proposal switch', () => {
  it('opens the standard flow in the flow editor: nothing locked, no ticket behind it', async () => {
    const reply = await serviceOf().flowOf({ id: 'standard', part: null });
    expect(reply.ok).toBe(true);
    if (!reply.ok) {
      return;
    }
    expect(reply.scope).toEqual({ kind: 'standard' });
    expect(reply.ticket).toBe('standard');
    expect(reply.saved).toEqual(['paul:shape', 'paul', 'ben', 'ralf']);
    expect(reply.steps.every((s) => !s.locked)).toBe(true);
    expect(reply.readOnly).toBeNull();
    expect(await serviceOf().flowOf({ id: 'standard', part: 0 })).toMatchObject({ ok: false });
  });

  it('refuses a persona the crew lacks and an entry that does not read; an empty list removes the key', async () => {
    const board = serviceOf();
    expect(await board.saveFlow({ id: 'standard', part: null, chain: ['paul', 'zed'] })).toMatchObject({ ok: false });
    expect(await board.saveFlow({ id: 'standard', part: null, chain: ['skip verify'] })).toMatchObject({ ok: false, error: expect.stringContaining('not readable') });
    expect(await read('tickets/_meta/pipeline.md')).toContain('flow: paul:shape; paul; ben; ralf');
    expect(await board.saveFlow({ id: 'standard', part: 0, chain: ['paul'] })).toMatchObject({ ok: false });
    expect(await board.saveFlow({ id: 'standard', part: null, chain: [] })).toMatchObject({ ok: true });
    expect(await read('tickets/_meta/pipeline.md')).not.toMatch(/^flow:/m);
    expect((await board.snapshot()).flow).toBeUndefined();
  });

  it('the switch writes propose-flow: true, the snapshot reads it and off removes the key', async () => {
    const board = serviceOf();
    expect((await board.snapshot()).proposeFlow).toBeUndefined();
    expect(await board.setStandardFlow({ proposeFlow: true })).toMatchObject({ ok: true });
    expect(await read('tickets/_meta/pipeline.md')).toMatch(/^propose-flow: true$/m);
    expect((await board.snapshot()).proposeFlow).toBe(true);
    expect(await board.setStandardFlow({ proposeFlow: true })).toEqual({ ok: true });
    expect(await board.setStandardFlow({ proposeFlow: false })).toMatchObject({ ok: true });
    expect(await read('tickets/_meta/pipeline.md')).not.toContain('propose-flow');
    expect((await board.snapshot()).proposeFlow).toBeUndefined();
  });

  it('reads propose-flow strictly: a value that is no boolean reads as off with a warning', async () => {
    await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'pipeline.md'), PIPELINE.replace('flow: paul', 'propose-flow: sometimes\nflow: paul'), 'utf8');
    const snap = await serviceOf().snapshot();
    expect(snap.proposeFlow).toBeUndefined();
    expect(snap.issues.some((issue) => issue.message.includes('propose-flow'))).toBe(true);
  });
});
