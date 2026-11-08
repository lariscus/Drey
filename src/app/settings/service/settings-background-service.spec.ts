import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  SERVICE_PREF_DEFAULTS,
  SERVICE_STOPPED,
  type ServicePrefs,
  type ServiceStatusReply,
} from '../../../../shared/service-settings';
import { SettingsService } from '../../services/settings.service';
import { ServiceClient } from './service-client';
import { SettingsBackgroundService } from './settings-background-service';

const LIVE: ServiceStatusReply = {
  running: true,
  home: 'C:\\Users\\x\\.drey-engine',
  startedAt: '2026-11-08T08:12:00',
  liveRuns: 2,
  gateway: { enabled: false, listening: false, devices: 0, failed: false },
  components: { engine: 'running', runner: 'running' },
};

const STORED: ServicePrefs = { ...SERVICE_PREF_DEFAULTS, enabled: true, autostart: true, quietHours: '22:00 – 07:00' };

function setup(opts: { status?: ServiceStatusReply; prefs?: ServicePrefs | null } = {}) {
  const client = {
    status: vi.fn(() => Promise.resolve(opts.status ?? LIVE)),
    prefs: vi.fn(() => Promise.resolve(opts.prefs === undefined ? STORED : opts.prefs)),
    setPrefs: vi.fn((patch: Partial<ServicePrefs>) => Promise.resolve({ ...STORED, ...patch })),
    control: vi.fn(() => Promise.resolve({ ok: true })),
    setGateway: vi.fn(() => Promise.resolve()),
    openLogFolder: vi.fn(() => Promise.resolve()),
  };
  const settings = { patchMcp: vi.fn(), flush: vi.fn(() => Promise.resolve(true)) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ServiceClient, useValue: client },
      { provide: SettingsService, useValue: settings },
    ],
  });
  const fixture: ComponentFixture<SettingsBackgroundService> = TestBed.createComponent(SettingsBackgroundService);
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  fixture.detectChanges();
  return { client, settings, fixture, root, settle };
}

/** The words of an element, one space between its pieces (nodes the page lays out as blocks or flex items). */
const text = (el: Element): string => {
  const words: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      words.push(node.textContent ?? '');
    }
    node.childNodes.forEach(walk);
  };
  walk(el);
  return words.join(' ').replace(/\s+/g, ' ').trim();
};
const buttons = (root: ParentNode, label: string): HTMLButtonElement[] =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => text(b) === label);
const item = (root: ParentNode, key: string): HTMLElement => root.querySelector<HTMLElement>(`[data-setting-key="${key}"]`)!;

describe('Settings → Background service (board 8c)', () => {
  it('draws the title and the four groups of the board in order', async () => {
    const { root, settle } = setup();
    await settle();
    expect(text(root.querySelector('.pane-head h2')!)).toBe('Background service');
    expect([...root.querySelectorAll('h3')].map(text)).toEqual(['Service', 'Components', 'Load', 'Logs']);
  });

  it('writes the status line from the service: since, four components, the live runs', async () => {
    const { root, settle } = setup();
    await settle();
    expect(text(item(root, 'service.status'))).toMatch(/^Status Running since .+ · 4 components · 2 runs live Restart Stop$/);
  });

  it('draws the rows the board has, with its strings, and not the one whose window is not built', async () => {
    const { root, settle } = setup();
    await settle();
    expect(text(item(root, 'service.idle'))).toBe('Keep running after Drey quits Live runs and a running Autopilot always keep it alive. minutes');
    expect(item(root, 'service.idle').querySelector<HTMLInputElement>('input')!.value).toBe('15');
    expect(text(item(root, 'service.tray'))).toBe('Taskbar icon Shown Hide');
    expect(text(item(root, 'service.component.runner'))).toBe('Crew runner running · 2 live Restart Stop');
    expect(text(item(root, 'service.component.engine'))).toBe('Tickets engine Always on while the service runs. running');
    expect(text(item(root, 'service.component.gateway'))).toBe('Remote gateway Phones and the iPad. Pairing under Tickets → Devices. off Start');
    expect(buttons(root, 'Open Drey Service…')).toEqual([]);
  });

  it('draws the Load and Logs items with the stored values', async () => {
    const { root, settle } = setup();
    await settle();
    expect(text(item(root, 'service.load.seats'))).toContain('Heavy seats Tests, builds, dev servers and browsers. Model runs are light. at once');
    expect(item(root, 'service.load.reserve').querySelector<HTMLInputElement>('input')!.value).toBe('25');
    expect(item(root, 'service.load.quiet').querySelector<HTMLInputElement>('input')!.value).toBe('22:00 – 07:00');
    expect(text(item(root, 'service.logs.level'))).toBe('Log level Normal Change…');
    expect(text(item(root, 'service.logs.folder'))).toBe(
      'Log folder One file per component, rotated daily, kept 14 days. C:\\Users\\x\\.drey-engine Open folder',
    );
  });

  it('stores the two switches as they are made; start with Windows waits for the service', async () => {
    const { root, client, settle } = setup({ prefs: { ...STORED, enabled: false, autostart: false } });
    await settle();
    const autostart = item(root, 'service.autostart').querySelector<HTMLInputElement>('input')!;
    expect(autostart.disabled).toBe(true);
    const enabled = item(root, 'service.enabled').querySelector<HTMLInputElement>('input')!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    expect(client.setPrefs).toHaveBeenCalledWith({ enabled: true });
    await settle();
    expect(autostart.disabled).toBe(false);
  });

  it('commits a whole-number field on change and sends it as a number', async () => {
    const { root, client, settle } = setup();
    await settle();
    const field = item(root, 'service.idle').querySelector<HTMLInputElement>('input')!;
    field.value = '30';
    field.dispatchEvent(new Event('change'));
    expect(client.setPrefs).toHaveBeenCalledWith({ idleMinutes: 30 });
  });

  it('refuses a value out of range: nothing is stored, the field goes back and is marked', async () => {
    const { root, client, settle } = setup();
    await settle();
    const field = item(root, 'service.load.reserve').querySelector<HTMLInputElement>('input')!;
    field.value = '95';
    field.dispatchEvent(new Event('change'));
    await settle();
    expect(client.setPrefs).not.toHaveBeenCalled();
    expect(field.value).toBe('25');
    expect(field.classList.contains('invalid')).toBe(true);
  });

  it('stores quiet hours in the board form and refuses nonsense', async () => {
    const { root, client, settle } = setup();
    await settle();
    const field = item(root, 'service.load.quiet').querySelector<HTMLInputElement>('input')!;
    field.value = '23:00-06:30';
    field.dispatchEvent(new Event('change'));
    expect(client.setPrefs).toHaveBeenCalledWith({ quietHours: '23:00 – 06:30' });
    expect(field.value).toBe('23:00 – 06:30');
    client.setPrefs.mockClear();
    field.value = 'at night';
    field.dispatchEvent(new Event('change'));
    expect(client.setPrefs).not.toHaveBeenCalled();
  });

  it('hides the taskbar icon with the button; the button then reads Show', async () => {
    const { root, client, settle } = setup();
    await settle();
    buttons(item(root, 'service.tray'), 'Hide')[0].click();
    expect(client.setPrefs).toHaveBeenCalledWith({ trayIcon: false });
  });

  it('Restart and Stop of the service call the service control; the buttons wait while it works', async () => {
    const { root, client, settle } = setup();
    await settle();
    buttons(item(root, 'service.status'), 'Restart')[0].click();
    expect(client.control).toHaveBeenCalledWith({ target: 'service', action: 'restart' });
    await settle();
    buttons(item(root, 'service.status'), 'Stop')[0].click();
    expect(client.control).toHaveBeenLastCalledWith({ target: 'service', action: 'stop' });
  });

  it('the Crew runner\'s buttons go to the runner, the gateway\'s to Settings → Remote access', async () => {
    const { root, client, settle } = setup();
    await settle();
    buttons(item(root, 'service.component.runner'), 'Stop')[0].click();
    expect(client.control).toHaveBeenCalledWith({ target: 'runner', action: 'stop' });
    await settle();
    buttons(item(root, 'service.component.gateway'), 'Start')[0].click();
    await settle();
    expect(client.setGateway).toHaveBeenCalledWith(true);
  });

  it('Change… offers the three log levels and stores the pick', async () => {
    const { root, client, fixture, settle } = setup();
    await settle();
    buttons(item(root, 'service.logs.level'), 'Change…')[0].click();
    fixture.detectChanges();
    const menu = [...item(root, 'service.logs.level').querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
    expect(menu.map(text)).toEqual(['Quiet', 'Normal', 'Detailed']);
    menu[2].click();
    expect(client.setPrefs).toHaveBeenCalledWith({ logLevel: 'detailed' });
  });

  it('opens the log folder', async () => {
    const { root, client, settle } = setup();
    await settle();
    buttons(item(root, 'service.logs.folder'), 'Open folder')[0].click();
    expect(client.openLogFolder).toHaveBeenCalled();
  });

  it('with the service stopped: Not running, one Start, the components off without buttons', async () => {
    const { root, settle } = setup({ status: { ...SERVICE_STOPPED, home: 'C:\\h' } });
    await settle();
    expect(text(item(root, 'service.status'))).toBe('Status Not running Start');
    expect(text(item(root, 'service.component.runner'))).toBe('Crew runner off');
  });

  it('with the plugin not answering the controls are disabled and show the defaults', async () => {
    const { root, client, settle } = setup({ prefs: null });
    await settle();
    expect(item(root, 'service.enabled').querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(item(root, 'service.load.seats').querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(client.setPrefs).not.toHaveBeenCalled();
  });
});
