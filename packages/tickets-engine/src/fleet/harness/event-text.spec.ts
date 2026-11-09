import { describe, expect, it } from 'vitest';
import { blockedOf, editChanges, frictionOf, permissionText, questionOf, toolActivity } from './event-text';

describe('questionOf / permissionText — what a worker waits on (req-64)', () => {
  it('reads the marker case-insensitively at the start of the message only', () => {
    expect(questionOf('QUESTION: Which API?')).toBe('Which API?');
    expect(questionOf('  question:\nA or B?\n')).toBe('A or B?');
    expect(questionOf('Done. QUESTION: none')).toBeNull();
    expect(questionOf('QUESTION:   ')).toBeNull();
  });

  it('accepts a marker on any line start — the last one wins (req-75)', () => {
    // A worker asking outside the W2 shape buries its marker mid-message
    // (evidence R-20261031T02050-wewb): the wait still sets. A marker in
    // running prose stays prose.
    expect(questionOf('All tests pass.\nQUESTION: Which API do you prefer?')).toBe('Which API do you prefer?');
    expect(questionOf('QUESTION: first\nsome detail\nQUESTION: second')).toBe('second');
    expect(questionOf('noise\nDone. QUESTION: none\nnoise')).toBeNull();
    // Text from the marker to the message's end, trimmed.
    expect(questionOf('QUESTION:\nA or B?\nplease advise')).toBe('A or B?\nplease advise');
  });

  it('names the action and its resources, plus a message that says more', () => {
    expect(permissionText({ action: 'bash', resources: ['rm -rf dist'] })).toBe('bash rm -rf dist');
    expect(permissionText({ action: 'edit', resources: ['a.ts'], message: 'outside the worktree' })).toBe(
      'edit a.ts — outside the worktree',
    );
  });
});

describe('blockedOf — the refusal marker of a step the worker could not complete', () => {
  it('reads the marker like questionOf: line starts, the last one wins', () => {
    expect(blockedOf('BLOCKED: merge conflict in specs/changelog.md')).toBe('merge conflict in specs/changelog.md');
    expect(blockedOf('  blocked:\nthe owner must merge')).toBe('the owner must merge');
    expect(blockedOf('The step is not complete.\nBLOCKED: protected repo — the owner merges')).toBe(
      'protected repo — the owner merges',
    );
    expect(blockedOf('BLOCKED: first attempt\nnoise\nBLOCKED: second attempt')).toBe('second attempt');
    expect(blockedOf('Done. BLOCKED: none')).toBeNull();
    expect(blockedOf('BLOCKED:   ')).toBeNull();
    expect(blockedOf('all done')).toBeNull();
  });

});

describe('toolActivity — the one line a tool call shows on the lane', () => {
  it('names the tool and its target', () => {
    expect(toolActivity('read', { path: 'src/a.ts' })).toBe('read src/a.ts');
    expect(toolActivity('shell', { command: 'git status --short' })).toBe('shell git status --short');
    expect(toolActivity('grep', { pattern: 'prepareWorktree' })).toBe('grep prepareWorktree');
  });

  it('copes with a call without input and caps a long target', () => {
    expect(toolActivity(undefined, undefined)).toBe('tool');
    expect(toolActivity('question', { questions: [{ question: 'How should I merge?' }] })).toBe('asks How should I merge?');
    expect(toolActivity('shell', { command: 'x'.repeat(400) }).length).toBeLessThanOrEqual(140);
  });
});

describe('editChanges — the lines an edit-like call adds and removes', () => {
  const nl = String.fromCharCode(10);
  it('counts an Edit by its old and new string', () => {
    expect(editChanges('Edit', { old_string: 'a', new_string: ['b', 'c', 'd', 'e'].join(nl) })).toEqual({ added: 4, removed: 1 });
  });

  it('sums a MultiEdit and counts a Write as all added', () => {
    expect(editChanges('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: ['x', 'y'].join(nl), new_string: '' }] })).toEqual({ added: 1, removed: 3 });
    expect(editChanges('Write', { content: ['1', '2', '3'].join(nl) })).toEqual({ added: 3, removed: 0 });
  });

  it('is null for other tools and shapes', () => {
    expect(editChanges('Read', { file_path: 'a.ts' })).toBeNull();
    expect(editChanges(undefined, undefined)).toBeNull();
  });
});

describe('frictionOf — the worker reports friction in one line (req-169)', () => {
  it('reads the last line-start FRICTION: line only, never the lines below it', () => {
    expect(frictionOf('Done.\nFRICTION: lacked the schema\nFRICTION: guessed the test command\nBLOCKED: cannot push')).toBe('guessed the test command');
  });

  it('a marker in running prose, an empty or a none report is no friction', () => {
    expect(frictionOf('Done, FRICTION: none')).toBeNull();
    expect(frictionOf('FRICTION: none')).toBeNull();
    expect(frictionOf('FRICTION:   ')).toBeNull();
    expect(frictionOf('all fine')).toBeNull();
  });

  it('is bounded to one short line', () => {
    expect(frictionOf(`friction: ${'x'.repeat(400)}`)?.length).toBe(300);
  });
});
