import { describe, expect, it } from 'vitest';
import { dreyCommand } from './drey-launcher';
import { windowEventOf } from './event-relay';
import { localModelTarget } from './local-model-probe';
import { newSessionAskOf } from './new-session-ask';
import { endpointsOfLock } from './service-endpoints';
import { parseWindowArgs } from './service-window-args';
import { SseParser } from './sse-parser';
import { composeStatusDot, dotBitmap, dotGeometry, overlayDotBitmap, overlayDotGeometry } from './tray-icon';

/** The service window process's pure parts (req-165): its arguments, the lock, the event feed, the local model, Drey's command, the icon's status dot. */
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

describe('newSessionAskOf', () => {
  const ask = { persona: 'ben', directory: ' E:/notes ', poolClass: null, permissionMode: 'read-only', firstLine: '  ' };

  it('trims the folder, drops a blank first line, and passes the rest', () => {
    expect(newSessionAskOf(ask)).toEqual({ persona: 'ben', directory: 'E:/notes', poolClass: null, permissionMode: 'read-only' });
    expect(newSessionAskOf({ ...ask, poolClass: 'B', firstLine: 'go' })).toMatchObject({ poolClass: 'B', firstLine: 'go' });
  });
  it('refuses a missing persona, a blank folder, an unknown class or permission', () => {
    for (const bad of [{ ...ask, persona: '' }, { ...ask, directory: ' ' }, { ...ask, poolClass: 'Z' }, { ...ask, permissionMode: 'root' }, null, 'x']) {
      expect(newSessionAskOf(bad)).toBeNull();
    }
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

describe('the status dot on the icon (req-276)', () => {
  const GREEN = [0x3f, 0xb9, 0x50] as const;
  /** An opaque icon: every pixel BGRA (10, 20, 30, 255). */
  const opaque = (size: number): Buffer => {
    const buffer = Buffer.alloc(size * size * 4);
    for (let i = 0; i < buffer.length; i += 4) {
      buffer.set([10, 20, 30, 255], i);
    }
    return buffer;
  };
  const pixel = (buffer: Buffer, size: number, x: number, y: number): number[] => [...buffer.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

  it('sits in the bottom-right corner (where tray badges sit), a bit under half the icon, on whole pixels', () => {
    expect(dotGeometry(16)).toEqual({ cx: 12.5, cy: 12.5, radius: 3.5, ring: 1 });
    expect(dotGeometry(20)).toEqual({ cx: 15.5, cy: 15.5, radius: 4.5, ring: 1 });
    expect(dotGeometry(24)).toEqual({ cx: 18.5, cy: 18.5, radius: 5.5, ring: 2 });
    expect(dotGeometry(32)).toEqual({ cx: 25, cy: 25, radius: 7, ring: 2 });
  });

  for (const size of [16, 24, 32]) {
    it(`at ${size} px: the dot opaque in its colour, a transparent ring around it, the rest of the icon untouched`, () => {
      const icon = opaque(size);
      const out = composeStatusDot(icon, size, GREEN);
      const { cx, cy, radius, ring } = dotGeometry(size);
      // BGRA: blue first.
      expect(pixel(out, size, Math.floor(cx), Math.floor(cy))).toEqual([0x50, 0xb9, 0x3f, 255]);
      // Straight left of the dot, inside the ring: cut out.
      const ringX = Math.floor(cx - radius - ring / 2);
      expect(pixel(out, size, ringX, Math.floor(cy))[3]).toBeLessThan(128);
      // The other corners and the centre keep the icon.
      for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [Math.floor(size / 2) - 2, Math.floor(size / 2) - 2]] as const) {
        expect(pixel(out, size, x, y)).toEqual([10, 20, 30, 255]);
      }
      // A copy: the scaled icon is reused for every state.
      expect(pixel(icon, size, Math.floor(cx), Math.floor(cy))).toEqual([10, 20, 30, 255]);
    });
  }

  it('on a transparent icon (the file missing) the dot alone still shows', () => {
    const out = composeStatusDot(Buffer.alloc(16 * 16 * 4), 16, GREEN);
    expect(pixel(out, 16, 12, 12)).toEqual([0x50, 0xb9, 0x3f, 255]);
    expect(pixel(out, 16, 2, 3)).toEqual([0, 0, 0, 0]);
  });

  it('refuses a buffer of the wrong size', () => {
    expect(() => composeStatusDot(Buffer.alloc(10), 16, GREEN)).toThrow();
  });

  it('the taskbar overlay: the dot centred in its canvas (Windows places the badge) with a dark rim, the rest transparent', () => {
    expect(overlayDotGeometry(32)).toEqual({ cx: 16, cy: 16, radius: 10, ring: 2 });
    expect(overlayDotGeometry(16)).toEqual({ cx: 8, cy: 8, radius: 5, ring: 1 });
    const overlay = overlayDotBitmap(32, GREEN);
    expect(overlay).toHaveLength(32 * 32 * 4);
    expect(pixel(overlay, 32, 16, 16)).toEqual([0x50, 0xb9, 0x3f, 255]);
    // On the rim, straight right of the dot: dark and opaque.
    expect(pixel(overlay, 32, 26, 16)).toEqual([0x1e, 0x1c, 0x1c, 255]);
    for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31], [2, 16]] as const) {
      expect(pixel(overlay, 32, x, y)).toEqual([0, 0, 0, 0]);
    }
  });

  it('the menu dot: a centred circle on transparency', () => {
    const dot = dotBitmap(16, GREEN);
    expect(dot).toHaveLength(16 * 16 * 4);
    expect(pixel(dot, 16, 8, 8)).toEqual([0x50, 0xb9, 0x3f, 255]);
    expect(pixel(dot, 16, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});
