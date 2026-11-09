import { describe, expect, it } from 'vitest';
import { dreyCommand } from './drey-launcher';
import { windowEventOf } from './event-relay';
import { localModelTarget } from './local-model-probe';
import { endpointsOfLock } from './service-endpoints';
import { parseWindowArgs } from './service-window-args';
import { SseParser } from './sse-parser';
import { dotBitmap, inLetterD, trayIconBitmap } from './tray-icon';

/** The service window process's pure parts (req-165): its arguments, the lock, the event feed, the local model, Drey's command, the icon. */
describe('parseWindowArgs', () => {
  it('reads the home, the service pid and the mode', () => {
    expect(parseWindowArgs(['electron.exe', 'D:/app', '--drey-service-window', '--home', 'H', '--service-pid', '42', '--tray'])).toEqual({
      home: 'H',
      servicePid: 42,
      tray: true,
      open: false,
    });
    expect(parseWindowArgs(['Drey.exe', '--open'])).toEqual({ home: null, servicePid: null, tray: false, open: true });
  });
});

describe('endpointsOfLock', () => {
  const lock = {
    pid: 7,
    port: 5000,
    token: 'tok',
    components: { engine: { state: 'running', port: 5001 }, runner: { state: 'running', port: 5002, token: 'rt' } },
  };

  it('the control port, the engine (control token) and an awake runner (its own token)', () => {
    expect(endpointsOfLock(lock)).toEqual({ pid: 7, control: { port: 5000, token: 'tok' }, engine: { port: 5001, token: 'tok' }, runner: { port: 5002, token: 'rt' } });
  });

  it('a sleeping runner has no endpoint; a broken lock is none', () => {
    expect(endpointsOfLock({ ...lock, components: { runner: { state: 'sleeping' } } })?.runner).toBeNull();
    expect(endpointsOfLock({ port: 'x' })).toBeNull();
  });
});

describe('SseParser and windowEventOf', () => {
  it('cuts events across chunks and drops comments', () => {
    const parser = new SseParser();
    expect(parser.push('retry: 3000\n\n: ping\n\nevent: line\ndata: {"runId":"R-1",')).toEqual([]);
    expect(parser.push('"event":{"ts":"t","kind":"tool"}}\n\n')).toEqual([{ event: 'line', data: '{"runId":"R-1","event":{"ts":"t","kind":"tool"}}' }]);
  });

  it('maps the runner and the log streams to the contract', () => {
    expect(windowEventOf('runner', { event: 'line', data: '{"runId":"R-1","event":{"ts":"t","kind":"note","text":"x"}}' })).toEqual({
      kind: 'line',
      runId: 'R-1',
      event: { ts: 't', kind: 'note', text: 'x' },
    });
    expect(windowEventOf('runner', { event: 'run', data: '{"id":"R-1","ticketId":"T-1","state":"running"}' })).toMatchObject({ kind: 'run', run: { id: 'R-1', state: 'running' } });
    expect(windowEventOf('runner', { event: 'slot', data: '{}' })).toEqual({ kind: 'status' });
    expect(windowEventOf('log', { event: 'log', data: JSON.stringify('2026-11-09T08:12:03.000Z warn  runner  no output for 9 min') })).toEqual({
      kind: 'log',
      line: { at: '2026-11-09T08:12:03.000Z', level: 'warn', component: 'runner', message: 'no output for 9 min' },
    });
    expect(windowEventOf('log', { event: 'log', data: 'not json' })).toBeNull();
  });
});

describe('localModelTarget', () => {
  it("Drey's own local endpoint when it is on this machine, LM Studio's default otherwise", () => {
    expect(localModelTarget({ provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1/' })).toEqual({ url: 'http://localhost:1234/v1', name: 'LM Studio' });
    expect(localModelTarget({ provider: 'openai-compat', baseUrl: 'http://127.0.0.1:8080/v1' })).toEqual({ url: 'http://127.0.0.1:8080/v1', name: '127.0.0.1:8080' });
    expect(localModelTarget({ provider: 'zai-glm', baseUrl: 'https://api.z.ai/api/anthropic' })).toEqual({ url: 'http://localhost:1234/v1', name: 'LM Studio' });
    expect(localModelTarget(null).name).toBe('LM Studio');
  });
});

describe('dreyCommand', () => {
  it('a bare dev electron gets the app folder, a packaged Drey.exe nothing', () => {
    expect(dreyCommand('E:/x/electron.exe', 'E:/x')).toEqual({ command: 'E:/x/electron.exe', args: ['E:/x'] });
    expect(dreyCommand('C:/Drey/Drey.exe', 'C:/Drey/resources/app.asar')).toEqual({ command: 'C:/Drey/Drey.exe', args: [] });
  });
});

describe('the tray icon', () => {
  it('is a BGRA square: accent while running, grey when stopped, the D in ink, transparent corners', () => {
    const running = trayIconBitmap('running', 16);
    expect(running).toHaveLength(16 * 16 * 4);
    expect([...running.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    const centreOfBody = (8 * 16 + 2) * 4;
    expect([...running.subarray(centreOfBody, centreOfBody + 4)]).toEqual([0xef, 0xcb, 0x8e, 255]);
    const stopped = trayIconBitmap('stopped', 16);
    expect([...stopped.subarray(centreOfBody, centreOfBody + 3)]).toEqual([0x80, 0x79, 0x74]);
    expect(inLetterD(0.36, 0.5)).toBe(true);
    expect(inLetterD(0.5, 0.5)).toBe(false);
    expect(dotBitmap(8)).toHaveLength(8 * 8 * 4);
  });
});
