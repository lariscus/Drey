import { describe, expect, it } from 'vitest';
import { classifyCloneFailure, cleanCloneMessage, progressOfLine } from './repo-clone-errors';

describe('progressOfLine (req-304)', () => {
  it('reads git progress lines, with or without the remote prefix', () => {
    expect(progressOfLine('Receiving objects:  45% (45/100), 1.2 MiB | 2.0 MiB/s')).toEqual({ phase: 'Receiving objects', percent: 45 });
    expect(progressOfLine('remote: Compressing objects: 100% (12/12), done.')).toEqual({ phase: 'Compressing objects', percent: 100 });
    expect(progressOfLine('Resolving deltas:   7% (1/14)')).toEqual({ phase: 'Resolving deltas', percent: 7 });
  });

  it('leaves every other line alone', () => {
    expect(progressOfLine("Cloning into 'drey'...")).toBeNull();
    expect(progressOfLine('fatal: repository not found')).toBeNull();
  });
});

describe('classifyCloneFailure (req-304)', () => {
  it.each([
    ["Authentication failed for 'https://example.com/a.git/'", 'auth'],
    ['git@example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', 'auth'],
    ["fatal: unable to access 'https://example.com/a.git/': The requested URL returned error: 403", 'auth'],
    ['fatal: could not read Username for https://example.com: terminal prompts disabled', 'auth'],
    ["fatal: destination path 'drey' already exists and is not an empty directory.", 'exists'],
    ['remote: Repository not found.\nfatal: repository https://example.com/a.git/ not found', 'not_found'],
    ["fatal: '/nope' does not appear to be a git repository", 'not_found'],
    ["fatal: unable to access 'https://example.com/a.git/': Could not resolve host: example.com", 'offline'],
    ['ssh: Could not resolve hostname example.com: Name or service not known', 'offline'],
    ['something else went wrong', 'git'],
  ] as const)('reads %j as %s', (message, code) => {
    expect(classifyCloneFailure(message)).toBe(code);
  });
});

describe('cleanCloneMessage', () => {
  it('drops git prefixes, progress and the cloning line, and keeps the last lines', () => {
    const stderr = "Cloning into 'a'...\rReceiving objects:  10% (1/10)\nfatal: unable to access 'https://x/': Could not resolve host: x\n";
    expect(cleanCloneMessage(stderr)).toBe("unable to access 'https://x/': Could not resolve host: x");
  });
});
