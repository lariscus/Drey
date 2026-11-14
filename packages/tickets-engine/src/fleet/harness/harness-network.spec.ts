import { describe, expect, it } from 'vitest';
import type { ProviderStart } from './contract';
import { KIMI_NO_NETWORK_SWITCH_NOTE, kimiHarness } from './kimi';
import { opencodeHarness } from './opencode';
import { OPENCODE_RULES_NOTE, opencodeLaunchConfig, opencodePermissionConfig } from './opencode-settings';

const start = (over: Partial<ProviderStart> = {}): ProviderStart => ({
  cwd: 'W:/kt',
  instruction: 'Do it.',
  model: null,
  permissionMode: 'accept-edits',
  resumeRef: null,
  ticketId: 'T-1',
  onEvent: () => undefined,
  onSessionRef: () => undefined,
  ...over,
});

/** req-142 (ADR-0099): the persona's network switch and permission mode on the two ACP harnesses that cannot enforce them for certain. */
describe('the network switch on opencode and Kimi', () => {
  it('opencode asks for its web tools denied and, in bypass, every other tool allowed', () => {
    expect(opencodePermissionConfig({ permissionMode: 'accept-edits' })).toBeNull();
    expect(opencodePermissionConfig({ permissionMode: 'accept-edits', network: false })).toEqual({ webfetch: 'deny', websearch: 'deny' });
    expect(opencodePermissionConfig({ permissionMode: 'bypass', network: false })).toEqual({ '*': 'allow', webfetch: 'deny', websearch: 'deny' });
  });

  it('opencode merges the rules with the context cap into one inline config and says the rules are not proven', () => {
    const config = opencodeLaunchConfig({ model: 'zai/glm-5', contextCap: 100_000, permissionMode: 'accept-edits', network: false });
    expect(JSON.parse(config.content!)).toEqual({
      provider: { zai: { models: { 'glm-5': { limit: { context: 100_000, output: 25_000 } } } } },
      permission: { webfetch: 'deny', websearch: 'deny' },
    });
    expect(config.notes).toEqual(['context cap: 100000 tokens — OpenCode compacts the session there', OPENCODE_RULES_NOTE]);
    expect(opencodeLaunchConfig({ model: null, permissionMode: 'accept-edits' })).toEqual({ content: null, notes: [] });
  });

  it("opencode's launch carries the config in its environment and the note for the run's stream", () => {
    const launch = opencodeHarness().launch(start({ network: false }));
    expect(launch.env?.['OPENCODE_CONFIG_CONTENT']).toBe(JSON.stringify({ permission: { webfetch: 'deny', websearch: 'deny' } }));
    expect(launch.note).toBe(OPENCODE_RULES_NOTE);
    expect(opencodeHarness().launch(start())).toEqual({ command: 'opencode', args: ['acp'] });
  });

  it('Kimi cannot switch the network per run and says so in the stream', () => {
    const harness = kimiHarness(async () => []);
    expect(harness.launch(start({ network: false }))).toEqual({ command: 'kimi', args: ['acp'], note: KIMI_NO_NETWORK_SWITCH_NOTE });
    expect(harness.launch(start())).toEqual({ command: 'kimi', args: ['acp'] });
  });
});
