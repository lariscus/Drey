import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import { PersonaDeleteAsk } from './persona-delete-state';
import { failureOf, refusalText } from './persona-delete-text';

function ask(reply: unknown = { ok: true, persona: 'ben', files: 3 }): { ask: PersonaDeleteAsk; remove: ReturnType<typeof vi.fn> } {
  const remove = vi.fn(async () => reply);
  return { ask: new PersonaDeleteAsk({ i18n, name: 'Ben', remove }), remove };
}

describe('PersonaDeleteAsk', () => {
  it.each([['ben'], ['BEN'], [' Ben'], ['Ben '], ['Be'], ['Ben Ben'], ['']])('does not enable Delete for %j', (typed) => {
    const { ask: state } = ask();
    state.type(typed);
    expect(state.canDelete()).toBe(false);
  });

  it('enables Delete for the exact title only', () => {
    const { ask: state } = ask();
    state.type('Ben');
    expect(state.canDelete()).toBe(true);
  });

  it('never sends a removal while the text is not the title, and sends the typed text when it is', async () => {
    const { ask: state, remove } = ask();
    state.type('ben');
    expect(await state.submit()).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    state.type('Ben');
    expect(await state.submit()).toBe(true);
    expect(remove).toHaveBeenCalledWith('Ben');
  });

  it("keeps the engine's refusal in words, and typing again clears it", async () => {
    const { ask: state } = ask({ ok: false, code: 'busy', error: 'busy' });
    state.type('Ben');
    expect(await state.submit()).toBe(false);
    expect(state.refused).toBe('Ben has a run or a 1:1 open. Stop it first.');
    state.type('Ben ');
    expect(state.refused).toBe('');
  });

  it("shows a transport failure's own text and stays usable", async () => {
    const state = new PersonaDeleteAsk({ i18n, name: 'Ben', remove: async () => Promise.reject(new Error('fetch failed')) });
    state.type('Ben');
    expect(await state.submit()).toBe(false);
    expect(state.refused).toBe('fetch failed');
    expect(state.busy).toBe(false);
    expect(state.canDelete()).toBe(true);
  });

  it('is busy while the engine answers, and cannot be submitted twice', async () => {
    let release: (reply: unknown) => void = () => undefined;
    const remove = vi.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    const state = new PersonaDeleteAsk({ i18n, name: 'Ben', remove });
    const seen: boolean[] = [];
    state.subscribe(() => seen.push(state.busy));
    state.type('Ben');
    const first = state.submit();
    expect(state.busy).toBe(true);
    expect(state.canDelete()).toBe(false);
    expect(await state.submit()).toBe(false);
    release({ ok: true });
    expect(await first).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    expect(state.busy).toBe(false);
    expect(seen).toContain(true);
  });
});

describe('refusalText', () => {
  const text = (reply: unknown): string => refusalText(i18n, 'Ben', failureOf(reply)!);

  it('has a line for every code the engine answers', () => {
    expect(text({ ok: false, code: 'human', error: 'x' })).toBe('Your own persona cannot be deleted.');
    expect(text({ ok: false, code: 'confirm', error: 'x' })).toBe('That is not the name.');
    expect(text({ ok: false, code: 'no_persona', error: 'x' })).toBe('That persona does not exist any more.');
    expect(text({ ok: false, code: 'internal', error: 'x' })).toBe('The persona could not be deleted.');
  });

  it("shows the engine's English for a code this build does not know, and the generic line for none", () => {
    expect(text({ ok: false, code: 'from_the_future', error: 'the engine said so' })).toBe('the engine said so');
    expect(text({ ok: false })).toBe('The persona could not be deleted.');
    expect(failureOf({ ok: true })).toBeNull();
  });
});
