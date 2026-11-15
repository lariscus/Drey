import { describe, expect, it } from 'vitest';
import { readStoreRef, withStoreRef } from './pipeline-store';

/**
 * req-315: the project's store reference lives in pipeline.md's
 * frontmatter — read tolerantly (quoted or plain), written as one line
 * among the others.
 */
describe('pipeline store reference', () => {
  const PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
flow: ben; you
priorities: [urgent, high, normal, low]
---
The pipeline.
`;

  it('reads nothing from a file without a fence or without the key', () => {
    expect(readStoreRef(null)).toBeNull();
    expect(readStoreRef('just prose')).toBeNull();
    expect(readStoreRef(PIPELINE)).toBeNull();
  });

  it('reads a plain and a quoted reference', () => {
    expect(readStoreRef(withStoreRef(PIPELINE, 'E:\\tickets\\store'))).toBe('E:\\tickets\\store');
    expect(readStoreRef(withStoreRef(PIPELINE, 'https://example.invalid/t.git#tickets'))).toBe('https://example.invalid/t.git#tickets');
  });

  it('reads an explicitly empty reference as none', () => {
    expect(readStoreRef(withStoreRef(PIPELINE, ''))).toBeNull();
  });

  it('writes the reference as the first frontmatter line and keeps everything else', () => {
    const next = withStoreRef(PIPELINE, 'E:\\tickets\\store');
    expect(next).toContain('store: E:\\tickets\\store\n');
    expect(next).toContain('flow: ben; you');
    expect(next).toContain('- { id: inbox, title: Inbox, handover: manual }');
    expect(next.endsWith('The pipeline.\n') || next.includes('The pipeline.')).toBe(true);
    // A re-write replaces the line instead of stacking a second one.
    const again = withStoreRef(next, 'E:\\elsewhere\\store');
    expect((again.match(/^store:/gm) ?? []).length).toBe(1);
    expect(readStoreRef(again)).toBe('E:\\elsewhere\\store');
  });

  it('quotes references that YAML would misread as a comment', () => {
    const next = withStoreRef(PIPELINE, 'https://example.invalid/t.git#tickets');
    expect(next).toContain(`store: 'https://example.invalid/t.git#tickets'`);
  });

  it('prepends a fence to a file that has none', () => {
    const next = withStoreRef('just prose', 'E:\\tickets\\store');
    expect(readStoreRef(next)).toBe('E:\\tickets\\store');
    expect(next).toContain('just prose');
  });
});
