import { describe, expect, it } from 'vitest';
import { checkGitUrl, repoNameOfPath } from './git-url';

describe('checkGitUrl (req-304)', () => {
  it('takes an https, an ssh, a scp-like and a file URL, and names the repository', () => {
    expect(checkGitUrl('https://github.com/owner/drey.git')).toEqual({ ok: true, url: 'https://github.com/owner/drey.git', name: 'drey' });
    expect(checkGitUrl('  https://example.com/a/b/tool  ')).toEqual({ ok: true, url: 'https://example.com/a/b/tool', name: 'tool' });
    expect(checkGitUrl('ssh://git@example.com:2222/team/app.git')).toMatchObject({ ok: true, name: 'app' });
    expect(checkGitUrl('git@github.com:owner/drey.git')).toEqual({ ok: true, url: 'git@github.com:owner/drey.git', name: 'drey' });
    expect(checkGitUrl('file:///E:/tmp/origin.git')).toMatchObject({ ok: true, name: 'origin' });
  });

  it('refuses nothing, other schemes and local paths', () => {
    expect(checkGitUrl('')).toEqual({ ok: false, problem: 'empty' });
    expect(checkGitUrl('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(checkGitUrl('ftp://example.com/a.git')).toEqual({ ok: false, problem: 'scheme' });
    expect(checkGitUrl('ext::sh -c evil')).toMatchObject({ ok: false });
    expect(checkGitUrl('E:/projects/drey')).toMatchObject({ ok: false, problem: 'scheme' });
    expect(checkGitUrl('just words')).toEqual({ ok: false, problem: 'malformed' });
  });

  it('refuses a URL that carries credentials, and an option in disguise', () => {
    expect(checkGitUrl('https://user:secret@example.com/a.git')).toEqual({ ok: false, problem: 'credentials' });
    expect(checkGitUrl('https://ghp_token@example.com/a.git')).toEqual({ ok: false, problem: 'credentials' });
    expect(checkGitUrl('ssh://git:secret@example.com/a.git')).toEqual({ ok: false, problem: 'credentials' });
    expect(checkGitUrl('--upload-pack=evil')).toEqual({ ok: false, problem: 'malformed' });
  });

  it('refuses a URL without a host or without a repository name', () => {
    expect(checkGitUrl('https:///a.git')).toMatchObject({ ok: false });
    expect(checkGitUrl('https://example.com/')).toEqual({ ok: false, problem: 'malformed' });
  });
});

describe('repoNameOfPath', () => {
  it('drops .git and a trailing slash, and keeps only folder-safe characters', () => {
    expect(repoNameOfPath('/owner/drey.git/')).toBe('drey');
    expect(repoNameOfPath('/owner/My%20Repo.git')).toBe('My-Repo');
    expect(repoNameOfPath('/..')).toBeNull();
    expect(repoNameOfPath('')).toBeNull();
  });
});
