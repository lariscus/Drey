import { describe, expect, it } from 'vitest';
import { CostEstimate, type CostSubject } from './cost-estimate';
import type { SessionCost } from './ledgers';

const run = (ticketId: string, persona: string, model: string, costUsd: number | null, endedAt: string | null = '2026-11-09T10:00:00Z'): SessionCost => ({
  ticketId,
  persona,
  costUsd,
  startedAt: '2026-11-09T09:00:00Z',
  grant: { model },
  endedAt,
});

const RECORDS: SessionCost[] = [
  run('T-1', 'ben', 'sonnet', 0.4),
  run('T-1', 'ben', 'sonnet', 0.6),
  run('T-1', 'ben', 'opus', 2),
  run('T-2', 'ben', 'glm', 0.1),
  run('T-3', 'eva', 'glm', 0.3),
  run('T-4', 'eva', 'glm', 9, null), // still running: tells nothing yet
  run('T-5', 'eva', 'kimi', null),
];

describe("CostEstimate — the route line's est $ (req-178)", () => {
  const costs = new CostEstimate({ all: () => RECORDS });
  it.each<[string, CostSubject, number | null]>([
    ["the ticket's runs on the same model", { ticket: 'T-1', persona: 'ben', model: 'sonnet' }, 0.5],
    ["the ticket's runs on any model when it never ran this one", { ticket: 'T-1', persona: 'ben', model: 'glm' }, 0.6],
    ["the persona's runs on the model for a new ticket", { ticket: 'T-9', persona: 'ben', model: 'glm' }, 0.1],
    ["the model's runs for a new persona", { ticket: 'T-9', persona: 'max', model: 'glm' }, 0.2],
    ['no history: null, never invented', { ticket: 'T-9', persona: 'max', model: 'haiku' }, null],
  ])('%s', (_name, subject, expected) => {
    expect(costs.usdFor(subject)).toBe(expected);
  });
});
