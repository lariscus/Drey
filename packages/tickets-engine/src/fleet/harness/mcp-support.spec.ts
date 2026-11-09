import { describe, expect, it } from 'vitest';
import type { SpawnFn } from '../ports/process-spawner';
import type { WorkerProviderId } from '../protocol';
import { claudeCodeAdapter } from './claude-code';
import type { ProviderAdapter } from './contract';
import { copilotAdapter } from './copilot';
import { kimiAdapter } from './kimi';
import { harnessTakesMcp, MCP_HARNESSES } from './mcp-support';
import { opencodeAdapter } from './opencode';

const never: SpawnFn = () => {
  throw new Error('no process in this spec');
};

/** req-217: the list the 1:1's brief reads equals what the adapters really carry. */
describe('MCP_HARNESSES', () => {
  const adapters: Record<WorkerProviderId, ProviderAdapter> = {
    'claude-code': claudeCodeAdapter(never),
    opencode: opencodeAdapter(never),
    kimi: kimiAdapter(never),
    copilot: copilotAdapter(never),
  };

  it('names exactly the providers whose adapter describes an MCP launch', () => {
    const carrying = (Object.keys(adapters) as WorkerProviderId[]).filter((id) => adapters[id].mcpLaunch !== undefined);
    expect([...MCP_HARNESSES].sort()).toEqual([...carrying].sort());
    expect(carrying).toHaveLength(4);
  });

  it('answers per provider', () => {
    expect(harnessTakesMcp('claude-code')).toBe(true);
    expect(harnessTakesMcp('kimi')).toBe(true);
  });
});
