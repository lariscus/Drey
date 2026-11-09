import { describe, expect, it } from 'vitest';
import type { ModelCapabilities, ModelNeeds } from '../protocol';
import { CapabilityFilter, tokensText } from './capability-filter';

const filter = new CapabilityFilter();
const VISION: ModelCapabilities = { input: ['text', 'image'], tools: true, context: 200_000, output: 32_000 };
const TEXT: ModelCapabilities = { input: ['text'], tools: true, context: 128_000, output: 8_000 };

describe('CapabilityFilter — a step\'s needs against the declared columns (req-178)', () => {
  it.each<[string, ModelCapabilities | null, ModelNeeds | null, number | null, string | null]>([
    ['no needs: any row', TEXT, null, null, null],
    ['no needs: even an undeclared row', {}, null, null, null],
    ['no needs: even an untabled model', null, null, null, null],
    ['image on a vision row', VISION, { image: true }, null, null],
    ['image on a text-only row', TEXT, { image: true }, null, 'no image input'],
    ['image on a row that declares no input', { tools: true }, { image: true }, null, 'image input not declared'],
    ['tools explicitly, declared', VISION, { tools: true }, null, null],
    ['tools explicitly, undeclared', { input: ['text'] }, { tools: true }, null, 'tool calls not declared'],
    ['a row without tool calls never runs a session', { tools: false }, null, null, 'no tool calls'],
    ['context large enough', VISION, { contextTokens: 200_000 }, null, null],
    ['context too small', TEXT, { contextTokens: 200_000 }, null, 'context 128k < 200k'],
    ["the request's own context size counts too", TEXT, null, 150_000, 'context 128k < 150k'],
    ['context not declared', { input: ['text'] }, { contextTokens: 100_000 }, null, 'context size not declared'],
    ['output too small', TEXT, { outputTokens: 16_000 }, null, 'output 8k < 16k'],
    ['an untabled model with needs', null, { image: true }, null, 'not in the model table, its capabilities are unknown'],
  ])('%s', (_name, row, needs, context, expected) => {
    expect(filter.refusal(row, needs, context)).toBe(expected);
  });

  it('writes token sizes short', () => {
    expect([tokensText(200_000), tokensText(1_000_000), tokensText(1_500_000), tokensText(512)]).toEqual(['200k', '1m', '1.5m', '512']);
  });
});
