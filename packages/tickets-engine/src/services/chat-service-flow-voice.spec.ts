import { describe, expect, it } from 'vitest';
import type { ChatBridge, ChatVoice } from '../contracts/chat';
import { ChatService } from './chat-service';
import type { ChatVoiceSource } from './chat-voices';

/**
 * req-272: a flow draft is asked of the persona of the ticket's plan entry
 * (else the shape persona). When there is none, no model is asked — the
 * answer says which persona to name. Nothing of the board or the vault is
 * touched by a draft, so the service here has stubs for both.
 */

function serviceWith(flowVoice: ChatVoice | null, seen: { voice?: ChatVoice; turns: number }): ChatService {
  const bridge = {
    runTurn: async (input: { voice?: ChatVoice }) => {
      seen.turns += 1;
      seen.voice = input.voice;
      return { say: 'Because.', thought: null, commands: [{ kind: 'setChain', id: 'T-0001', chain: ['ben'] }] };
    },
  } as unknown as ChatBridge;
  const voices: ChatVoiceSource = {
    shape: async () => ({ speaker: null, prompt: null, roster: '' }),
    flow: async () => flowVoice,
  };
  return new ChatService({ host: {} as never, board: {} as never, bridge, actor: 'owner@desk', onEvent: () => undefined, voices });
}

describe('a flow draft (req-272)', () => {
  it("is opened by the plan entry's voice and names that persona as its author", async () => {
    const seen: { voice?: ChatVoice; turns: number } = { turns: 0 };
    const voice = { speaker: 'Paula', prompt: '## Who Paula is', roster: '' };
    const draft = await serviceWith(voice, seen).draftFlow({ ticket: 'T-0001', context: 'ctx', ask: null });
    expect(seen.voice).toEqual(voice);
    expect(draft).toEqual({ ok: true, chain: ['ben'], reason: 'Because.', author: 'Paula' });
  });

  it('asks which persona to name instead of asking a model when no persona is assigned', async () => {
    const seen: { voice?: ChatVoice; turns: number } = { turns: 0 };
    const draft = await serviceWith(null, seen).draftFlow({ ticket: 'T-0001', context: 'ctx', ask: null });
    expect(seen.turns).toBe(0);
    expect(draft.ok).toBe(false);
    expect(draft.ok ? '' : draft.error).toContain('No persona is assigned to plan T-0001');
  });
});
