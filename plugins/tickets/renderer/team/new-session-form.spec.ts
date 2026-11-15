// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { DeskDeps } from '../board/desk-deps';
import { mountNewSessionForm } from './new-session-form';

const OPTIONS = {
  ok: true,
  personas: [
    { id: 'ben', title: 'Ben', worker: 'claude-code' },
    { id: 'tessa', title: 'Tessa', worker: 'opencode' },
  ],
  classes: ['A', 'B', 'C'],
  ticketsVault: 'E:/drey-tickets',
  repos: [{ name: 'drey', path: 'E:/drey' }],
  permissionMode: 'accept-edits',
  defaultPersona: 'ben',
};

function depsOf(calls: { method: string; payload: unknown }[], start: unknown): DeskDeps {
  return {
    api: { i18n },
    invoke: (method: string, payload?: unknown) => {
      calls.push({ method, payload });
      return Promise.resolve(method === 'sessionOptions' ? OPTIONS : start);
    },
  } as unknown as DeskDeps;
}

const controls = (node: HTMLElement): HTMLSelectElement[] => [...node.querySelectorAll('select')];
const startButton = (node: HTMLElement): HTMLButtonElement => [...node.querySelectorAll('button')].find((b) => b.textContent === 'Start')!;

describe('the Crew tab\'s New session form (req-173)', () => {
  it('offers the tickets repository first and starts a free session with the form\'s ask', async () => {
    const calls: { method: string; payload: unknown }[] = [];
    const done: string[] = [];
    const { node, ready } = mountNewSessionForm(depsOf(calls, { ok: true, runId: 'R-1' }), (id) => done.push(id), () => undefined);
    await ready;
    const [persona, folder, poolClass] = controls(node);
    expect([...folder!.options].map((o) => o.textContent)).toEqual(['Tickets repository · drey-tickets', 'drey']);
    expect([...poolClass!.options].map((o) => o.textContent)).toEqual(['Auto', 'A', 'B', 'C']);
    persona!.value = 'tessa';
    persona!.dispatchEvent(new Event('change'));
    startButton(node).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[1]).toEqual({ method: 'sessionStart', payload: { persona: 'tessa', directory: 'E:/drey-tickets', poolClass: null, permissionMode: 'accept-edits' } });
    expect(done).toEqual(['R-1']);
  });

  it('shows the engine\'s refusal in one line and stays open', async () => {
    const calls: { method: string; payload: unknown }[] = [];
    const done: string[] = [];
    const { node, ready } = mountNewSessionForm(depsOf(calls, { ok: false, error: 'folder is not allowed' }), (id) => done.push(id), () => undefined);
    await ready;
    startButton(node).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(node.querySelector('[role="alert"]')?.textContent).toBe('folder is not allowed');
    expect(done).toEqual([]);
  });

  it('starts in a typed folder in place of the list folder', async () => {
    const calls: { method: string; payload: unknown }[] = [];
    const { node, ready } = mountNewSessionForm(depsOf(calls, { ok: true, runId: 'R-2' }), () => undefined, () => undefined);
    await ready;
    const typed = node.querySelector<HTMLInputElement>('input')!;
    typed.value = 'E:/notes';
    typed.dispatchEvent(new Event('input'));
    startButton(node).click();
    await Promise.resolve();
    expect((calls[1]!.payload as { directory: string }).directory).toBe('E:/notes');
  });
});
