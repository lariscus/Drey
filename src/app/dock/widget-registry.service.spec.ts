import { TestBed } from '@angular/core/testing';
import { WidgetRegistryService } from './widget-registry.service';
import { CORE_WIDGETS } from './widget-registry';
import { PaneService } from '../panes/pane.service';

describe('WidgetRegistryService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('exposes the core widgets', () => {
    const registry = TestBed.inject(WidgetRegistryService);
    expect(registry.widgets().map((w) => w.id)).toEqual(CORE_WIDGETS.map((w) => w.id));
  });

  it('registers a plugin widget and exposes it through the derived views', () => {
    const registry = TestBed.inject(WidgetRegistryService);
    const unsubscribe = registry.registerPluginWidget({
      id: 'spec',
      title: 'Spec',
      defaultDock: 'left',
      defaultOpen: true,
      defaultFlex: 100,
      mount: () => () => undefined,
    });
    expect(registry.widgets().map((w) => w.id)).toContain('spec');
    expect(registry.isPlugin('spec')).toBe(true);
    expect(registry.contribFor('spec')?.title).toBe('Spec');
    unsubscribe();
    expect(registry.isPlugin('spec')).toBe(false);
    expect(registry.widgets().map((w) => w.id)).toEqual(CORE_WIDGETS.map((w) => w.id));
  });

  it('orders the widgets by their default order (SDK 1.60); the unordered ones follow in registration order', () => {
    const registry = TestBed.inject(WidgetRegistryService);
    const widget = (id: string, order?: number) => ({
      id,
      title: id,
      defaultDock: 'left' as const,
      defaultOpen: false,
      defaultFlex: 100,
      ...(order !== undefined ? { order } : {}),
      mount: () => () => undefined,
    });
    registry.registerPluginWidget(widget('late'));
    registry.registerPluginWidget(widget('tickets', 70));
    registry.registerPluginWidget(widget('find', 30));
    registry.registerPluginWidget(widget('templates', 40));
    registry.registerPluginWidget(widget('junk', Number.NaN));
    // Board 7p: Calendar, Files, Find, Templates, Open windows, ..., Tickets.
    expect(registry.widgets().map((w) => w.id)).toEqual(['calendar', 'files', 'find', 'templates', 'windows', 'tickets', 'late', 'junk']);
  });

  it('Open windows reads "N here · M elsewhere" once other views hold tabs', () => {
    const registry = TestBed.inject(WidgetRegistryService);
    const panes = TestBed.inject(PaneService);
    const status = (): string | null | undefined =>
      registry.descriptor('windows')?.status?.({ collapsed: false });
    panes.open('a.md');
    expect(status()).toBe('1');
    panes.showInView('other', 'b.md');
    expect(status()).toBe('1 here · 1 elsewhere');
  });

  it('gives every core widget a strip icon', () => {
    const registry = TestBed.inject(WidgetRegistryService);
    for (const w of registry.widgets()) {
      expect(w.icon).toBeDefined();
    }
  });

  it('passes a plugin widget icon through, and drops a name the host does not vendor', () => {
    const registry = TestBed.inject(WidgetRegistryService);
    const contrib = {
      title: 'Spec',
      defaultDock: 'left' as const,
      defaultOpen: true,
      defaultFlex: 100,
      mount: () => () => undefined,
    };
    registry.registerPluginWidget({ ...contrib, id: 'known', icon: 'search' });
    registry.registerPluginWidget({ ...contrib, id: 'unknown', icon: 'no-such-glyph' });
    registry.registerPluginWidget({ ...contrib, id: 'none' });
    expect(registry.descriptor('known')?.icon).toBe('search');
    expect(registry.descriptor('unknown')?.icon).toBeUndefined();
    expect(registry.descriptor('none')?.icon).toBeUndefined();
  });

  it('refuses a plugin widget id that collides with a core widget', () => {
    const registry = TestBed.inject(WidgetRegistryService);
    expect(() =>
      registry.registerPluginWidget({
        id: 'calendar',
        title: 'Impostor',
        defaultDock: 'left',
        defaultOpen: true,
        defaultFlex: 100,
        mount: () => () => undefined,
      } as never),
    ).toThrowError(/collides with a core widget/);
  });

  it('refuses a duplicate plugin widget id', () => {
    const registry = TestBed.inject(WidgetRegistryService);
    const register = (): void => {
      registry.registerPluginWidget({
        id: 'dup',
        title: 'Dup',
        defaultDock: 'left',
        defaultOpen: true,
        defaultFlex: 100,
        mount: () => () => undefined,
      });
    };
    register();
    expect(register).toThrowError(/already registered by a plugin/);
  });
});
