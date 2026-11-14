import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/drey';

// Drey Service is one process per user (`~/.drey-engine/service.lock`): a home
// of its own keeps this test off the owner's live engine and board.
const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;

interface Lock {
  pid: number;
  token: string;
  components: { engine: { port?: number } };
}

function readLock(): Lock | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(engineHome, '.drey-engine', 'service.lock'), 'utf8')) as Lock;
  } catch {
    return null;
  }
}

/** An outside client of the engine, like Mission Control or a phone: the invoke channel only. */
async function invokeEngine(method: string, payload?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  const lock = readLock();
  if (lock === null) {
    throw new Error('no engine lock');
  }
  const response = await fetch(`http://127.0.0.1:${lock.components.engine.port ?? 0}/api/invoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${lock.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method, payload }),
  });
  return (await response.json()) as { ok: boolean; value?: unknown; error?: string };
}

/** The ticket ids on the board as the engine serves it — the one board Mission Control and the phone read. */
async function boardTicketIds(): Promise<string[]> {
  const reply = await invokeEngine('snapshot');
  const snapshot = reply.value as { columns?: { tickets: { id: string }[] }[] } | undefined;
  return (snapshot?.columns ?? []).flatMap((column) => column.tickets.map((ticket) => ticket.id));
}

function stopEngine(): void {
  const lock = readLock();
  if (lock !== null) {
    try {
      process.kill(lock.pid);
    } catch {
      // already gone
    }
  }
}

test.afterEach(() => stopEngine());

test.afterAll(() => {
  stopEngine();
  fs.rmSync(engineHome, { recursive: true, force: true });
});

const PIPELINE = [
  '---',
  'phases:',
  '  - { id: inbox, title: Inbox, handover: manual }',
  '  - { id: build, title: Build, handover: manual }',
  '  - { id: done, title: Done, handover: none }',
  '---',
  'The phases.',
  '',
].join('\n');

const TICKET = [
  '---',
  'id: T-0121',
  'title: "Outline reorder"',
  'repo: drey',
  'priority: normal',
  'rank: 1000',
  'branch: t/T-0121',
  "entered-inbox: '2026-11-01T09:00:00Z'",
  '---',
  '',
  '## Description',
  '',
  'Original goal text.',
  '',
  '## Log',
  '',
].join('\n');

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': PIPELINE,
    'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n'),
    'tickets/10-inbox/T-0121.md': TICKET,
    'Notes.md': '# Notes\n',
  },
  extraVaults: { Scratch: { 'a.md': '# a\n' } },
});

/**
 * D-73 (milestone 278): unloading a tickets vault takes its tickets off the
 * board everywhere at once -- the Tickets panel, and the engine's board that
 * Mission Control and the phone read -- and adding the vault again brings them
 * back. Nothing on disk is touched. The removal is the IPC the Files panel's
 * vault menu (Remove) calls.
 */
test('unloading the tickets vault empties the board everywhere; adding it again brings it back', async ({ page, electronApp }) => {
  await page.locator('app-dock-strip button[aria-label="Show Tickets"]').click();
  await expect.poll(() => readLock() !== null, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await boardTicketIds().catch((): string[] => [])).includes('T-0121'), { timeout: 30_000 }).toBe(true);
  const panelCard = page.getByText('Outline reorder').filter({ visible: true });
  await expect(panelCard.first()).toBeVisible({ timeout: 15_000 });

  const vault = await page.evaluate(async () => {
    const vaults = await window.dreyApi.listVaults();
    return vaults.find((v) => v.id === 'v-main') ?? null;
  });
  expect(vault).not.toBeNull();

  // Remove (unload) it, as the Files panel's vault menu does.
  await page.evaluate((id) => window.dreyApi.removeVault(id), vault!.id);

  await expect.poll(() => boardTicketIds(), { timeout: 15_000 }).toEqual([]);
  await expect(panelCard).toHaveCount(0, { timeout: 15_000 });
  // Unloading is not deleting: the ticket is still on disk.
  expect(fs.existsSync(path.join(vault!.path, 'tickets', '10-inbox', 'T-0121.md'))).toBe(true);

  // Added again (Files panel: Add vault; the native folder picker answers with the same folder), the board is back.
  await electronApp.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, vault!.path);
  await page.evaluate(() => window.dreyApi.addVault());
  await expect.poll(() => boardTicketIds(), { timeout: 15_000 }).toEqual(['T-0121']);
  await expect(panelCard.first()).toBeVisible({ timeout: 15_000 });
});
