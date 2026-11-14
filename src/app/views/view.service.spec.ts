import { TestBed } from '@angular/core/testing';
import type { DreyApi } from '../../../shared/ipc-api';
import { DockService, WidgetRegistryService } from '../dock';
import { PaneService } from '../panes';
import { EditorService } from '../services/editor.service';
import { FileOpenerRegistry } from '../services/file-opener-registry.service';
import { HomeViewRouter } from '../services/home-view-router.service';
import { ViewService } from './view.service';

describe('ViewService', () => {
  let views: ViewService;
  let editor: EditorService;
  let panes: PaneService;
  let dock: DockService;

  beforeEach(() => {
    localStorage.clear();
    window.dreyApi = {
      readVaultFile: (p: string) => Promise.resolve({ content: `body of ${p}`, modifiedMs: 1 }),
    } as unknown as DreyApi;
    views = TestBed.inject(ViewService);
    editor = TestBed.inject(EditorService);
    panes = TestBed.inject(PaneService);
    dock = TestBed.inject(DockService);
  });

  afterEach(() => {
    delete (window as { dreyApi?: unknown }).dreyApi;
    localStorage.clear();
  });

  it('starts with Notes only, active', () => {
    expect(views.views().map((v) => v.label)).toEqual(['Notes']);
    expect(views.activeId()).toBe('notes');
  });

  it('tells a listener when the active view changes (SDK 1.46)', () => {
    const id = views.saveCurrentAs('Review');
    expect(id).not.toBeNull();
    const seen: string[] = [];
    const off = views.onActiveChange(() => seen.push(views.activeId()));
    views.switchTo(id!);
    TestBed.tick();
    expect(seen).toEqual([id]);
    off();
    views.switchTo('notes');
    TestBed.tick();
    expect(seen).toEqual([id]);
  });

  it('saves the current layout as a view, switches to it and persists the list', async () => {
    await editor.openFile('a.md');
    dock.setDockWidth('left', 300);
    const id = views.saveCurrentAs('  Review  ');

    expect(views.activeId()).toBe(id);
    expect(views.active().label).toBe('Review');
    expect(dock.dockWidth('left')).toBe(300);
    expect(panes.tabsOfView(id)).toEqual(['a.md']); // the same document, shown here too
    expect(editor.openDocs().length).toBe(1); // ...but one document, one buffer
    expect(JSON.parse(localStorage.getItem('drey.views')!).views).toEqual([
      { id, label: 'Review', builtin: false },
    ]);
  });

  it('gives every view its own tabs: a tab opened in one is hidden in the other', async () => {
    await editor.openFile('a.md');
    const id = views.saveCurrentAs('Second');
    await editor.openFile('b.md', undefined, { keepFocused: true });
    expect(panes.tabsOfView(id)).toEqual(['a.md', 'b.md']);

    views.switchTo('notes');
    expect(panes.tabsOfView('notes')).toEqual(['a.md']);
    expect(editor.activePath()).toBe('a.md');
    expect(editor.openDocs().map((d) => d.key)).toEqual(['a.md', 'b.md']);
  });

  it('switches by index and to the next view, wrapping around', () => {
    const second = views.saveCurrentAs('Second');
    views.switchToIndex(0);
    expect(views.activeId()).toBe('notes');
    views.switchToIndex(5); // no such view: nothing happens
    expect(views.activeId()).toBe('notes');
    views.switchToNext();
    expect(views.activeId()).toBe(second);
    views.switchToNext();
    expect(views.activeId()).toBe('notes');
  });

  it('closing a tab removes it from this view only while another view shows it', async () => {
    await editor.openFile('a.md');
    const second = views.saveCurrentAs('Second');
    expect(await editor.closeTab('a.md')).toBe(true);

    expect(panes.tabsOfView(second)).toEqual([]);
    expect(panes.tabsOfView('notes')).toEqual(['a.md']);
    expect(editor.docFor('a.md')).not.toBeNull(); // still open in Notes
    views.switchTo('notes');
    expect(await editor.closeTab('a.md')).toBe(true);
    expect(editor.docFor('a.md')).toBeNull(); // the last view let go: closed for good
  });

  it('"Show this tab in" ticks a view on and off, but never the last one', async () => {
    await editor.openFile('a.md');
    const second = views.saveCurrentAs('Second');
    views.switchTo('notes');
    await editor.openFile('n.md');

    views.toggleTabIn('n.md', second);
    expect(views.viewsOfTab('n.md').sort()).toEqual(['notes', second].sort());
    views.toggleTabIn('n.md', 'notes');
    expect(views.viewsOfTab('n.md')).toEqual([second]);
    views.toggleTabIn('n.md', second); // the last view: stays
    expect(views.viewsOfTab('n.md')).toEqual([second]);
  });

  it('"Show here" brings a document of another view into the active one', async () => {
    const second = views.saveCurrentAs('Second');
    await editor.openFile('only-second.md');
    views.switchTo('notes');
    expect(panes.tabsOfView('notes')).toEqual([]);

    views.showHere('only-second.md');
    expect(panes.tabsOfView('notes')).toEqual(['only-second.md']);
    expect(views.viewsOfTab('only-second.md').sort()).toEqual(['notes', second].sort());
  });

  it('opening a file already open in another view adds it to the active view', async () => {
    const second = views.saveCurrentAs('Second');
    await editor.openFile('x.md');
    views.switchTo('notes');
    await editor.openFile('x.md');
    expect(panes.tabsOfView('notes')).toEqual(['x.md']);
    expect(editor.openDocs().length).toBe(1);
    expect(views.viewsOfTab('x.md')).toContain(second);
  });

  it('a delete of the file closes its tab in every view', async () => {
    await editor.openFile('a.md');
    const second = views.saveCurrentAs('Second');
    editor.closeTabsUnder(null, 'a.md');
    expect(panes.viewsHolding('a.md')).toEqual([]);
    expect(panes.tabsOfView(second)).toEqual([]);
  });

  it('renames a user view but never Notes; refuses a taken name', () => {
    const id = views.saveCurrentAs('Second');
    views.rename(id, 'Renamed');
    expect(views.active().label).toBe('Renamed');
    views.rename('notes', 'Nope');
    expect(views.views()[0].label).toBe('Notes');
    expect(views.labelTaken('notes')).toBe(true);
    expect(views.labelTaken('Renamed', id)).toBe(false);
  });

  it('the name field saves a view, rejects an empty or used name', () => {
    views.openSavePrompt();
    expect(views.commitPrompt('   ')).toBe(false);
    expect(views.commitPrompt('Notes')).toBe(false);
    expect(views.prompt()).not.toBeNull();
    expect(views.commitPrompt('Work')).toBe(true);
    expect(views.prompt()).toBeNull();
    expect(views.views().map((v) => v.label)).toEqual(['Notes', 'Work']);
  });

  it('deletes a user view: Notes becomes active, its own documents close, shared ones stay', async () => {
    await editor.openFile('shared.md');
    const second = views.saveCurrentAs('Second');
    await editor.openFile('mine.md');

    await views.remove(second);

    expect(views.activeId()).toBe('notes');
    expect(views.views().map((v) => v.label)).toEqual(['Notes']);
    expect(editor.docFor('mine.md')).toBeNull();
    expect(editor.docFor('shared.md')).not.toBeNull();
    expect(panes.tabsOfView('notes')).toEqual(['shared.md']);
  });

  it('cannot delete Notes', async () => {
    await views.remove('notes');
    expect(views.views().length).toBe(1);
  });

  it('reads the saved list back and falls back to Notes for an active view that no longer exists', () => {
    const id = views.saveCurrentAs('Second');
    expect(JSON.parse(localStorage.getItem('drey.dock')!).active).toBe(id);

    TestBed.resetTestingModule();
    localStorage.setItem('drey.views', JSON.stringify({ views: [] })); // the view was deleted elsewhere
    const again = TestBed.inject(ViewService);
    expect(again.views().map((v) => v.label)).toEqual(['Notes']);
    expect(again.activeId()).toBe('notes');
    expect(TestBed.inject(DockService).activeViewId()).toBe('notes');
  });
});

describe('ViewService presets and home views (SDK 1.39)', () => {
  let views: ViewService;
  let dock: DockService;
  let router: HomeViewRouter;

  beforeEach(() => {
    localStorage.clear();
    window.dreyApi = {
      readVaultFile: (p: string) => Promise.resolve({ content: `body of ${p}`, modifiedMs: 1 }),
    } as unknown as DreyApi;
    views = TestBed.inject(ViewService);
    dock = TestBed.inject(DockService);
    router = TestBed.inject(HomeViewRouter);
  });

  afterEach(() => {
    delete (window as { dreyApi?: unknown }).dreyApi;
    localStorage.clear();
  });

  it('lists a preset after Notes and before user views; presets are not saved or deletable', async () => {
    views.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    const user = views.saveCurrentAs('Mine');
    expect(views.views().map((v) => v.label)).toEqual(['Notes', 'Work', 'Mine']);
    expect(views.views()[1]).toMatchObject({ id: 'acme.work', builtin: true, pluginId: 'acme' });
    expect(JSON.parse(localStorage.getItem('drey.views')!).views.map((v: { id: string }) => v.id)).toEqual([user]);

    views.openRenamePrompt('acme.work');
    expect(views.prompt()).toBeNull();
    await views.remove('acme.work');
    expect(views.views().length).toBe(3);
  });

  it('refuses a taken or empty id', () => {
    const first = views.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    views.registerPreset('other', { id: 'acme.work', label: 'Imposter' });
    views.registerPreset('other', { id: 'notes', label: 'Notes 2' });
    views.registerPreset('other', { id: ' ', label: 'Blank' });
    expect(views.views().map((v) => v.label)).toEqual(['Notes', 'Work']);
    first();
    expect(views.views().map((v) => v.label)).toEqual(['Notes']);
  });

  it('a plugin flags its own preset with a badge (SDK 1.50); another plugin or a user view is refused', () => {
    views.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    const user = views.saveCurrentAs('Mine')!;
    views.setBadge('acme', 'acme.work', true);
    expect(views.badge('acme.work')).toBe(true);
    views.setBadge('other', 'acme.work', false); // not its preset: ignored
    expect(views.badge('acme.work')).toBe(true);
    views.setBadge('acme', user, true); // a user view: ignored
    expect(views.badge(user)).toBe(false);
    views.setBadge('acme', 'acme.work', false);
    expect(views.badge('acme.work')).toBe(false);
  });

  it('the badge goes with the preset when its plugin unregisters it', () => {
    const off = views.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    views.setBadge('acme', 'acme.work', true);
    off();
    expect(views.badge('acme.work')).toBe(false);
  });

  it('opens the preset\'s own tabs through the host\'s opener on every visit, only those the view does not hold (SDK 1.50)', () => {
    const opened: string[] = [];
    views.registerPreset(
      'acme',
      { id: 'acme.crew', label: 'Crew', layout: { openTabs: [{ kind: 'acme-team', path: 'team://all' }] } },
      (kind, path) => {
        opened.push(`${kind} ${path}`);
        TestBed.inject(EditorService).addPluginDoc(kind, path, 'Crew');
      },
    );
    views.switchTo('acme.crew');
    expect(opened).toEqual(['acme-team team://all']);
    expect(TestBed.inject(PaneService).tabsOfView('acme.crew')).toContain('team://all');

    views.switchTo('notes');
    expect(TestBed.inject(PaneService).tabsOfView('notes')).not.toContain('team://all'); // the tab belongs to the Crew view
    views.switchTo('acme.crew');
    expect(opened.length).toBe(1); // held already: not opened twice
  });

  it('an opener that throws costs the switch nothing', () => {
    views.registerPreset(
      'acme',
      { id: 'acme.crew', label: 'Crew', layout: { openTabs: [{ kind: 'gone', path: 'x://1' }] } },
      () => {
        throw new Error('kind not registered');
      },
    );
    expect(() => views.switchTo('acme.crew')).not.toThrow();
    expect(views.activeId()).toBe('acme.crew');
  });

  it('applies the preset layout the first time the view is shown, then keeps the owner\'s changes', () => {
    views.registerPreset('acme', {
      id: 'acme.work',
      label: 'Work',
      layout: { left: ['files'], right: ['windows', 'calendar'], open: ['files'], folded: ['right'] },
    });
    views.switchTo('acme.work');

    expect(dock.leftIds()).toContain('files');
    expect(dock.rightIds().slice(0, 2)).toEqual(['windows', 'calendar']);
    expect(dock.closed('files')).toBe(false);
    expect(dock.closed('windows')).toBe(true); // named but not in `open`
    expect(dock.closed('calendar')).toBe(true);
    expect(dock.sideFolded('right')).toBe(true);
    expect(dock.sideFolded('left')).toBe(false);

    dock.toggleSide('right');
    views.switchTo('notes');
    views.switchTo('acme.work');
    expect(dock.sideFolded('right')).toBe(false); // the owner's arrangement, not the preset's
  });

  it('skips unknown panel ids and leaves unnamed panels closed in their default dock', () => {
    views.registerPreset('acme', { id: 'acme.work', label: 'Work', layout: { left: ['nope', 'files'] } });
    views.switchTo('acme.work');
    expect(dock.leftIds()).toContain('files');
    expect(dock.leftIds()).not.toContain('nope');
    expect(dock.closed('files')).toBe(false);
    expect(dock.closed('calendar')).toBe(true);
  });

  it('carries the preset\'s Assistant target per view', () => {
    views.registerPreset('acme', { id: 'acme.work', label: 'Work', assistantTarget: 'acme.agent' });
    expect(views.assistantTarget()).toBeNull();
    views.switchTo('acme.work');
    expect(views.assistantTarget()).toBe('acme.agent');
    views.switchTo('notes');
    expect(views.assistantTarget()).toBeNull();
  });

  it('removing the active preset lands in Notes', () => {
    const off = views.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    views.switchTo('acme.work');
    off();
    expect(views.activeId()).toBe('notes');
    expect(views.views().length).toBe(1);
  });

  it('keeps an active preset from the last run until the plugins registered, then settles', () => {
    views.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    views.switchTo('acme.work');

    // Restart: the plugin registers its preset a moment after ViewService exists.
    TestBed.resetTestingModule();
    const again = TestBed.inject(ViewService);
    expect(again.activeId()).toBe('acme.work');
    again.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    again.settleStartup();
    expect(again.activeId()).toBe('acme.work');

    // Restart with the plugin gone: back to Notes, layout kept for later.
    TestBed.resetTestingModule();
    const gone = TestBed.inject(ViewService);
    gone.settleStartup();
    expect(gone.activeId()).toBe('notes');
    expect(TestBed.inject(DockService).activeViewId()).toBe('notes');
    expect(JSON.parse(localStorage.getItem('drey.dock')!).views['acme.work']).toBeDefined();
  });

  it('routes a document to its home view; unknown views, suspension and stayInView do nothing', async () => {
    views.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    router.enter(undefined);
    router.enter('acme.nope');
    expect(views.activeId()).toBe('notes');

    const release = router.suspend();
    router.enter('acme.work');
    expect(views.activeId()).toBe('notes');
    release();
    release(); // idempotent
    router.enter('acme.work');
    expect(views.activeId()).toBe('acme.work');
  });

  it('opening a file a plugin opener claims switches to the opener\'s home view first', async () => {
    const editor = TestBed.inject(EditorService);
    const openers = TestBed.inject(FileOpenerRegistry);
    views.registerPreset('acme', { id: 'acme.work', label: 'Work' });
    const landed: string[] = [];
    openers.register({
      extensions: ['.board'],
      homeView: 'acme.work',
      open: (path) => landed.push(`${views.activeId()}:${path}`),
    });

    await editor.openFile('x.board');
    expect(landed).toEqual(['acme.work:x.board']);

    views.switchTo('notes');
    await editor.openFile('y.board', undefined, { stayInView: true });
    expect(landed[1]).toBe('notes:y.board');
    expect(views.activeId()).toBe('notes');
  });
});

describe('ViewService saved layouts (D-6: a view saves only by "Save view")', () => {
  let views: ViewService;
  let dock: DockService;
  let editor: EditorService;
  let panes: PaneService;
  const savedStore = (): { views: Record<string, unknown> } =>
    JSON.parse(localStorage.getItem('drey.views.saved') ?? '{"views":{}}') as { views: Record<string, unknown> };

  beforeEach(() => {
    localStorage.clear();
    window.dreyApi = {
      readVaultFile: (p: string) => Promise.resolve({ content: `body of ${p}`, modifiedMs: 1 }),
    } as unknown as DreyApi;
    views = TestBed.inject(ViewService);
    dock = TestBed.inject(DockService);
    editor = TestBed.inject(EditorService);
    panes = TestBed.inject(PaneService);
    views.adoptBaselines();
  });

  afterEach(() => {
    delete (window as { dreyApi?: unknown }).dreyApi;
    localStorage.clear();
  });

  it('starts unmodified', () => {
    expect(views.modified()).toBe(false);
  });

  it('a panel resize marks the view modified and saves nothing', () => {
    const before = JSON.stringify(savedStore());
    dock.setDockWidth('left', 321);
    expect(views.modified()).toBe(true);
    expect(JSON.stringify(savedStore())).toBe(before);
  });

  it('a tab change marks the view modified and saves nothing', async () => {
    const before = JSON.stringify(savedStore());
    await editor.openFile('a.md');
    expect(views.modified()).toBe(true);
    expect(JSON.stringify(savedStore())).toBe(before);
  });

  it('only switching the active tab is not a modification', async () => {
    await editor.openFile('a.md');
    editor.setPinned('a.md', true);
    await editor.openFile('b.md');
    views.saveActive();
    editor.activate('a.md');
    expect(views.modified()).toBe(false);
  });

  it('"Save view" keeps the layout and clears the modified state', () => {
    dock.setDockWidth('left', 321);
    views.saveActive();
    expect(views.modified()).toBe(false);
    expect(savedStore().views['notes']).toBeDefined();
    dock.setDockWidth('left', 400);
    expect(views.modified()).toBe(true);
  });

  it('"Revert view" brings the saved layout back, docks and tabs', async () => {
    const width = dock.dockWidth('left');
    await editor.openFile('a.md');
    editor.setPinned('a.md', true);
    views.saveActive();
    dock.setDockWidth('left', 321);
    await editor.openFile('b.md');
    expect(views.modified()).toBe(true);

    await views.revertActive();

    expect(dock.dockWidth('left')).not.toBe(321);
    expect(width).toBeGreaterThan(0);
    expect(panes.tabsOfView('notes')).toEqual(['a.md']);
    expect(views.modified()).toBe(false);
  });

  it('an unsaved change stays with the view across a switch (session-local)', () => {
    const second = views.saveCurrentAs('Second');
    dock.setDockWidth('left', 321);
    views.switchTo('notes');
    views.switchTo(second);
    expect(dock.dockWidth('left')).toBe(321);
    expect(views.modified()).toBe(true);
  });

  it('a view made by "Save current layout as a view" starts unmodified', () => {
    dock.setDockWidth('left', 321);
    views.saveCurrentAs('Second');
    expect(views.modified()).toBe(false);
  });
});

describe('ViewService "Reset layout": the active view back to its own default (req-297)', () => {
  let views: ViewService;
  let dock: DockService;
  let panes: PaneService;
  let editor: EditorService;
  const opened: string[] = [];
  const PRESET = {
    id: 'acme.work',
    label: 'Work',
    layout: {
      left: ['files'],
      right: ['windows', 'calendar'],
      bottom: [],
      open: ['windows'],
      folded: ['left' as const],
      openTabs: [{ kind: 'acme-board', path: 'board://all' }],
    },
  };

  beforeEach(() => {
    localStorage.clear();
    opened.length = 0;
    window.dreyApi = {
      readVaultFile: (p: string) => Promise.resolve({ content: `body of ${p}`, modifiedMs: 1 }),
    } as unknown as DreyApi;
    views = TestBed.inject(ViewService);
    dock = TestBed.inject(DockService);
    panes = TestBed.inject(PaneService);
    editor = TestBed.inject(EditorService);
    views.registerPreset('acme', PRESET, (kind, path) => {
      opened.push(`${views.activeId()} ${kind} ${path}`);
      editor.addPluginDoc(kind, path, 'Board');
    });
    views.adoptBaselines();
  });

  afterEach(() => {
    delete (window as { dreyApi?: unknown }).dreyApi;
    localStorage.clear();
  });

  it('a preset view goes back to its preset layout, re-seeded, and its own tabs come back', async () => {
    views.switchTo('acme.work');
    dock.toggleSide('left');
    dock.toggle('calendar');
    dock.setDockWidth('right', 500);
    dock.move('files', 'right', 0);
    await editor.closeTab('board://all');
    expect(panes.tabsOfView('acme.work')).not.toContain('board://all');

    views.resetActive();

    expect(dock.sideFolded('left')).toBe(true);
    expect(dock.leftIds()[0]).toBe('files');
    expect(dock.rightIds().slice(0, 2)).toEqual(['windows', 'calendar']);
    expect(dock.closed('windows')).toBe(false);
    expect(dock.closed('calendar')).toBe(true);
    expect(dock.dockWidth('right')).toBe(380);
    expect(panes.tabsOfView('acme.work')).toContain('board://all');
    expect(opened.at(-1)).toBe('acme.work acme-board board://all');
  });

  it('Notes goes back to the base defaults, not to a preset (board 7p)', () => {
    dock.toggleSide('left');
    dock.toggle('windows');
    dock.setDockWidth('left', 200);
    dock.setDockWidth('right', 200);
    dock.toggle('calendar');

    views.resetActive();

    expect(views.activeId()).toBe('notes');
    expect(dock.sideFolded('left')).toBe(false);
    expect(dock.leftIds()).toEqual(['calendar', 'files', 'windows']);
    expect(dock.closed('calendar')).toBe(false);
    expect(dock.closed('files')).toBe(false);
    expect(dock.closed('windows')).toBe(true);
    expect(dock.dockWidth('left')).toBe(300);
    expect(dock.dockWidth('right')).toBe(380);
    expect(dock.hasBottom()).toBe(false);
    expect(opened).toEqual([]);
  });

  it('a user view copied from a preset goes back to the base defaults, not the preset it was copied from', () => {
    views.switchTo('acme.work');
    const mine = views.saveCurrentAs('Mine');
    expect(dock.sideFolded('left')).toBe(true);

    views.resetActive();

    expect(views.activeId()).toBe(mine);
    expect(dock.sideFolded('left')).toBe(false);
    expect(dock.leftIds()).toEqual(['calendar', 'files', 'windows']);
    expect(dock.closed('windows')).toBe(true);
  });

  it('alters the working layout only: the saved layout stays and "Reset to saved layout" brings it back (D-6)', async () => {
    views.switchTo('acme.work');
    dock.toggleSide('left');
    dock.setDockWidth('right', 450);
    views.saveActive();
    const saved = JSON.parse(localStorage.getItem('drey.views.saved')!).views['acme.work'] as unknown;

    views.resetActive();

    expect(views.modified()).toBe(true);
    expect(JSON.parse(localStorage.getItem('drey.views.saved')!).views['acme.work']).toEqual(saved);
    await views.revertActive();
    expect(dock.sideFolded('left')).toBe(false);
    expect(dock.dockWidth('right')).toBe(450);
    expect(views.modified()).toBe(false);
  });

  it('resets the active view only: another view keeps its arrangement', () => {
    dock.setDockWidth('left', 222);
    views.switchTo('acme.work');
    views.resetActive();
    views.switchTo('notes');
    expect(dock.dockWidth('left')).toBe(222);
  });

  it('a preset view opens unmodified: its own tabs are part of the layout its first showing adopts', () => {
    views.switchTo('acme.work');
    expect(panes.tabsOfView('acme.work')).toContain('board://all');
    expect(views.modified()).toBe(false);
  });

  it('a reset to the layout the view already had is no change, whatever order the panels registered in', () => {
    // A plugin panel that registers after the dock exists, ordered before Files: the running
    // layout lists it last, a reset lists it in default order -- the same layout.
    TestBed.inject(WidgetRegistryService).registerPluginWidget({
      id: 'acme.panel',
      title: 'Acme',
      defaultDock: 'left',
      defaultOpen: false,
      defaultFlex: 100,
      order: 15,
      mount: () => () => undefined,
    });
    TestBed.tick();
    views.saveActive();
    views.resetActive();
    expect(dock.leftIds()).toEqual(['calendar', 'acme.panel', 'files', 'windows']);
    expect(views.modified()).toBe(false);
  });

  it('after a reset of a disturbed preset view, the view equals its first showing again', async () => {
    views.switchTo('acme.work');
    dock.toggleSide('left');
    dock.toggleSide('right');
    await editor.closeTab('board://all');
    expect(views.modified()).toBe(true);
    views.resetActive();
    expect(views.modified()).toBe(false);
  });

  it("a preset's own tab opens in the preset even when its kind names another home view", () => {
    const off = views.registerPreset('acme', { id: 'acme.crew', label: 'Crew', layout: { openTabs: [{ kind: 'acme-team', path: 'team://all' }] } }, (kind, path) => {
      // The Crew tab's kind names Work as its home view (tickets plugin): routing must not pull the view away.
      TestBed.inject(HomeViewRouter).enter('acme.work');
      editor.addPluginDoc(kind, path, 'Crew');
    });
    views.switchTo('acme.crew');
    expect(views.activeId()).toBe('acme.crew');
    expect(panes.tabsOfView('acme.crew')).toContain('team://all');
    off();
  });
});
