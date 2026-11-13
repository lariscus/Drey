// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buttonOf, choose, cleanFixture, editor, fx, mount, patches, q, resetFixture, settle, stateText, type, typeInEditor } from './persona-page.harness';

beforeEach(resetFixture);
afterEach(cleanFixture);

describe('the Persona page v2: the prompt file, the proposals, the links and a failing load', () => {
  it('a missing prompt.md is an empty prompt and stays writable; an unreadable one locks the editor and Save', async () => {
    fx.prompt = { error: new Error("ENOENT: no such file or directory, open 'prompt.md'") };
    await mount();
    expect(editor().readOnly).toBe(false);
    expect(editor().text).toBe('');
    fx.dispose?.();
    fx.host.replaceChildren();
    fx.views = [];
    fx.prompt = { error: new Error('EISDIR: illegal operation on a directory') };
    await mount();
    expect(editor().readOnly).toBe(true);
    expect(buttonOf('Save').disabled).toBe(true);
    expect(stateText()).toBe('Could not read the instructions; nothing can be saved');
  });

  it('refuses to save over a prompt that changed on disk since it was read', async () => {
    await mount();
    typeInEditor('Mine');
    fx.prompt = { text: 'Someone else wrote this' };
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([]);
    expect(stateText()).toBe('The instructions changed on disk. Discard to load them.');
  });

  it('Apply on a prompt proposal rewrites the editor from the file; Dismiss only closes the card', async () => {
    await mount();
    fx.prompt = { text: 'Applied by the engine' };
    fx.proposals = [];
    buttonOf('Apply').click();
    await settle();
    expect(fx.invoked.find(([method]) => method === 'personaImprovementDecide')?.[1]).toEqual({ persona: 'ben', proposal: 'imp-1', decision: 'accepted' });
    expect(editor().text).toBe('Applied by the engine');
    expect(fx.host.querySelector('[data-proposal]')).toBeNull();
    expect(stateText()).toBe('Saved');
  });

  it('Apply waits while the instructions hold unsaved text; Show diff compares with the proposal', async () => {
    await mount();
    buttonOf('Show diff').click();
    expect(fx.showDiff).toHaveBeenCalledWith(expect.objectContaining({ before: '## Who Ben is\n\nCalm.', after: 'Suggested prompt' }));
    typeInEditor('Typed');
    await settle();
    expect(buttonOf('Apply').disabled).toBe(true);
  });

  it('Dismiss sends the decision and drops the card', async () => {
    await mount();
    fx.proposals = [];
    buttonOf('Dismiss').click();
    await settle();
    expect(fx.invoked.find(([method]) => method === 'personaImprovementDecide')?.[1]).toEqual({ persona: 'ben', proposal: 'imp-1', decision: 'dismissed' });
    expect(fx.host.querySelector('[data-proposal]')).toBeNull();
  });

  it('the links switch the page to its Memory and 1:1 tabs; Back goes to Crew', async () => {
    await mount();
    buttonOf('Memory · 3 →').click();
    expect(q('[data-tab="memory"]').getAttribute('aria-selected')).toBe('true');
    buttonOf('Instructions').click();
    buttonOf('Talk to Ben 1:1 →').click();
    expect(q('[data-tab="talk"]').getAttribute('aria-selected')).toBe('true');
    buttonOf('Back to Crew').click();
    expect(fx.backs).toBe(1);
  });

  it('a load that fails shows why and tries again by itself: the engine may be restarting', async () => {
    fx.failLoads = 1;
    const real = globalThis.setTimeout;
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void, delay?: number) => {
      delays.push(delay ?? 0);
      return real(run, (delay ?? 0) > 0 ? 1 : 0);
    }) as typeof setTimeout);
    await mount();
    await settle();
    spy.mockRestore();
    expect(delays).toContain(2_000);
    expect(editor().text).toBe('## Who Ben is\n\nCalm.');
  });

  it('keeps the error on screen while the engine stays away, and stops trying once closed', async () => {
    fx.failLoads = 1000;
    await mount();
    expect(q('.persona-note').textContent).toBe('fetch failed');
    expect(fx.views).toEqual([]);
    const calls = fx.invoked.length;
    fx.dispose?.();
    fx.dispose = null;
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(fx.invoked.length).toBe(calls);
    fx.failLoads = 0;
  });
});
