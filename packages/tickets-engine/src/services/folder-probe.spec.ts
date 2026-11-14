import { describe, expect, it } from 'vitest';
import { FolderProbe } from './folder-probe';

function probeWith(answers: Record<string, string | null>, isDirectory = true) {
  const calls: string[] = [];
  const probe = new FolderProbe({
    git: (cwd, args) => {
      calls.push(`${cwd}|${args.join(' ')}`);
      const answer = answers[args.join(' ')];
      return answer === null || answer === undefined ? Promise.reject(new Error('git failed')) : Promise.resolve(`${answer}\n`);
    },
    isDirectory: () => Promise.resolve(isDirectory),
  });
  return { probe, calls };
}

describe('FolderProbe (req-304)', () => {
  it('reads a repository from inside it: name, origin, branch', async () => {
    const { probe, calls } = probeWith({ 'rev-parse --show-toplevel': '/work/drey', 'remote get-url origin': 'https://example.com/drey.git', 'rev-parse --abbrev-ref HEAD': 'main' });
    expect(await probe.probe('/work/drey/src')).toEqual({ kind: 'repository', seed: { name: 'drey', url: 'https://example.com/drey.git', branch: 'main', path: '/work/drey' } });
    expect(calls[1]).toBe('/work/drey|remote get-url origin');
  });

  it('names a checkout without a remote by its path, and a detached head has no branch', async () => {
    const { probe } = probeWith({ 'rev-parse --show-toplevel': '/work/local', 'remote get-url origin': null, 'rev-parse --abbrev-ref HEAD': 'HEAD' });
    expect(await probe.probe('/work/local')).toEqual({ kind: 'repository', seed: { name: 'local', url: '/work/local', branch: null, path: '/work/local' } });
  });

  it('reads a folder git does not know as plain', async () => {
    const { probe } = probeWith({ 'rev-parse --show-toplevel': null });
    expect(await probe.probe('/work/plain')).toEqual({ kind: 'plain', path: '/work/plain' });
  });

  it('reports a folder that is not there, without asking git', async () => {
    const { probe, calls } = probeWith({}, false);
    expect(await probe.probe('/gone')).toEqual({ kind: 'missing' });
    expect(calls).toEqual([]);
  });
});
