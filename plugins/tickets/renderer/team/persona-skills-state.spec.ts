import { describe, expect, it, vi } from 'vitest';
import type { SkillListData } from '../../../../packages/tickets-engine/src/contracts/skills';
import type { PersonaSkillsSeam, SkillsResult } from './persona-seams';
import { PersonaSkillsState } from './persona-skills-state';

const list = (selectedTokens: number): SkillListData => ({ persona: 'ben', skills: [], missing: [], selectedTokens, tokenizer: { id: 'claude-estimate', family: 'anthropic', exact: false, model: null } });

function seamOf(answers: SkillsResult[]): PersonaSkillsSeam & { calls: string[] } {
  const calls: string[] = [];
  const next = async (label: string): Promise<SkillsResult> => {
    calls.push(label);
    return answers.shift() ?? { ok: true, list: list(0) };
  };
  return {
    calls,
    list: (persona) => next(`list ${persona}`),
    toggle: (persona, skill, on) => next(`toggle ${persona} ${skill} ${on}`),
    remove: (persona, name) => next(`remove ${persona} ${name}`),
    upload: async (command) => {
      calls.push(`upload ${command.scope} ${command.persona}`);
      return { ok: true, name: 'x', replaced: false, list: list(7) };
    },
  };
}

describe('PersonaSkillsState (req-237)', () => {
  it('keeps the listing of the last answer and tells its listeners at the start and the end of a call', async () => {
    const seam = seamOf([
      { ok: true, list: list(1) },
      { ok: true, list: list(2) },
    ]);
    const state = new PersonaSkillsState(seam, 'ben');
    const seen: boolean[] = [];
    state.subscribe(() => seen.push(state.busy));
    await state.load();
    expect(state.list?.selectedTokens).toBe(1);
    await state.toggle('tdd', false);
    expect(state.list?.selectedTokens).toBe(2);
    expect(seen).toEqual([true, false, true, false]);
    expect(seam.calls).toEqual(['list ben', 'toggle ben tdd false']);
  });

  it('keeps the old listing on a failure and clears the failure with the next call', async () => {
    const state = new PersonaSkillsState(
      seamOf([
        { ok: true, list: list(1) },
        { ok: false, code: 'no_skill', error: 'x' },
        { ok: true, list: list(3) },
      ]),
      'ben',
    );
    await state.load();
    await state.toggle('ghost', true);
    expect(state.failure).toMatchObject({ code: 'no_skill' });
    expect(state.list?.selectedTokens).toBe(1);
    await state.remove('tdd');
    expect(state.failure).toBeNull();
    expect(state.list?.selectedTokens).toBe(3);
  });

  it('runs one call at a time and uploads into the persona’s own folder', async () => {
    const seam = seamOf([]);
    const state = new PersonaSkillsState(seam, 'ben');
    const first = state.toggle('a', true);
    await state.toggle('b', true); // ignored while the first runs
    await first;
    await state.upload({ format: 'markdown', text: 'x' });
    expect(seam.calls).toEqual(['toggle ben a true', 'upload own ben']);
    expect(state.list?.selectedTokens).toBe(7);
  });

  it('shows a failure of its own without a call, and a listener can leave', () => {
    const state = new PersonaSkillsState(seamOf([]), 'ben');
    const hear = vi.fn();
    const off = state.subscribe(hear);
    state.fail({ ok: false, code: 'too_large', error: 'big' });
    off();
    state.fail({ ok: false, code: null, error: 'again' });
    expect(hear).toHaveBeenCalledTimes(1);
    expect(state.failure?.error).toBe('again');
  });
});
