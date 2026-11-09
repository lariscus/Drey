import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SERVICE_WINDOW_API } from './api/service-window-api';
import { DemoServiceWindowApi } from './api/demo-api';
import { App } from './app';

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function setup(): { api: DemoServiceWindowApi; root: HTMLElement; fixture: ReturnType<typeof TestBed.createComponent<App>> } {
  const api = new DemoServiceWindowApi();
  TestBed.configureTestingModule({ providers: [{ provide: SERVICE_WINDOW_API, useValue: api }] });
  const fixture = TestBed.createComponent(App);
  return { api, fixture, root: fixture.nativeElement as HTMLElement };
}

describe('Drey Service window', () => {
  it('renders the Components tab from the demo data', async () => {
    const { fixture, root } = setup();
    await settle(fixture);
    const text = root.textContent ?? '';
    expect(text).toContain('Running since 08:12');
    expect(text).toContain('Crew runner');
    expect(text).toContain('Claude A');
    expect(text).toContain('Heavy seats');
    expect(text).toContain('runner up, home');
    expect(text).toContain('Quit service');
    expect(root.querySelectorAll('.srow')).toHaveLength(4);
  });

  it('restarts a component through the bridge', async () => {
    const { api, fixture, root } = setup();
    await settle(fixture);
    const button = root.querySelector<HTMLButtonElement>('button[aria-label="Restart Crew runner"]');
    button?.click();
    expect(api.calls).toContain('component:runner:restart');
  });

  it('shows the selected session on the Sessions tab and sends a message', async () => {
    const { api, fixture, root } = setup();
    await settle(fixture);
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click();
    await settle(fixture);
    expect(root.textContent).toContain('3 sessions · 2 runs · 1 held');
    const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('.main'));
    rows.find((row) => row.textContent?.includes('T-0121'))?.click();
    await settle(fixture);
    const text = root.textContent ?? '';
    expect(text).toContain('112k in (98k cached) · 4.1k out · $0.61');
    expect(text).toContain('turn 3 · input 41k (38k cached) · output 1.4k');
    const input = root.querySelector<HTMLInputElement>('input.field')!;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(fixture);
    expect(api.calls).toContain('run:R-20261107T0833-c02e:send:hello');
    expect(input.value).toBe('');
  });

  it('draws the Logs tab with the component filter', async () => {
    const { fixture, root } = setup();
    await settle(fixture);
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2]?.click();
    await settle(fixture);
    expect(root.textContent).toContain('All components');
    expect(root.textContent).toContain('tranche 4 of 10 runs');
  });
});
