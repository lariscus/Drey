import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrayController } from './tray-controller';

/** The tray (req-165, board 8a's inset) over a mocked Electron: the icon follows the setting, the menu the service, the picture its state (req-276). */
const trays: Array<{ menu: Array<Record<string, unknown>>; destroyed: boolean; tooltip: string; image: unknown; handlers: Record<string, () => void> }> = [];

vi.mock('electron', () => {
  class Tray {
    readonly entry = { menu: [] as Array<Record<string, unknown>>, destroyed: false, tooltip: '', image: null as unknown, handlers: {} as Record<string, () => void> };
    constructor(image: unknown) {
      this.entry.image = image;
      trays.push(this.entry);
    }
    on(event: string, handler: () => void): void {
      this.entry.handlers[event] = handler;
    }
    setImage(image: unknown): void {
      this.entry.image = image;
    }
    setToolTip(text: string): void {
      this.entry.tooltip = text;
    }
    setContextMenu(menu: Array<Record<string, unknown>>): void {
      this.entry.menu = menu;
    }
    destroy(): void {
      this.entry.destroyed = true;
    }
  }
  return {
    Tray,
    Menu: { buildFromTemplate: (template: unknown) => template },
  };
});


describe('TrayController', () => {
  const calls = {
    locked: vi.fn(async () => true),
    status: vi.fn(async () => ({ settings: { enabled: true, autostart: true } }) as Record<string, unknown> | null),
    runs: vi.fn(async () => [{ state: 'running' }, { state: 'done' }] as Record<string, unknown>[]),
    autopilot: vi.fn(async () => 'paused' as const),
    setAutopilot: vi.fn(async () => ({ ok: true as const })),
    stopAll: vi.fn(async () => ({ ok: true as const })),
    setAutostart: vi.fn(async () => ({ ok: true as const })),
    shutdown: vi.fn(async () => ({ ok: true as const })),
  };
  const confirmations = { stopAll: vi.fn(async () => true), quitService: vi.fn(async () => false) };
  const openWindow = vi.fn();
  const pictures = { tray: (status: string) => `tray:${status}`, menuDot: (status: string) => `dot:${status}` };
  const make = () =>
    new TrayController({ calls: calls as never, confirmations: confirmations as never, drey: { open: vi.fn() } as never, pictures: pictures as never, openWindow });

  beforeEach(() => {
    trays.length = 0;
    vi.clearAllMocks();
  });

  it('shows and drops the icon with the setting; a click opens the window', () => {
    const tray = make();
    tray.setVisible(true);
    expect(tray.visible).toBe(true);
    trays[0]!.handlers['click']!();
    expect(openWindow).toHaveBeenCalled();
    tray.setVisible(false);
    expect(trays[0]!.destroyed).toBe(true);
  });

  it("the menu as board 8a draws it, from the service's state", async () => {
    const tray = make();
    tray.setVisible(true);
    await tray.refresh();
    const menu = trays[0]!.menu;
    expect(menu.map((item) => item['label'] ?? item['type'])).toEqual([
      'Drey Service · paused',
      'Open Drey Service…',
      'Open Drey',
      'Autopilot: Paused',
      'Stop all running steps…',
      'separator',
      'Start with Windows',
      'Quit service',
    ]);
    expect(menu[6]).toMatchObject({ type: 'checkbox', checked: true });
    expect(trays[0]!.tooltip).toBe('Drey Service · paused\nAutopilot paused');
  });

  it('stop all asks first; quit asks while runs live and does nothing on cancel; the Autopilot goes through the engine', async () => {
    const tray = make();
    tray.setVisible(true);
    await tray.refresh();
    const menu = trays[0]!.menu as Array<{ click?: () => void; submenu?: Array<{ click: () => void }> }>;
    menu[4]!.click!();
    menu[7]!.click!();
    menu[3]!.submenu![0]!.click();
    await vi.waitFor(() => expect(calls.stopAll).toHaveBeenCalled());
    expect(confirmations.quitService).toHaveBeenCalledWith(1);
    expect(calls.shutdown).not.toHaveBeenCalled();
    expect(calls.setAutopilot).toHaveBeenCalledWith('on');
  });

  it('with the service gone: stopped (grey), entries off', async () => {
    calls.locked.mockResolvedValueOnce(false);
    calls.status.mockResolvedValueOnce(null);
    const tray = make();
    tray.setVisible(true);
    await tray.refresh();
    expect(trays[0]!.menu[0]!['label']).toBe('Drey Service · stopped');
    expect(trays[0]!.menu[7]!['enabled']).toBe(false);
    expect(trays[0]!.image).toBe('tray:stopped');
    expect(tray.status).toBe('stopped');
  });

  it('the picture, the header dot and the tooltip follow the state (req-276)', async () => {
    const tray = make();
    tray.setVisible(true);
    expect(trays[0]!.image).toBe('tray:stopped');
    calls.autopilot.mockResolvedValueOnce('on' as never);
    await tray.refresh();
    expect(tray.status).toBe('running');
    expect(trays[0]!.image).toBe('tray:running');
    expect(trays[0]!.menu[0]).toMatchObject({ label: 'Drey Service · running', icon: 'dot:running' });
    expect(trays[0]!.tooltip).toBe('Drey Service · running');

    calls.status.mockResolvedValueOnce({ components: { runner: { state: 'failed' } } });
    await tray.refresh();
    expect(trays[0]!.image).toBe('tray:problem');
    expect(tray.windowStatus).toEqual({ status: 'problem', description: trays[0]!.tooltip });
    expect(trays[0]!.tooltip).toBe('Drey Service · problem\nCrew runner failed');

    calls.status.mockResolvedValueOnce(null);
    await tray.refresh();
    expect(tray.status).toBe('problem');
    expect(trays[0]!.tooltip).toBe('Drey Service · problem\nThe service does not answer');
    expect(trays[0]!.menu[7]!['enabled']).toBe(false);
  });
});
