import { promises as fsp, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { planSectionOf } from '../core/plan-delta';
import { toDricketId } from '../store/ids';
import type { EngineBoardService } from './board-service';
import { openPersonaRig, probeDk, type PersonaRig } from './board-service-persona.fake';

/**
 * The board service over a REAL dk store on the lifecycle stages (the persona board), part two:
 * the flow editor (ticket, plan part and standard flow), the human persona's Accept / Send back and a
 * Mermaid plan whose fence must survive every write. Ported from the files-backend specs of req-307
 * step 3 (the header edits and the plan to accept are in `board-service-persona.spec.ts`).
 * Skipped, with the reason, when `dk` is missing or too old.
 */

const found = probeDk();
if (!found.ok) {
  console.warn(`[board service on the persona board, flow] SKIPPED: ${found.reason}`);
}

const DIAGRAM = ['```mermaid', 'flowchart TD', '  A[Capture] --> B{Dictation?}', '## Plan', '### Parts', '- [ ] Decoy part', '  persona: mallory', '## Verification', '- [x] `echo decoy`', '## Log', "- '2099-01-01T00:00:00Z' owner@host — decoy", '---', '```'].join('\n');
const PARTS = ['### Parts', '', '- [ ] Capture window', '  persona: ben', '  reason: small and isolated', '- [ ] Dictation hand-off', '  chain: ben; ralf(notify)', '- [ ] Tidy-up', '  persona: paul'].join('\n');
const PLAN = `Goal text.\n\n${PARTS}\n`;
const MERMAID_PLAN = ['### Goal', '', 'Capture by voice.', '', DIAGRAM, '', PARTS.replace('paul', 'ben')].join('\n');
const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

describe.skipIf(!found.ok)('flows and plans on the persona board (real dk)', { timeout: 240_000 }, () => {
  let rig: PersonaRig;
  let service: EngineBoardService;
  const content = (id: string): string => rig.content(id);
  const field = (id: string, key: string): string | null => rig.field(id, key);
  const writes: PersonaRig['writes'] = (id, call) => rig.writes(id, call);
  const capture = (title: string, description?: string): Promise<string> => rig.capture(title, description);
  const chained = (title: string, chain: string, at: number): string => rig.chained(title, chain, at);
  const meta = (rel: string): string => rig.meta(rel);

  beforeAll(async () => {
    rig = await openPersonaRig();
    service = rig.service;
  }, 120_000);

  afterAll(async () => {
    await rig?.close();
  });

  /** A captured ticket whose plan is `plan`. */
  async function planned(title: string, plan: string, description?: string): Promise<string> {
    const id = await capture(title, description);
    const reply = await service.setPlan({ id, plan });
    if (!reply.ok) {
      throw new Error(reply.error);
    }
    return id;
  }
  async function partsOf(id: string): Promise<Extract<Awaited<ReturnType<EngineBoardService['planParts']>>, { ok: true }>> {
    const reply = await service.planParts(id);
    if (!reply.ok) {
      throw new Error(reply.error);
    }
    return reply;
  }

  describe('the flow editor', () => {
    it('shows the positions from the current one on, with persona and owner marks', async () => {
      const id = chained('Flow', 'paul;ben;ralf;you', 2);
      const reply = await service.flowOf({ id, part: null });
      expect(reply.ok).toBe(true);
      if (!reply.ok) {
        return;
      }
      expect(reply.scope).toEqual({ kind: 'ticket' });
      expect(reply.saved).toEqual(['paul', 'ben', 'ralf', 'you']);
      expect(reply.steps.map((s) => [s.index, s.position, s.persona, s.state, s.owner, s.locked])).toEqual([
        [1, 2, 'ben', 'current', false, true],
        [2, 3, 'ralf', 'future', false, false],
        [3, 4, 'you', 'future', true, false],
      ]);
      expect(reply.personas.find((p) => p.id === 'you')).toMatchObject({ kind: 'human', model: '' });
      expect(reply.personas.find((p) => p.id === 'ben')).toMatchObject({ kind: 'agent' });
      expect(reply.readOnly).toBeNull();
    });

    it('edits a draft without writing and refuses a missing persona, the current position and a chain that does not parse', async () => {
      const id = chained('Draft', 'paul;ben;you', 2);
      const before = content(id);
      const edit = (chain: string[], op: Parameters<EngineBoardService['flowEdit']>[0]['edit']) => service.flowEdit({ id, part: null, chain, edit: op });
      const added = await edit(['paul', 'ben', 'you'], { op: 'insert', persona: 'ralf', after: 1 });
      expect(added.ok && added.chain).toEqual(['paul', 'ben', 'ralf', 'you']);
      const swapped = await edit(['paul', 'ben', 'ralf', 'you'], { op: 'persona', step: 2, persona: 'paul' });
      expect(swapped.ok && swapped.chain).toEqual(['paul', 'ben', 'paul', 'you']);
      const told = await edit(['paul', 'ben', 'paul', 'you'], { op: 'notify', step: 2, on: true });
      expect(told.ok && told.chain).toEqual(['paul', 'ben', 'paul(notify)', 'you']);
      expect(content(id)).toBe(before);
      expect(await edit(['paul', 'ben', 'you'], { op: 'persona', step: 2, persona: 'zed' })).toMatchObject({ ok: false });
      expect(await edit(['paul', 'ben', 'you'], { op: 'remove', step: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('the current step') });
      expect(await edit(['skip verify'], { op: 'view' })).toMatchObject({ ok: false, error: expect.stringContaining('not readable') });
    });

    it('save flow writes the ticket header through setChain, and refuses a draft that rewrites a finished position', async () => {
      const id = chained('Save flow', 'paul;ben;you', 2);
      const saved = await writes(id, () => service.saveFlow({ id, part: null, chain: ['paul', 'ben', 'ralf(notify)', 'you'] }));
      expect(saved).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(field(id, 'x-chain')).toBe('paul;ben;ralf(notify);you');
      expect(field(id, 'x-at')).toBe('2');
      expect(content(id)).toContain('chain paul; ben; ralf(notify); you');
      const reread = await service.flowOf({ id, part: null });
      expect(reread.ok && reread.saved).toEqual(['paul', 'ben', 'ralf(notify)', 'you']);
      expect(await service.saveFlow({ id, part: null, chain: [] })).toMatchObject({ ok: false, error: expect.stringContaining('position 1 (paul)') });
    });

    it("saves one part's flow into the part line of the parent's plan and keeps the other parts", async () => {
      const id = await planned('Part flow', PLAN);
      const flow = await service.flowOf({ id, part: 1 });
      expect(flow).toMatchObject({ ok: true, scope: { kind: 'part', index: 1, title: 'Dictation hand-off' }, saved: ['ben', 'ralf(notify)'] });
      const edited = await service.flowEdit({ id, part: 1, chain: ['ben', 'ralf(notify)'], edit: { op: 'insert', persona: 'paul', after: -1 } });
      expect(edited.ok && edited.chain).toEqual(['paul', 'ben', 'ralf(notify)']);
      const saved = await writes(id, () => service.saveFlow({ id, part: 1, chain: ['paul', 'ben', 'ralf(notify)'] }));
      expect(saved).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(content(id)).toContain('chain: paul; ben; ralf(notify)');
      expect((await partsOf(id)).parts.map((p) => p.persona)).toEqual(['ben', null, 'paul']);
      expect(await service.saveFlow({ id, part: 1, chain: ['zed'] })).toMatchObject({ ok: false, error: expect.stringContaining('does not exist') });
      expect(await service.flowOf({ id, part: 9 })).toEqual({ ok: false, error: 'no such part in this plan' });
      expect((await service.releasePlan({ id, scope: 'first' })).ok).toBe(true);
      const released = await service.flowOf({ id, part: 0 });
      expect(released.ok && released.readOnly).toContain('released as a ticket');
      expect(await service.saveFlow({ id, part: 0, chain: [] })).toMatchObject({ ok: false });
    });

    it("takes the plan's ### Chain as the ticket's chain when the plan is saved, and says why when it does not hold", async () => {
      const id = chained('Plan chain', 'paul;ben', 1);
      expect(await service.setPlan({ id, plan: 'Goal.\n\n### Chain\n\npaul; ben; ralf(notify)\n' })).toMatchObject({ ok: true });
      expect(field(id, 'x-chain')).toBe('paul;ben;ralf(notify)');
      expect(await service.setPlan({ id, plan: 'Goal.\n\n### Chain\n\npaul; zed\n' })).toMatchObject({ ok: true, warning: expect.stringContaining('persona "zed" does not exist') });
      expect(field(id, 'x-chain')).toBe('paul;ben;ralf(notify)');
    });

    it('edits the standard flow like a ticket flow and saves it into pipeline.md, keeping the rest of the file', async () => {
      const own = await capture('Keeps its own chain');
      const original = readFileSync(meta('pipeline.md'), 'utf8');
      try {
        const edited = await service.flowEdit({ id: 'standard', part: null, chain: ['paul:shape', 'ben', 'ralf'], edit: { op: 'notify', step: 2, on: true } });
        expect(edited.ok && edited.chain).toEqual(['paul:shape', 'ben', 'ralf(notify)']);
        expect(await service.saveFlow({ id: 'standard', part: null, chain: ['paul:shape', 'ben', 'ralf(notify)', 'you'] })).toMatchObject({ ok: true });
        const pipeline = readFileSync(meta('pipeline.md'), 'utf8');
        expect(pipeline).toContain('flow: paul:shape; ben; ralf(notify); you');
        expect(pipeline).toContain('{id: prioritized, title: Prioritized}');
        expect(pipeline).toContain('The pipeline of a persona board');
        expect((await service.snapshot()).flow?.map((e) => e.persona)).toEqual(['paul', 'ben', 'ralf', 'you']);
        const ticket = await service.flowOf({ id: own, part: null });
        expect(ticket.ok && ticket.saved).toEqual(['paul:shape', 'ben', 'ralf', 'tessa', 'you']); // copied at creation, not rewritten
      } finally {
        writeFileSync(meta('pipeline.md'), original);
      }
    });
  });

  describe("the human persona's turn", () => {
    it('Accept finishes the manual step: the cursor goes on, the park is gone, the thread says where it went', async () => {
      const id = chained('Accept', 'ben;you;ralf', 2);
      expect(await service.waitForOwner({ id, key: 'turn', text: 'ready for you', detail: 'details' })).toMatchObject({ ok: true });
      expect(field(id, 'x-awaiting')).toBe('you');
      expect(await writes(id, () => service.acceptTicket({ id }))).toMatchObject({ result: { ok: true }, puts: 1 });
      expect(field(id, 'x-awaiting')).toBeNull();
      expect(field(id, 'x-at')).toBe('3');
      expect((await service.ticketComments(id)).map((c) => c.text)).toContain('done: accepted at position 2 of 3 — position 3 next');
    });

    it('Send back returns to the previous agent position with the note, and the park is gone', async () => {
      const id = chained('Back', 'ben;you;ralf', 2);
      await service.waitForOwner({ id, key: 'turn', text: 'ready for you', detail: 'details' });
      expect(await service.sendBack({ id, note: 'The spacing is off' })).toMatchObject({ ok: true });
      expect(field(id, 'x-awaiting')).toBeNull();
      expect(field(id, 'x-at')).toBe('1');
      expect((await service.ticketComments(id)).map((c) => c.text)).toEqual(expect.arrayContaining(['sent back: The spacing is off', 'done: sent back to position 1 (ben): The spacing is off']));
    });

    it('the first flow read creates personas/you once, and a plain refresh leaves the vault alone', async () => {
      const id = await capture('Human');
      const file = meta('personas/you/persona.md');
      rmSync(path.dirname(file), { recursive: true, force: true });
      await service.refresh();
      await expect(fsp.access(file)).rejects.toBeDefined();
      await service.flowOf({ id, part: null });
      const created = readFileSync(file, 'utf8');
      expect(created).toContain('kind: human');
      expect(created).toContain('title: You');
      writeFileSync(file, created.replace('title: You', 'title: Henrik'));
      await service.flowOf({ id, part: null });
      expect(readFileSync(file, 'utf8')).toContain('title: Henrik');
      expect((await service.listPersonas()).find((p) => p.id === 'you')).toMatchObject({ kind: 'human', title: 'Henrik' });
    });
  });

  describe('a Mermaid plan', () => {
    it('the shape turn writes the plan, the approval screen sees only the real parts, the other writes leave the fence alone', async () => {
      const id = await capture('Voice capture', `Capture by voice.\n\n${DIAGRAM}`);
      expect((await service.setPlan({ id, plan: MERMAID_PLAN })).ok).toBe(true);
      expect(planSectionOf(content(id))).toBe(MERMAID_PLAN);
      expect(occurrences(content(id), DIAGRAM)).toBe(2); // the description's diagram and the plan's, both verbatim
      const reply = await partsOf(id);
      expect(reply.parts.map((p) => [p.title, p.persona])).toEqual([['Capture window', 'ben'], ['Dictation hand-off', null], ['Tidy-up', 'ben']]);
      expect(reply.personas.map((p) => p.id)).not.toContain('mallory');

      expect((await service.editPlanParts({ id, edit: { op: 'persona', index: 0, persona: 'paul' } })).ok).toBe(true);
      expect((await service.editPlanParts({ id, edit: { op: 'move', from: 2, to: 0 } })).ok).toBe(true);
      expect((await service.editPlanParts({ id, edit: { op: 'delete', index: 1 } })).ok).toBe(true);
      expect((await partsOf(id)).parts.map((p) => p.title)).toEqual(['Tidy-up', 'Dictation hand-off']);
      expect((await service.setPriority({ id, priority: 'high' })).ok).toBe(true);
      expect((await service.setChain({ id, chain: ['paul:shape', 'ben', 'you'] })).ok).toBe(true);
      const read = await service.readTicket(id);
      expect(read.ok).toBe(true);
      if (read.ok) {
        const refined = await service.refineTicket({ id, baseRevision: read.revision!, sections: { acceptance: '- [ ] `echo ok`' }, header: {} });
        expect(refined.ok).toBe(true);
      }
      expect(occurrences(content(id), DIAGRAM)).toBe(2);
      expect(content(id).indexOf('\n## Log\n', content(id).lastIndexOf('```'))).toBeGreaterThan(0);
    });

    it('a second shape reply replaces the whole plan chapter, diagram included, and the description keeps its own', async () => {
      const id = await capture('Voice again', `Capture by voice.\n\n${DIAGRAM}`);
      await service.setPlan({ id, plan: MERMAID_PLAN });
      const replacement = ['### Goal', '', 'Smaller.', '', DIAGRAM.replace('Capture', 'Record')].join('\n');
      expect((await service.setPlan({ id, plan: replacement })).ok).toBe(true);
      expect(planSectionOf(content(id))).toBe(replacement);
      expect(content(id)).toContain('A[Record]');
      expect(occurrences(content(id), 'A[Capture]')).toBe(1);
      expect((await partsOf(id)).parts).toEqual([]);
    });

    it('the release mints one ticket per real part and keeps the parent document intact', async () => {
      const id = await capture('Voice release', `Capture by voice.\n\n${DIAGRAM}`);
      await service.setPlan({ id, plan: MERMAID_PLAN });
      const reply = await service.releasePlan({ id, scope: 'all' });
      expect(reply.ok).toBe(true);
      if (!reply.ok) {
        return;
      }
      expect(reply.tickets).toHaveLength(3);
      expect(occurrences(content(id), DIAGRAM)).toBe(2);
      expect(planSectionOf(content(id))).toBe(MERMAID_PLAN);
      const titles = reply.tickets.map((t) => /^title: "?(.+?)"?$/m.exec(content(t))![1]);
      expect(titles).toEqual(['Capture window', 'Dictation hand-off', 'Tidy-up']);
      expect(reply.tickets.every((t) => field(t, 'parent') === toDricketId(id))).toBe(true);
    });
  });
});
