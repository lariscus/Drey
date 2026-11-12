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

  it('a prompt.md proposal stores the current prompt with its edits applied; edits that do not apply write nothing (req-280)', async () => {
    const fs = new MemoryFileSystem();
    const prompt = 'V:/vault/tickets/_meta/personas/ben/prompt.md';
    fs.files.set(prompt, '## Who Ben is\n\nBen builds.\n');
    const logs: string[] = [];
    const writer = new RoundProposalWriter(clock, fs, (line) => logs.push(line));
    const id = await writer.add('V:/vault', 'ben', { target: 'prompt.md', title: 'Run the gate first', content: '', edits: [{ old: 'Ben builds.', new: 'Ben builds and runs the gate first.' }] }, 'evidence');
    expect(id).toBe('imp-1');
    expect(parseImprovements(fs.files.get(FILE) as string).proposals[0]).toMatchObject({ target: 'prompt.md', content: '## Who Ben is\n\nBen builds and runs the gate first.' });
    expect(fs.files.get(prompt)).toBe('## Who Ben is\n\nBen builds.\n'); // proposed, never adopted
    expect(await writer.add('V:/vault', 'ben', { target: 'prompt.md', title: 'Nope', content: '', edits: [{ old: 'Ralf', new: 'x' }] }, 'evidence')).toBeNull();
    expect(logs.some((line) => line.includes('occurs 0 times'))).toBe(true);
  });
});
