import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpawnFn } from '../ports/process-spawner';
import { CLAUDE_CODE_SETTINGS_FILE, claudeCodeAdapter, claudeCodeArgs, claudeCodeSettings } from './claude-code';
import { collect, fakeProcess } from './worker-process.fake';

/** req-142 / req-185 (ADR-0099): what a run's persona and its folders make of Claude Code's command line. */
describe("Claude Code's confinement and network switch", () => {
  it('a writing run may not write outside its working folders; without the network the web tools are denied', () => {
    expect(claudeCodeSettings({ permissionMode: 'accept-edits' })).toEqual({ permissions: { blockWritesOutsideWorkingDirectories: true } });
    expect(claudeCodeSettings({ permissionMode: 'bypass', network: false })).toEqual({
      permissions: { blockWritesOutsideWorkingDirectories: true, deny: ['WebFetch', 'WebSearch'] },
    });
    expect(claudeCodeSettings({ permissionMode: 'read-only' })).toBeNull();
    expect(claudeCodeSettings({ permissionMode: 'read-only', network: false })).toEqual({ permissions: { deny: ['WebFetch', 'WebSearch'] } });
  });

  it('adds the folders beyond cwd, takes the web tools away and names the settings file, each list followed by an option', () => {
    const { start } = collect({ permissionMode: 'bypass', network: false, writeDirs: ['T:/tickets/_workcopy', 'S:/site-wt/T-0001'], model: 'opus' });
    const args = claudeCodeArgs(start, 'F:/runs/R-1/claude-settings.json');
    expect(args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--add-dir',
      'T:/tickets/_workcopy',
      'S:/site-wt/T-0001',
      '--permission-mode',
      'bypassPermissions',
      '--model',
      'opus',
      '--disallowedTools',
      'WebFetch',
      'WebSearch',
      '--settings',
      'F:/runs/R-1/claude-settings.json',
    ]);
  });

  it('a run with the network and no further folders keeps the command line it always had', () => {
    const { start } = collect();
    expect(claudeCodeArgs(start)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits']);
  });

  it("writes the settings into the run's folder and passes that file", () => {
    const spawned: string[][] = [];
    const written: { file: string; text: string }[] = [];
    const proc = fakeProcess();
    const spawnFn: SpawnFn = (_cmd, args) => {
      spawned.push([...args]);
      return proc;
    };
    const { start } = collect({ network: false, runDir: 'F:/runs/R-1' });
    claudeCodeAdapter(spawnFn, () => new Date(), (file, text) => written.push({ file, text })).spawn(start);
    const file = path.join('F:/runs/R-1', CLAUDE_CODE_SETTINGS_FILE);
    expect(written).toHaveLength(1);
    expect(written[0]!.file).toBe(file);
    expect(JSON.parse(written[0]!.text)).toEqual({ permissions: { blockWritesOutsideWorkingDirectories: true, deny: ['WebFetch', 'WebSearch'] } });
    expect(spawned[0]!.slice(spawned[0]!.indexOf('--settings'), spawned[0]!.indexOf('--settings') + 2)).toEqual(['--settings', file]);
  });

  it('without a run folder (the closing round) nothing is written and no settings ride', () => {
    const spawned: string[][] = [];
    const written: string[] = [];
    const spawnFn: SpawnFn = (_cmd, args) => {
      spawned.push([...args]);
      return fakeProcess();
    };
    claudeCodeAdapter(spawnFn, () => new Date(), (file) => written.push(file)).spawn(collect().start);
    expect(written).toEqual([]);
    expect(spawned[0]).not.toContain('--settings');
  });
});
