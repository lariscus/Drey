import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_DK_VERSION, DkHealthProbe, dkVersionIssue, gitIssue, type ProbeExec, type ProbeResult } from './dk-health';

const ok = (stdout: string): ProbeResult => ({ code: 0, stdout, failure: null });
const out = (version: string): ProbeResult => ok(`version: ${version}\ncommit: 51cd9aa\ndate: 2026-11-05T17:54:18Z\n`);

describe('BUNDLED_DK_VERSION', () => {
  it('is the release scripts/dk-version.json pins for the installer', () => {
    const pin = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../scripts/dk-version.json'), 'utf8')) as { version: string };
    expect(BUNDLED_DK_VERSION).toBe(pin.version);
  });
});

describe('dkVersionIssue', () => {
  it('passes the bundled release and newer ones', () => {
    expect(dkVersionIssue('dk', out('v0.6.2'))).toBeNull();
    expect(dkVersionIssue('dk', out('v0.7.0'))).toBeNull();
    expect(dkVersionIssue('dk', out('v1.0.0'))).toBeNull();
  });

  it('passes a dev build', () => {
    expect(dkVersionIssue('dk', ok('version: dev\n'))).toBeNull();
  });

  it('warns about a release older than the bundled one', () => {
    const issue = dkVersionIssue('C:/tools/dk.exe', out('v0.6.1'));
    expect(issue?.level).toBe('warning');
    expect(issue?.message).toContain('0.6.1');
    expect(issue?.message).toContain(BUNDLED_DK_VERSION);
    expect(issue?.message).toContain('C:/tools/dk.exe');
  });

  it('errors on a release below what the engine speaks to', () => {
    const issue = dkVersionIssue('dk', out('v0.5.0'));
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('too old');
  });

  it('errors when dk is not found, cannot run or answers nothing readable', () => {
    expect(dkVersionIssue('dk', { code: null, stdout: '', failure: 'ENOENT' })).toMatchObject({ level: 'error', message: expect.stringContaining('was not found') });
    expect(dkVersionIssue('dk', { code: 2, stdout: '', failure: null })?.message).toContain('exit code 2');
    expect(dkVersionIssue('dk', { code: null, stdout: '', failure: 'ETIMEDOUT' })?.message).toContain('ETIMEDOUT');
    expect(dkVersionIssue('dk', ok('hello world\n'))?.level).toBe('error');
  });
});

describe('gitIssue', () => {
  it('is null while git answers', () => {
    expect(gitIssue(ok('git version 2.47.0\n'))).toBeNull();
  });

  it('is an error when git is missing or fails', () => {
    expect(gitIssue({ code: null, stdout: '', failure: 'ENOENT' })?.level).toBe('error');
    expect(gitIssue({ code: 1, stdout: '', failure: null })?.message).toContain('git');
  });
});

describe('DkHealthProbe', () => {
  function fakeExec(answers: { dk: ProbeResult; git: ProbeResult }): { exec: ProbeExec; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      exec: (bin, args) => {
        calls.push(`${bin} ${args.join(' ')}`);
        return Promise.resolve(bin === 'git' ? answers.git : answers.dk);
      },
    };
  }

  it('runs `dk version` and `git --version` and returns no issues for a healthy pair', async () => {
    const { exec, calls } = fakeExec({ dk: out('v0.6.2'), git: ok('git version 2.47.0') });
    const probe = new DkHealthProbe(exec);
    expect(await probe.issues('X:/dk.exe')).toEqual([]);
    expect(calls.sort()).toEqual(['X:/dk.exe version', 'git --version']);
  });

  it('collects the issues of both and never throws', async () => {
    const { exec } = fakeExec({ dk: { code: null, stdout: '', failure: 'ENOENT' }, git: { code: null, stdout: '', failure: 'ENOENT' } });
    const issues = await new DkHealthProbe(exec).issues('dk');
    expect(issues.map((i) => i.level)).toEqual(['error', 'error']);

    const throwing = new DkHealthProbe(() => Promise.reject(new Error('boom')));
    expect((await throwing.issues('dk'))[0]?.message).toContain('boom');
  });

  it('keeps a healthy answer for minutes and a failed one for seconds', async () => {
    let now = 1_000;
    const healthy = fakeExec({ dk: out('v0.6.2'), git: ok('git version 2') });
    const a = new DkHealthProbe(healthy.exec, () => now);
    await a.issues('dk');
    now += 60_000;
    await a.issues('dk');
    expect(healthy.calls).toHaveLength(2);
    now += 5 * 60_000;
    await a.issues('dk');
    expect(healthy.calls).toHaveLength(4);

    const failing = fakeExec({ dk: { code: null, stdout: '', failure: 'ENOENT' }, git: ok('git version 2') });
    const b = new DkHealthProbe(failing.exec, () => now);
    await b.issues('dk');
    now += 5_000;
    await b.issues('dk');
    expect(failing.calls).toHaveLength(2);
    now += 20_000;
    await b.issues('dk');
    expect(failing.calls).toHaveLength(4);
  });

  it('asks again for another executable', async () => {
    const { exec, calls } = fakeExec({ dk: out('v0.6.2'), git: ok('git version 2') });
    const probe = new DkHealthProbe(exec);
    await probe.issues('dk');
    await probe.issues('other/dk.exe');
    expect(calls.filter((c) => c.endsWith(' version'))).toHaveLength(2);
  });

  it('shares one probe between simultaneous callers', async () => {
    const { exec, calls } = fakeExec({ dk: out('v0.6.2'), git: ok('git version 2') });
    const probe = new DkHealthProbe(exec);
    await Promise.all([probe.issues('dk'), probe.issues('dk')]);
    expect(calls).toHaveLength(2);
  });
});
