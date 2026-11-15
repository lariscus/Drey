// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { PersonaView } from '../../shared/remote-protocol';
import type { DeskDeps } from '../board/desk-deps';
import { mountOneOnOnePane } from './one-on-one-pane';

const BEN = { id: 'ben', title: 'Ben' } as PersonaView;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A desk whose invoke answers from a script and records every call; `change()` is the desk's push. */
function desk(answers: Record<string, unknown>): { deps: DeskDeps; calls: [string, unknown][]; change: () => void } {
  const calls: [string, unknown][] = [];
  const listeners = new Set<() => void>();
  const deps = {
    api: { i18n },
    invoke: async (method: string, payload?: unknown) => {
      calls.push([method, payload]);
      return answers[method] ?? { ok: true, messages: [] };
    },
    subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
  } as unknown as DeskDeps;
  return { deps, calls, change: () => listeners.forEach((l) => l()) };
}

describe("the Crew tab's 1:1 pane (req-168)", () => {
  it('says so when the conversation is empty, and carries no note about the next run', async () => {
    const body = document.createElement('div');
    document.body.append(body);
    mountOneOnOnePane(desk({}).deps, BEN, body);
    await flush();
    expect(body.textContent).toContain('No messages yet');
    expect(body.textContent).not.toContain('next run');
    body.remove();
  });

  it("draws the owner's lines, the persona's answer, the held state and a pending card", async () => {
    const thread = {
      ok: true,
      messages: [
        { role: 'owner', text: 'Why did T-0007 fail?', at: '2026-11-09T10:01:00Z' },
        { role: 'persona', text: 'Three specs failed.', at: '2026-11-09T10:02:00Z' },
      ],
      proposals: [{ id: 'p-1', state: 'pending', summary: 'Name the date format', command: { kind: 'prompt', text: 'x' }, at: '2026-11-09T10:02:00Z', decidedAt: null, outcome: null }],
      session: 'held',
      releaseAt: '2026-11-09T10:17:00Z',
    };
    const body = document.createElement('div');
    document.body.append(body);
    const { deps, calls } = desk({ personaThread: thread, personaProposalDecide: { ...thread, proposals: [] } });
    mountOneOnOnePane(deps, BEN, body);
    await flush();
    expect([...body.querySelectorAll('.desk-msg-text')].map((n) => n.textContent)).toEqual(['Why did T-0007 fail?', 'Three specs failed.']);
    expect(body.querySelector('.desk-msg-me')?.textContent).toContain('Why did T-0007 fail?');
    expect(body.textContent).toContain('Session held until');
    expect(body.querySelector('.desk-card-title')?.textContent).toBe('Instructions');
    [...body.querySelectorAll<HTMLButtonElement>('.desk-card-actions button')].find((b) => b.textContent === 'Accept')!.click();
    await flush();
    expect(calls).toContainEqual(['personaProposalDecide', { persona: 'ben', id: 'p-1', decision: 'confirm' }]);
    body.remove();
  });

  it('sends a line, shows the answering state, and reads again on the desk push until the answer is there', async () => {
    const body = document.createElement('div');
    document.body.append(body);
    const answers: Record<string, unknown> = { personaThreadAppend: { ok: true, messages: [{ role: 'owner', text: 'Hi', at: 'a' }], session: 'answering' } };
    const { deps, calls, change } = desk(answers);
    mountOneOnOnePane(deps, BEN, body);
    await flush();
    body.querySelector<HTMLTextAreaElement>('textarea')!.value = 'Hi';
    [...body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Send')!.click();
    await flush();
    expect(calls).toContainEqual(['personaThreadAppend', { persona: 'ben', text: 'Hi' }]);
    expect(body.textContent).toContain('Ben is answering');
    answers['personaThread'] = { ok: true, messages: [{ role: 'owner', text: 'Hi', at: 'a' }, { role: 'persona', text: 'Hello.', at: 'b' }], session: 'held' };
    change();
    await flush();
    expect(body.textContent).toContain('Hello.');
    body.remove();
    change();
    await flush();
    expect(calls.filter(([m]) => m === 'personaThread')).toHaveLength(2);
  });

  it('shows a failed turn', async () => {
    const body = document.createElement('div');
    document.body.append(body);
    mountOneOnOnePane(desk({ personaThread: { ok: true, messages: [], failure: 'the runner is not running' } }).deps, BEN, body);
    await flush();
    expect(body.querySelector('.desk-note-error')?.textContent).toBe('Ben could not answer — the runner is not running');
    body.remove();
  });
});
