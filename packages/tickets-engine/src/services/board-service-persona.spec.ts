import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toDricketId } from '../store/ids';
import type { EngineBoardService } from './board-service';
import { openPersonaRig, probeDk, type PersonaRig } from './board-service-persona.fake';

/**
 * The board service's card mutations over a REAL dk store on the lifecycle stages (the persona board),
 * ported from the files-backend specs of req-307 step 3: the header edits (priority, class, chain,
 * blockers) and the plan to accept (parts, persona pick, release). Each write is ONE put (rev + 1) and
 * ONE commit on the tickets branch, and the board reads it again afterwards. The flow editor, the human
 * persona and the Mermaid fence cases are in `board-service-persona-flow.spec.ts`.
 * Skipped, with the reason, when `dk` is missing or too old.
 */

const found = probeDk();
if (!found.ok) {
  console.warn(`[board service on the persona board] SKIPPED: ${found.reason}`);
}

const PARTS = ['### Parts', '', '- [ ] Capture window', '  persona: ben', '  reason: small and isolated', '- [ ] Dictation hand-off', '  chain: ben; ralf(notify)', '- [ ] Tidy-up', '  persona: paul'].join('\n');
const PLAN = `Goal text.\n\n${PARTS}\n`;

describe.skipIf(!found.ok)('card mutations on the persona board (real dk)', { timeout: 240_000 }, () => {
  let rig: PersonaRig;
  let service: EngineBoardService;
  const content = (id: string): string => rig.content(id);
  const field = (id: string, key: string): string | null => rig.field(id, key);
  const writes: PersonaRig['writes'] = (id, call) => rig.writes(id, call);
  const capture = (title: string, description?: string): Promise<string> => rig.capture(title, description);
  const chained = (title: string, chain: string, at: number): string => rig.chained(title, chain, at);

  beforeAll(async () => {
    rig = await openPersonaRig();
    service = rig.service;
  }, 120_000);

  afterAll(async () => {
    await rig?.close();
  });

  /** The ticket re-read through the board: its card's meta as a refresh shows it. */
  async function reread(id: string): Promise<{ meta: Record<string, unknown> }> {
    const reply = await service.readTicket(id);
    if (!reply.ok) {
      throw new Error(reply.error);
    }
    return { meta: reply.card.meta as unknown as Record<string, unknown> };
  }

  describe('the header edits on a card', () => {
    it('setPriority writes one put and one commit, the board reads it again, a repeat and an unknown word write nothing', async () => {
      const id = await capture('Priority');
      const one = await writes(id, () => service.setPriority({ id, priority: 'urgent' }));
      expect(one).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(field(id, 'priority')).toBe('urgent');
      expect((await reread(id)).meta['priority']).toBe('urgent');
      expect(await writes(id, () => service.setPriority({ id, priority: 'urgent' }))).toMatchObject({ result: { ok: true }, puts: 0, commits: 0 });
      const refused = await writes(id, () => service.setPriority({ id, priority: 'p0' as never }));
      expect(refused).toMatchObject({ result: { ok: false, error: expect.stringContaining('unknown priority "p0"') }, puts: 0, commits: 0 });
      expect(await service.setPriority({ id: 'T-0999', priority: 'low' })).toEqual({ ok: false, error: 'T-0999 is not on the board' });
    });

    it('setClass pins the class with one put and a Log line, null drops it again, an unchanged pin writes nothing', async () => {
      const id = await capture('Class');
      expect(await writes(id, () => service.setClass({ id, class: null }))).toMatchObject({ result: { ok: true }, puts: 0 });
      const pinned = await writes(id, () => service.setClass({ id, class: 'heavy' }));
      expect(pinned).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(field(id, 'x-class')).toBe('heavy');
      expect(content(id)).toContain('— class heavy');
      expect((await reread(id)).meta['class']).toBe('heavy');
      expect(await writes(id, () => service.setClass({ id, class: 'heavy' }))).toMatchObject({ puts: 0 });
      expect(await writes(id, () => service.setClass({ id, class: null }))).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(field(id, 'x-class')).toBeNull();
      expect(await service.setClass({ id: 'T-0999', class: 'A' })).toEqual({ ok: false, error: 'T-0999 is not on the board' });
    });

    it('setChain writes the canonical entries, the cursor and the chain Log line in one put; an empty list is the standard flow', async () => {
      const id = await capture('Chain');
      const set = await writes(id, () => service.setChain({ id, chain: ['ben', ' ralf(notify) ', 'you'], actor: 'owner@test' }));
      expect(set).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(field(id, 'x-chain')).toBe('ben;ralf(notify);you');
      expect(field(id, 'x-at')).toBe('1');
      expect(content(id)).toMatch(/owner@test — chain ben; ralf\(notify\); you/);
      expect(content(id)).toContain('## Description');
      expect((await reread(id)).meta['chain']).toEqual([{ persona: 'ben', mode: null, notify: false }, { persona: 'ralf', mode: null, notify: true }, { persona: 'you', mode: null, notify: false }]);
      expect(await writes(id, () => service.setChain({ id, chain: ['ben', 'ralf(notify)', 'you'] }))).toMatchObject({ result: { ok: true }, puts: 0, commits: 0 });
      expect(await service.setChain({ id, chain: [] })).toEqual({ ok: true });
      expect(field(id, 'x-chain')).toBe('paul:shape;ben;ralf;tessa;you');
    });

    it('setChain refuses an unreadable entry, an unknown persona and a mode on the mission persona, and writes nothing', async () => {
      const id = await capture('Chain refusals');
      const before = content(id);
      expect(await service.setChain({ id, chain: ['skip verify'] })).toEqual({
        ok: false,
        error: 'chain entry "skip verify" is not readable — a chain lists personas, e.g. "paul:shape; paul; ben; ralf; tessa; you"',
      });
      expect(await service.setChain({ id, chain: ['ben', 'zed'] })).toEqual({ ok: false, error: 'position 2: persona "zed" does not exist' });
      expect(await service.setChain({ id, chain: ['ben', 'pia:shape', 'you'] })).toEqual({ ok: false, error: "position 2: only an agent persona's entry takes a mode — pia:shape" });
      expect(content(id)).toBe(before);
      expect((await service.setChain({ id, chain: ['pia', 'you'] })).ok).toBe(true);
      expect(await service.setChain({ id: 'T-0999', chain: ['ben'] })).toEqual({ ok: false, error: 'T-0999 is not on the board' });
    });

    it('setChain changes only the positions after the cursor', async () => {
      const id = chained('Cursor', 'ben;ralf;you', 2);
      expect(await service.setChain({ id, chain: ['ben', 'pia', 'you'] })).toEqual({ ok: false, error: 'position 2 (ralf) is the current step — only the positions after it can change' });
      expect(await writes(id, () => service.setChain({ id, chain: ['ben', 'ralf', 'tessa', 'you'] }))).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(field(id, 'x-at')).toBe('2');
    });

    it('setBlockedBy writes the whole list with one put and a Log line; an empty list clears it; the grammar is checked', async () => {
      const [a, b, id] = [await capture('Blocker A'), await capture('Blocker B'), await capture('Blocked')];
      const set = await writes(id, () => service.setBlockedBy({ id, blockedBy: [a, b], actor: 'owner@test' }));
      expect(set).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(content(id)).toMatch(/owner@test — blocked-by 2 ids/);
      expect((await reread(id)).meta['blockedBy']).toEqual([a, b]);
      expect(await writes(id, () => service.setBlockedBy({ id, blockedBy: [a, b] }))).toMatchObject({ result: { ok: true }, puts: 0, commits: 0 });
      const before = content(id);
      expect(await service.setBlockedBy({ id, blockedBy: ['T-1'] })).toEqual({ ok: false, error: 'blocked-by: "T-1" is not a ticket id' });
      expect(content(id)).toBe(before);
      expect(await writes(id, () => service.setBlockedBy({ id, blockedBy: [] }))).toMatchObject({ result: { ok: true }, puts: 1 });
      expect(content(id)).toMatch(/blocked-by none/);
      expect((await reread(id)).meta['blockedBy']).toEqual([]);
      expect(await service.setBlockedBy({ id: 'T-0999', blockedBy: [a] })).toEqual({ ok: false, error: 'T-0999 is not on the board' });
    });
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
  const cardCount = async (): Promise<number> => (await service.snapshot()).columns.flatMap((c) => c.tickets).length;

  describe('the plan to accept', () => {
    it('planParts answers one card per part with persona, flow and start rule, and the picker', async () => {
      const id = await planned('Voice', PLAN);
      const reply = await partsOf(id);
      expect(reply.gate).toBe('prioritized');
      expect(reply.parts.map((p) => [p.title, p.persona, p.state, p.locked, p.start])).toEqual([
        ['Capture window', 'ben', 'new', false, 'Runs now'],
        ['Dictation hand-off', null, 'new', false, 'After part 1'],
        ['Tidy-up', 'paul', 'new', false, 'After part 2'],
      ]);
      expect(reply.parts[0]!.flow.map((s) => s.persona)).toEqual(['paul', 'ben', 'ralf', 'tessa', 'you']); // no chain of its own: the standard flow
      expect(reply.parts[1]!.flow.map((s) => [s.persona, s.notify])).toEqual([['ben', false], ['ralf', true]]);
      expect(reply.personas.map((p) => p.id)).toEqual(expect.arrayContaining(['ben', 'paul', 'ralf']));
      expect(await service.planParts('T-0999')).toEqual({ ok: false, error: 'T-0999 is not on the board' });
    });

    it('editPlanParts picks a persona, moves and deletes, one put each, written into the plan', async () => {
      const id = await planned('Edits', PLAN);
      const pick = await writes(id, () => service.editPlanParts({ id, edit: { op: 'persona', index: 1, persona: 'ralf' } }));
      expect(pick).toMatchObject({ result: { ok: true }, puts: 1, commits: 1 });
      expect(await writes(id, () => service.editPlanParts({ id, edit: { op: 'move', from: 2, to: 0 } }))).toMatchObject({ puts: 1, commits: 1 });
      expect(content(id).indexOf('Tidy-up')).toBeLessThan(content(id).indexOf('Capture window'));
      expect(content(id)).toContain('persona: ralf');
      expect(await writes(id, () => service.editPlanParts({ id, edit: { op: 'delete', index: 0 } }))).toMatchObject({ puts: 1 });
      expect(content(id)).not.toContain('Tidy-up');
      expect(content(id)).toContain('Goal text.');
      expect((await partsOf(id)).parts.map((p) => p.title)).toEqual(['Capture window', 'Dictation hand-off']);
    });

    it('editPlanParts clears a pin, refuses an unknown persona, a split below two parts and positions that do not exist', async () => {
      const id = await planned('Refusals', PLAN);
      expect((await service.editPlanParts({ id, edit: { op: 'persona', index: 0, persona: null } })).ok).toBe(true);
      expect(content(id)).not.toMatch(/Capture window\n {2}persona: ben/);
      const before = content(id);
      expect((await service.editPlanParts({ id, edit: { op: 'persona', index: 0, persona: 'nobody' } })).ok).toBe(false);
      expect((await service.editPlanParts({ id, edit: { op: 'move', from: 0, to: 9 } })).ok).toBe(false);
      expect(content(id)).toBe(before);

      const two = await planned('Two parts', ['### Parts', '', '- [ ] One', '- [ ] Two'].join('\n'));
      expect(await service.editPlanParts({ id: two, edit: { op: 'delete', index: 1 } })).toEqual({ ok: false, error: 'A split needs two parts. Keep the plan as one ticket instead.' });
      const none = await planned('No parts', 'No parts here.');
      expect(await service.editPlanParts({ id: none, edit: { op: 'delete', index: 0 } })).toEqual({ ok: false, error: 'This plan has no parts to change.' });
    });

    it('releasePlan mints one ticket per part, children first, each waiting on the one before, the parent logs it', async () => {
      const id = await planned('Release', PLAN);
      const reply = await service.releasePlan({ id, scope: 'all' });
      expect(reply.ok).toBe(true);
      if (!reply.ok) {
        return;
      }
      const [first, second, third] = reply.tickets as [string, string, string];
      expect(reply.tickets).toHaveLength(3);
      expect([field(first, 'parent'), field(second, 'parent')]).toEqual([toDricketId(id), toDricketId(id)]);
      expect([field(first, 'stage'), field(second, 'stage'), field(third, 'stage')]).toEqual(['prioritized', 'prioritized', 'prioritized']);
      expect([field(first, 'x-persona'), field(third, 'x-persona')]).toEqual(['ben', 'paul']);
      expect(field(first, 'depends')).toBe('');
      expect(field(second, 'depends')).toBe(toDricketId(first));
      expect(field(third, 'depends')).toBe(toDricketId(second));
      expect(field(second, 'x-chain')).toBe('ben;ralf(notify)');
      expect(field(first, 'x-chain')).toBe('paul:shape;ben;ralf;tessa;you');
      expect(content(id)).toContain(`plan released: ${reply.tickets.join(', ')}`);
      const cards = (await service.snapshot()).columns.flatMap((c) => c.tickets);
      expect(cards.find((c) => c.id === first)!.blocked).toEqual([]);
      expect(cards.find((c) => c.id === second)!.blocked).toEqual([first]);
      const locked = await partsOf(id);
      expect(locked.parts.map((p) => [p.ticket, p.state, p.locked, p.start])).toEqual([
        [first, 'queued', true, `Released as ${first}`],
        [second, 'queued', true, `Released as ${second}`],
        [third, 'queued', true, `Released as ${third}`],
      ]);
      expect((await service.editPlanParts({ id, edit: { op: 'delete', index: 0 } })).ok).toBe(false);
      expect((await service.releasePlan({ id, scope: 'all' })).ok).toBe(false);
    });

    it('releasePlan "first" mints only part 1, nothing moves above it, a later release adds the rest behind it', async () => {
      const id = await planned('Release first', PLAN);
      const first = await service.releasePlan({ id, scope: 'first' });
      expect(first).toMatchObject({ ok: true, tickets: [expect.any(String)] });
      const head = (first as unknown as { tickets: string[] }).tickets[0]!;
      expect((await service.editPlanParts({ id, edit: { op: 'move', from: 1, to: 0 } })).ok).toBe(false);
      const rest = await service.releasePlan({ id, scope: 'all' });
      expect(rest).toMatchObject({ ok: true, tickets: [expect.any(String), expect.any(String)] });
      expect(field((rest as unknown as { tickets: string[] }).tickets[0]!, 'depends')).toBe(toDricketId(head));
    });

    it('releasePlan refuses a plan without parts, an unknown persona and a part chain naming one, and creates nothing', async () => {
      const [none, ghost, badChain] = [
        await planned('No parts', 'No parts.'),
        await planned('Ghost', ['### Parts', '', '- [ ] A', '  persona: ben', '- [ ] B', '  persona: ghost'].join('\n')),
        await planned('Bad chain', ['### Parts', '', '- [ ] A', '- [ ] B', '  chain: ben; ghost'].join('\n')),
      ];
      const count = await cardCount();
      expect(await service.releasePlan({ id: none, scope: 'all' })).toEqual({ ok: false, error: 'This plan has no parts to release.' });
      expect(await service.releasePlan({ id: ghost, scope: 'all' })).toMatchObject({ ok: false });
      expect(await service.releasePlan({ id: badChain, scope: 'all' })).toMatchObject({ ok: false });
      expect(await service.releasePlan({ id: 'T-0999', scope: 'all' })).toEqual({ ok: false, error: 'T-0999 is not on the board' });
      expect(await cardCount()).toBe(count);
    });
  });
});
