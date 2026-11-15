import { promises as fsp } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { FakeTicketStore } from '../lease/ticket-store.fake';
import { ticketCopyPathFor } from '../worktrees/worktree-home';
import { settled } from './run-spec-support';
import { buildRequest, endTurn, orderedHarness, startRun, useTempDirs, type Harness } from './supervisor-harness.fake';

/** D-30, E14-5c: the worker edits a copy of its store ticket; what it changed goes into the store inside the claim. */
describe('TicketCopy — the worker’s working copy of a store ticket', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => buildRequest(dirs.vault, over);
  const copyPath = (): string => ticketCopyPathFor(dirs.vault, 'T-0001');
  const setup = (): Harness & { readonly order: string[] } => orderedHarness(dirs.fleet, new FakeTicketStore());

  it('the worker gets a working copy of the ticket, and what it changed lands in the store before the release (D-30)', async () => {
    const t = setup();
    const id = await startRun(t.sup, request());
    expect(await fsp.readFile(copyPath(), 'utf8')).toBe(t.store.text);
    expect(t.order.indexOf('spawn')).toBeGreaterThan(t.order.indexOf('claim'));
    await fsp.writeFile(copyPath(), t.store.text.replace('## Log', '## Handover\n\nState: done\n\n## Log').replace('stage: prioritized', 'stage: done'), 'utf8');
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'done');
    expect(t.store.text).toContain('## Handover\n\nState: done');
    expect(t.store.text).not.toContain('stage: done'); // the worker's frontmatter does not count
    const ops = t.store.calls.map((c) => c.op);
    expect(ops.indexOf('put')).toBeLessThan(ops.lastIndexOf('release'));
    await expect(fsp.access(copyPath())).rejects.toThrow();
  });

  it('a plan run gates on the criteria the worker wrote into its copy (D-30, E14-5c)', async () => {
    const t = setup();
    const id = await startRun(t.sup, request({ gate: 'structural', acceptance: [] }));
    await fsp.writeFile(copyPath(), t.store.text.replace('## Log', '## Plan\n\n### Acceptance criteria\n\n- [ ] `echo ok`\n\n## Log'), 'utf8');
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'done');
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['prioritized']); // no cursor: a green end releases the ticket where it sat (req-307)
  });

  it('a stopped run still hands back what the worker wrote (D-30)', async () => {
    const t = setup();
    const id = await startRun(t.sup, request());
    await fsp.writeFile(copyPath(), t.store.text.replace('## Log', '## Handover\n\nState: blocked\n\n## Log'), 'utf8');
    await t.sup.stop(id, 'owner');
    await settled(t.sup, id, 'stopped');
    expect(t.store.text).toContain('State: blocked');
  });
});
