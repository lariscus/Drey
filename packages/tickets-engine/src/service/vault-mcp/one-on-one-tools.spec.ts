import { describe, expect, it } from 'vitest';
import { ONE_ON_ONE_TOOLS } from '../../fleet/session/one-on-one-toolset';
import { OneOnOneVaultTools } from './one-on-one-tools';

/**
 * req-217: the seam answers what the spawn path will really attach — the
 * vault read tools — and nothing the 1:1 may not have.
 */
describe('OneOnOneVaultTools', () => {
  const tools = (listening = true, takesMcp?: (provider: string) => boolean) =>
    new OneOnOneVaultTools({ listening: () => listening, ...(takesMcp === undefined ? {} : { takesMcp }) });

  it('attaches exactly the three vault read tools when the endpoint listens', () => {
    expect(tools().attached({ persona: 'ben', provider: 'claude-code' })).toEqual(['vault_list', 'vault_search', 'vault_read']);
  });

  it('answers a subset of the 1:1 cut and never a tool that writes', () => {
    const names = tools().attached({ persona: 'ben', provider: 'kimi' });
    expect(names.every((name) => ONE_ON_ONE_TOOLS.includes(name))).toBe(true);
    expect(names.some((name) => /edit|write|move|delete|run|stop|steer/.test(name))).toBe(false);
  });

  it('attaches nothing while the vault MCP is not listening', () => {
    expect(tools(false).attached({ persona: 'ben', provider: 'claude-code' })).toEqual([]);
  });

  it('attaches nothing to a persona with no harness (the chat bridge)', () => {
    expect(tools().attached({ persona: 'ben', provider: null })).toEqual([]);
  });

  it('attaches nothing on a harness without an MCP launch', () => {
    expect(tools(true, (provider) => provider !== 'copilot').attached({ persona: 'ben', provider: 'copilot' })).toEqual([]);
  });
});
