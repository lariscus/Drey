import { describe, expect, it } from 'vitest';
import { parseImprovements } from '../../core/improvements';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { RoundProposalWriter } from './round-proposal-writer';

const FILE = 'V:/vault/tickets/_meta/personas/ben/improvements.md';
const clock = { now: () => new Date('2026-11-09T12:00:00Z') };

describe('RoundProposalWriter (R11, req-169)', () => {
  it('adds an OPEN proposal for the 1:1 — never adopted — next to the existing ones', async () => {
    const fs = new MemoryFileSystem();
    fs.files.set(FILE, "# Improvements — ben\n\n- aggregate: '2026-11-01T00:00:00Z'\n\n- imp-4 dismissed models.default — Old\n  - proposed: '2026-11-01T00:00:00Z'\n  - content:\n      haiku\n");
    const id = await new RoundProposalWriter(clock, fs, () => undefined).add('V:/vault', 'ben', { target: 'models.default', title: 'Try opus on tests', content: 'opus' }, '2026-11-09T12:00:00Z · T-0102 · ben · claude-code/sonnet · gate red · $0.50');
    expect(id).toBe('imp-5');
    const file = parseImprovements(fs.files.get(FILE) as string);
    expect(file.lastAggregation).toBe('2026-11-01T00:00:00Z');
    expect(file.proposals.map((p) => [p.id, p.state])).toEqual([
      ['imp-4', 'dismissed'],
      ['imp-5', 'open'],
    ]);
    expect(file.proposals[1]).toMatchObject({ target: 'models.default', content: 'opus', evidence: ['2026-11-09T12:00:00Z · T-0102 · ben · claude-code/sonnet · gate red · $0.50'] });
  });
});
