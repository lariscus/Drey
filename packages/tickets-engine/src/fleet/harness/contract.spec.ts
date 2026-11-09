import { afterEach, describe, expect, it } from 'vitest';
import type { NormalizedEvent } from './contract';
import { claudeCodeDriver, copilotDriver, fakeDriver, kimiDriver, opencodeDriver, type ContractDriver } from './contract-drivers.fake';

/**
 * The harness contract (ADR-0096, req-176 step 3): what the runner relies
 * on from every coding-agent adapter — and from the fake the supervisor
 * specs can build on. One suite, five subjects: Claude Code (stream-json),
 * and over the one ACP adapter (req-182) opencode, Kimi and Copilot CLI,
 * plus the fake harness. The four capabilities — interrupt, resume,
 * permissions, questions — are asserted per driver; Claude Code's headless
 * stream-json hands the runner no permission request and no question form
 * (its questions are the `QUESTION:` marker), and the suite says so.
 */

const KINDS = new Set(['note', 'text', 'usage', 'result', 'error', 'tool', 'text-delta']);

/** The last wait of a kind the worker reported. */
const lastWait = (events: readonly NormalizedEvent[], kind: 'permission' | 'question'): NormalizedEvent['waiting'] =>
  [...events].reverse().find((e) => e.waiting?.kind === kind)?.waiting;

describe.each<ContractDriver>([claudeCodeDriver, opencodeDriver, kimiDriver, copilotDriver, fakeDriver])('the harness contract: $name', (driver) => {
  afterEach(() => driver.dispose());

  it('a finished turn reports its result and ends the worker', async () => {
    const s = await driver.start();
    await s.endTurn('All done.');
    await s.settle();
    const result = s.events.find((e) => e.kind === 'result');
    expect(result?.text).toBe('All done.');
    expect(result?.blocked ?? null).toBeNull();
    expect(s.ended()).toBe(true);
  });

  it('a turn that ends BLOCKED: reports why, on the result', async () => {
    const s = await driver.start();
    await s.endTurn('Could not finish.\nBLOCKED: the spec needs a decision');
    await s.settle();
    expect(s.events.find((e) => e.kind === 'result')?.blocked).toBe('the spec needs a decision');
  });

  it('a turn that asks QUESTION: stands for the owner; the answer goes on, the next finished turn ends it', async () => {
    const s = await driver.start();
    await s.endTurn('QUESTION: which branch?');
    await s.settle();
    expect(s.events.some((e) => e.waiting?.kind === 'question' && e.waiting.text === 'which branch?')).toBe(true);
    expect(s.events.some((e) => e.kind === 'result')).toBe(false);
    expect(s.ended()).toBe(false);
    expect(await s.handle.steer('main')).toBe('inject');
    expect(s.events.some((e) => e.waiting === null)).toBe(true);
    await s.endTurn('Done on main.');
    await s.settle();
    expect(s.ended()).toBe(true);
  });

  it('a held worker outlives its finished turn; handing it back ends it', async () => {
    const s = await driver.start();
    s.handle.setHold?.(true);
    await s.endTurn('Done, but the owner holds me.');
    await s.settle();
    expect(s.ended()).toBe(false);
    s.handle.setHold?.(false);
    await s.settle();
    expect(s.ended()).toBe(true);
  });

  it('interrupt stops a running turn and keeps the worker', async () => {
    const s = await driver.start();
    expect(await s.handle.interrupt?.()).toBe(true);
    await s.settle();
    expect(s.ended()).toBe(false);
    await s.handle.stop();
  });

  it('resume: a start with an earlier session opens that session', async () => {
    const s = await driver.start({ resumeRef: 'ses_prev' });
    await s.settle();
    expect(s.resumed()).toBe('ses_prev');
    await s.handle.stop();
  });

  it('permissions: the harness asks, the owner sees the wait, the answer reaches the harness', async () => {
    const s = await driver.start();
    if (driver.answers === null || s.askPermission === undefined) {
      if (driver.name === 'claude-code') {
        expect(s.handle.answerPermission).toBeUndefined();
      }
      return s.handle.stop();
    }
    await s.askPermission();
    const wait = lastWait(s.events, 'permission');
    expect(wait?.requestId).toBeDefined();
    expect(await s.handle.answerPermission!(wait!.requestId!, 'once')).toBe(true);
    expect(s.reply('perm-1')).toEqual(driver.answers.permission);
    expect(s.events.at(-1)?.waiting).toBeNull();
    expect(await s.handle.answerPermission!(wait!.requestId!, 'once')).toBe(false);
    await s.handle.stop();
  });

  it("questions: the harness's question tool stands for the owner; the answer goes back as its answer", async () => {
    const s = await driver.start();
    if (driver.answers === null || s.askQuestion === undefined) {
      if (driver.name === 'claude-code') {
        expect(s.handle.answerQuestion).toBeUndefined();
      }
      return s.handle.stop();
    }
    await s.askQuestion();
    const wait = lastWait(s.events, 'question');
    expect(wait?.questions?.[0]?.options.map((o) => o.label)).toEqual(['Red', 'Blue']);
    expect(await s.handle.answerQuestion!(wait!.requestId!, { q0: 'Blue' })).toBe(true);
    expect(s.reply('q-1')).toEqual(driver.answers.question);
    expect(s.events.at(-1)?.waiting).toBeNull();
    await s.handle.stop();
  });

  it('stop ends the worker; a steer after the end is refused', async () => {
    const s = await driver.start();
    await s.handle.stop();
    await s.settle();
    expect(s.ended()).toBe(true);
    expect(await s.handle.steer('anyone there?')).toBe('refused');
  });

  it('a read-only start (req-183, a review) reaches the harness as its read-only mode', async () => {
    const s = await driver.start({ permissionMode: 'read-only' });
    await s.settle();
    expect(s.permission()).toBe(driver.readOnly);
    await s.handle.stop();
  });

  it('every event is stamped and of a known kind', async () => {
    const s = await driver.start();
    await s.endTurn('All done.');
    await s.settle();
    expect(s.events.length).toBeGreaterThan(0);
    for (const event of s.events) {
      expect(typeof event.ts).toBe('string');
      expect(KINDS.has(event.kind)).toBe(true);
    }
  });
});
