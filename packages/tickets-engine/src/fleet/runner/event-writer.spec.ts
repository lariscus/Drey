import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetEventWriter } from './event-writer';
import { LEDGER_FILE, parseLedger } from '../../core/pipeline/ledger';

/**
 * The runner's E7 event writer against a real temp vault: the promise
 * mutex serializes a burst of writes, the ledger file starts on first
 * use, and a failure (a blocked path reads like EBUSY on Windows) logs and
 * swallows — the writer never throws into the orchestration loop.
 */

let vaultDir = '';
let logs: string[];

async function waitFor(cond: () => boolean | Promise<boolean>, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await cond()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(await cond()).toBe(true);
}

beforeEach(async () => {
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-events-'));
  logs = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(vaultDir, { recursive: true, force: true });
});

function writer(): FleetEventWriter {
  return new FleetEventWriter({ vaultPath: vaultDir, log: (message) => logs.push(message) });
}

describe('FleetEventWriter', () => {
  it('serializes a burst of writes: ledger lines keep call order through the mutex', async () => {
    const events = writer();
    events.ledger({ kind: 'dispatched', ticket: 'T-0001', persona: 'pia', model: 'opus' });
    events.ledger({ kind: 'phase', ticket: 'T-0001', from: 'plan', to: 'review' });

    const ledgerPath = path.join(vaultDir, LEDGER_FILE);
    let ledgerText = '';
    await waitFor(async () => {
      ledgerText = await fsp.readFile(ledgerPath, 'utf8').catch(() => '');
      return parseLedger(ledgerText).length === 2;
    });
    expect(parseLedger(ledgerText).map((event) => event.kind)).toEqual(['dispatched', 'phase']);
  });

  it('starts the ledger file with the first line and repairs a torn tail', async () => {
    const metaDir = path.join(vaultDir, 'tickets', '_meta');
    await fsp.mkdir(metaDir, { recursive: true });
    // A torn write: no trailing newline — the next line must not glue onto it.
    await fsp.writeFile(path.join(metaDir, 'ledger.jsonl'), '{"v":1,"ts":"t","event":"archived","ticket":"T-0000"}', 'utf8');

    const events = writer();
    events.ledger({ kind: 'dispatched', ticket: 'T-0001' });
    const ledgerPath = path.join(vaultDir, LEDGER_FILE);
    await waitFor(async () => ((await fsp.readFile(ledgerPath, 'utf8').catch(() => '')).match(/\n/g) ?? []).length >= 2);
    const text = await fsp.readFile(ledgerPath, 'utf8');
    const eventsRead = parseLedger(text);
    expect(eventsRead.map((event) => event.ticket)).toEqual(['T-0000', 'T-0001']);
    expect(text.trimEnd().endsWith('}')).toBe(true);
    expect(text.split('\n').filter((line) => line.trim() !== '')).toHaveLength(2);
  });

  it('swallows and logs a blocked write (EBUSY-shaped), never throws, and keeps writing', async () => {
    // `tickets` as a FILE: every mkdir/read beneath fails ENOTDIR —
    // the Windows-flavoured cousin of EBUSY on a locked file.
    await fsp.writeFile(path.join(vaultDir, 'tickets'), 'blocked', 'utf8');
    const events = writer();
    expect(() => events.ledger({ kind: 'dispatched', ticket: 'T-0001' })).not.toThrow();
    await waitFor(() => logs.length >= 1);
    expect(logs.every((line) => line.startsWith('event writer:') && line.includes('failed'))).toBe(true);

    // The mutex recovered: with the path usable again the next write lands.
    await fsp.rm(path.join(vaultDir, 'tickets'));
    events.ledger({ kind: 'dispatched', ticket: 'T-0002' });
    const ledgerPath = path.join(vaultDir, LEDGER_FILE);
    await waitFor(async () => parseLedger(await fsp.readFile(ledgerPath, 'utf8').catch(() => '')).length === 1);
  });
});
