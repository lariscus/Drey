import { describe, expect, it } from 'vitest';
import { composeRunRequest } from './request';
import { base, phase } from './request-spec-support';

/** req-142 (ADR-0099): the persona's `allowed: run-commands` and `network` as the run request carries them. */
describe("a persona's Allowed to on its run", () => {
  const PIA = { id: 'pia', worker: 'claude-code', model: 'sonnet', prompt: 'You are Pia.', memory: '' };
  const compose = (allowed: { runCommands?: 'accept-edits' | 'bypass'; network: boolean } | undefined, over: Parameters<typeof base>[0] = {}) => {
    const result = composeRunRequest(base({ workingPhase: phase('build'), persona: { ...PIA, ...(allowed !== undefined ? { allowed } : {}) }, ...over }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.request;
  };

  it("the persona's run-commands beats the crew's permission mode", () => {
    expect(compose({ runCommands: 'bypass', network: true }, { permissionMode: 'accept-edits' }).permissionMode).toBe('bypass');
    expect(compose({ runCommands: 'accept-edits', network: true }, { permissionMode: 'bypass' }).permissionMode).toBe('accept-edits');
  });

  it("without run-commands the crew's mode stands", () => {
    expect(compose({ network: true }, { permissionMode: 'bypass' }).permissionMode).toBe('bypass');
    expect(compose(undefined, { permissionMode: 'accept-edits' }).permissionMode).toBe('accept-edits');
  });

  it('a persona without network: true runs with the network off; with it, or without a persona record, the key is absent', () => {
    expect(compose({ network: false }).network).toBe(false);
    expect('network' in compose({ network: true })).toBe(false);
    expect('network' in compose(undefined)).toBe(false);
  });
});

