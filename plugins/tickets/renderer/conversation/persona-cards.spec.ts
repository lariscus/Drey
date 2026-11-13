import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import { personaCardsOf, type PersonaCard, type PersonaCardFormat } from '../../../../shared/persona-cards';
import { personaCardMessageOf } from './map';
import type { PersonaCardsBinding } from './persona-cards';
import { createConversationProvider, MISSION_CONTROL_TARGET, type ConversationDeps } from './targets';

const f: PersonaCardFormat = { t: (key, params) => i18n.t(key, params), time: () => '14:05', money: (n: number) => `$${n.toFixed(2)}` };
const lanes = [
  { persona: 'paul', title: 'Paul', color: '' },
  { persona: 'ben', title: 'Ben', color: '#8ecbef' },
  { persona: 'you', title: 'You', color: '' },
];
const hold = { holder: 'ghost', why: 'no-persona', position: 2, length: 3, chain: ['paul', 'ghost', 'you'], named: null, sentBack: null };
const CARDS: readonly PersonaCard[] = personaCardsOf({ lanes, needs: [], tickets: [{ id: 'T-0127', title: 'Theme picker', cost: null, hold }] }, f, new Date());
const CARD = CARDS[0]!;

function provider(over: Partial<PersonaCardsBinding> = {}) {
  const binding: PersonaCardsBinding = {
    cards: () => CARDS,
    agents: () => [{ persona: 'paul', title: 'Paul' }, { persona: 'ben', title: 'Ben' }],
    act: vi.fn(async () => null),
    assign: vi.fn(async () => null),
    subscribe: () => () => undefined,
    ...over,
  };
  const deps: ConversationDeps = {
    invoke: (method) => Promise.resolve(method === 'mcSessions' ? [] : { ok: true, messages: [] }),
    personas: () => [],
    subscribePersonas: () => () => undefined,
    personaCards: binding,
  };
  const target = createConversationProvider(deps).targets().find((t) => t.id === MISSION_CONTROL_TARGET)!;
  return { target, binding };
}

describe('the persona board cards in the Mission Control conversation (req-273)', () => {
  it('maps a card to title with dot, chain and position as chips, and its buttons', () => {
    const message = personaCardMessageOf(CARD, null);
    const card = message.cards![0]!;
    expect(card.title).toBe('T-0127 · no persona for position 2');
    expect(card.dot).toBe('attention');
    expect(card.text).toBe('Theme picker');
    expect(card.chips).toEqual(['PA ·· YO', 'Position 2 of 3']);
    expect(card.actions!.map((a) => [a.label, a.tone])).toEqual([['Assign…', 'primary'], ['Do it myself', 'quiet']]);
    expect(card.meta).toBe('Mission Control · 14:05');
  });

  it('adds one button per agent while the Assign… picker is open', () => {
    const card = personaCardMessageOf(CARD, [{ persona: 'ben', title: 'Ben' }]).cards![0]!;
    expect(card.actions!.map((a) => a.id)).toEqual(['0', '1', 'assign:ben']);
  });

  it('ends the thread with the cards; Assign… opens the picker and a pick hands the ticket over', async () => {
    const { target, binding } = provider();
    const thread = await target.thread();
    expect(thread.messages.at(-1)?.cards?.[0]?.id).toBe(CARD.id);
    const opened = await target.act!(CARD.id, '0');
    expect(opened.messages.at(-1)?.cards?.[0]?.actions?.map((a) => a.label)).toEqual(['Assign…', 'Do it myself', 'Paul', 'Ben']);
    await target.act!(CARD.id, 'assign:ben');
    expect(binding.assign).toHaveBeenCalledWith(CARD, 'ben');
  });

  it('runs the card\'s own button through the binding and shows a refusal in the thread', async () => {
    const { target, binding } = provider({ act: vi.fn(async () => 'running at Ben') });
    const thread = await target.act!(CARD.id, '1');
    expect(binding.act).toHaveBeenCalledWith(CARD, expect.objectContaining({ id: 'do_myself' }));
    expect(thread.messages.some((m) => m.error?.lines.includes('running at Ben'))).toBe(true);
  });
});
