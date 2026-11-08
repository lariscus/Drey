import { describe, expect, it } from 'vitest';
import { parseKimiWire } from './kimi-usage';

/** The usage records of a Kimi session's wire log. */

describe('parseKimiWire', () => {
  it('reads the usage.record lines in order and skips the rest', () => {
    const wire = [
      '{"type":"metadata","protocol_version":"1.5"}',
      '{"type":"usage.record","agentId":"main","model":"zai-coding-plan/glm-5.3-flash","usage":{"inputOther":16734,"output":668,"inputCacheRead":0,"inputCacheCreation":0},"usageScope":"turn"}',
      '{"type":"context.append_loop_event","event":{"type":"step.end","usage":{"inputOther":1}}}',
      '{"type":"usage.record","model":"x","usage":{"inputOther":745,"output":165,"inputCacheRead":16704,"inputCacheCreation":2}}',
      '{"type":"usage.record","model":"x","usa',
    ].join('\n');
    expect(parseKimiWire(wire)).toEqual([
      { model: 'zai-coding-plan/glm-5.3-flash', inputOther: 16734, output: 668, cacheRead: 0, cacheCreation: 0 },
      { model: 'x', inputOther: 745, output: 165, cacheRead: 16704, cacheCreation: 2 },
    ]);
  });
});
