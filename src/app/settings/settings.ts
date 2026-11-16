import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  type OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { I18nPipe } from '../i18n';
import { Icon } from '../icons/icon';
import { EditorService } from '../services/editor.service';
import { SettingsService } from '../services/settings.service';
import { SETTINGS_DOC_KEY } from './settings-doc';
import { SettingsCategoryRegistry } from './settings-registry.service';
import {
  activeSection,
  searchSettings,
  type SettingsSearchEntry,
  type SettingsSearchHit,
  type SettingsSection,
} from './settings-model';

/** Distance below the scrollport's top at which a section counts as reached. */
const SPY_OFFSET = 24;

/**
 * The Settings screen: master-detail per CLAUDE.md's "UI/UX Design" -- a
 * category list on the left, the detail pane on the right. Shown as an
 * editor tab (board 7g; `SettingsTabService` mounts it into the pane's body).
 * The category list is a data-driven
 * registry (`SettingsCategory[]`), rendered through `NgComponentOutlet`, so
 * a new category is one array entry -- no `@switch` to extend.
 *
 * Every change is applied as it is made (ADR-0010 later change): a pane
 * writes `SettingsService.draft`, which saves itself. This component tells
 * the service while a text field has the focus -- the save then waits for
 * the field to be left or Enter -- and flushes before the tab closes.
 * No footer, no Save, no Discard, no "unsaved changes" prompt; Escape
 * closes the tab like any tab's close.
 */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [I18nPipe, Icon, NgComponentOutlet],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
  host: {
    tabindex: '-1',
    style: 'display: flex; flex: 1; min-width: 0; min-height: 0; outline: none',
    '(document:keydown.escape)': 'onEscape($event)',
    '(window:blur)': 'flush()',
  },
})
export class Settings implements OnDestroy {
  protected readonly settings = inject(SettingsService);
  private readonly editor = inject(EditorService);
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The session this tab started (`SettingsService.openScreen`). */
  private readonly session = this.settings.openScreen(this.settings.openCategory() ?? undefined);
  private readonly registry = inject(SettingsCategoryRegistry);

  /** Core categories + plugin-contributed pages, from the registry. */
  protected readonly categories = this.registry.categories;

  /** A caller-named category (Help -> About) wins; falls back to the first. */
  private readonly presetCategory = this.settings.openCategory();

  constructor() {
    // Focus the tab itself (no ring), so Escape and the keys reach it without a field being picked.
    afterNextRender(() => this.hostEl.focus({ preventScroll: true }), { injector: this.injector });
    // The mounted page's sections (the nav's presence filter) — scanned after
    // the render and on every change the page makes to its own DOM.
    afterNextRender(() => {
      this.scanPresentSections();
      this.watchPresentSections();
    }, { injector: this.injector });
    effect(() => {
      const wanted = this.settings.openCategory();
      if (wanted !== null && this.categories().some((category) => category.id === wanted)) {
        untracked(() => {
          if (wanted !== this.selected()) {
            this.selectCategory(wanted);
          }
          this.settings.openCategory.set(null);
        });
      }
    });
    // A category change swaps the page before the next render settles.
    effect(() => {
      this.selected();
      this.afterRenderScan();
    });
  }

  private afterRenderScan(): void {
    afterNextRender(() => {
      this.scanPresentSections();
      this.watchPresentSections();
    }, { injector: this.injector });
  }

  protected readonly selected = signal<string>(
    this.presetCategory !== null &&
      this.categories().some((category) => category.id === this.presetCategory)
      ? this.presetCategory
      : (this.categories()[0]?.id ?? ''),
  );

  protected readonly selectedComponent = computed(
    () =>
      (this.registry.categoryFor(this.selected()) ?? this.categories()[0]).component,
  );

  /** `{ contrib }` for a plugin page, `undefined` for a core one. */
  protected readonly selectedInputs = computed(() => this.registry.inputsFor(this.selected()));

  private readonly injector = inject(Injector);
  private readonly detail = viewChild<ElementRef<HTMLElement>>('detail');

  /**
   * The section ids the mounted page actually renders (`data-settings-section`
   * anchors — the spy reads the same elements). The nav under a selected
   * category shows only these: a page's chapters are what the page carries,
   * not what an older registration listed (the tickets page's setup block,
   * D-74, is a chapter exactly while it shows).
   */
  protected readonly presentSections = signal<ReadonlySet<string>>(new Set());
  private presentObserver: MutationObserver | null = null;
  private presentTimer: ReturnType<typeof setTimeout> | null = null;

  private scanPresentSections(): void {
    const root = this.detail()?.nativeElement;
    if (!root) {
      return;
    }
    const ids = new Set<string>();
    for (const el of root.querySelectorAll<HTMLElement>('[data-settings-section]')) {
      const id = el.dataset['settingsSection'];
      if (id) {
        ids.add(id);
      }
    }
    this.presentSections.set(ids);
  }

  private watchPresentSections(): void {
    this.presentObserver?.disconnect();
    const root = this.detail()?.nativeElement;
    if (!root) {
      return;
    }
    this.presentObserver = new MutationObserver(() => {
      if (this.presentTimer !== null) {
        clearTimeout(this.presentTimer);
      }
      this.presentTimer = setTimeout(() => {
        this.presentTimer = null;
        this.scanPresentSections();
      }, 120);
    });
    this.presentObserver.observe(root, { childList: true, subtree: true });
  }

  /** A selected category's chapters, filtered to the ones the page renders; every other category keeps its list. */
  protected sectionsOf(category: { id: string; sections?: readonly SettingsSection[] }): readonly SettingsSection[] {
    const sections = category.sections ?? [];
    if (category.id !== this.selected()) {
      return sections;
    }
    const present = this.presentSections();
    if (present.size === 0) {
      return sections;
    }
    const visible = sections.filter((section) => present.has(section.id));
    return visible.length === 0 ? sections : visible;
  }

  protected readonly query = signal('');
  protected readonly hits = computed<readonly SettingsSearchHit[]>(() =>
    this.query().trim() === '' ? [] : searchSettings(this.registry.searchSources(), this.query()),
  );
  protected readonly searching = computed(() => this.query().trim() !== '');

  /** How many of the current hits a category holds (the tree shows it while searching). */
  protected categoryHits(id: string): number {
    return this.hits().filter((hit) => hit.categoryId === id).length;
  }

  protected sectionHits(categoryId: string, sectionId: string): number {
    return this.hits().filter((hit) => hit.categoryId === categoryId && hit.entry.section === sectionId).length;
  }

  protected clearSearch(): void {
    this.query.set('');
  }

  /** The section entry highlighted for the page's scroll position (E13-22). */
  protected readonly currentSection = signal<string | null>(null);

  /** A smooth scroll the page started itself is under way: the spy is held (D-54). */
  private programmaticScroll = false;
  /** Whether the spy runs once when that scroll ends (an entry scroll names no marker of its own). */
  private spyAfterProgrammaticScroll = false;

  /** A category's own expand/collapse choice; unset follows the selection. */
  private readonly expandChoice = signal<Readonly<Record<string, boolean>>>({});

  protected isExpanded(id: string): boolean {
    return this.expandChoice()[id] ?? this.selected() === id;
  }

  protected toggleExpanded(id: string): void {
    const open = this.isExpanded(id);
    this.expandChoice.update((choice) => ({ ...choice, [id]: !open }));
  }

  protected selectCategory(id: string): void {
    const again = this.selected() === id && !this.searching();
    this.clearSearch();
    if (again) {
      // A second click on the open category folds or unfolds its sections (board 7g).
      this.toggleExpanded(id);
    } else {
      this.expandChoice.update(({ [id]: _unset, ...rest }) => rest);
    }
    this.currentSection.set(null);
    this.programmaticScroll = false;
    this.selected.set(id);
    this.afterRender(() => {
      this.detail()?.nativeElement.scrollTo({ top: 0 });
      this.updateSpy();
    });
  }

  /** A click on a section entry: its page, scrolled to the section. */
  protected openSection(categoryId: string, sectionId: string): void {
    this.clearSearch();
    this.selected.set(categoryId);
    this.afterRender(() => this.scrollToSection(sectionId));
  }

  /** A search hit: its page, scrolled to the setting. */
  protected openHit(hit: SettingsSearchHit): void {
    this.clearSearch();
    this.selected.set(hit.categoryId);
    this.afterRender(() => this.scrollToEntry(hit.entry));
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.searching()) {
      this.clearSearch();
      event.stopPropagation();
    }
  }

  protected onScroll(): void {
    if (this.programmaticScroll) {
      return;
    }
    this.updateSpy();
  }

  /** A smooth scroll the page started itself came to rest: the spy follows the user again. */
  protected onScrollEnd(): void {
    this.endProgrammaticScroll(this.spyAfterProgrammaticScroll);
  }

  /** The user took the scroll over (wheel, touch, keys, the scrollbar): the page's own scroll is cancelled. */
  protected onUserScroll(event: Event): void {
    if (event instanceof PointerEvent && event.target !== event.currentTarget) {
      return;
    }
    this.endProgrammaticScroll(false);
  }

  private endProgrammaticScroll(spy: boolean): void {
    if (!this.programmaticScroll) {
      return;
    }
    this.programmaticScroll = false;
    if (spy) {
      this.updateSpy();
    }
  }

  /**
   * Scrolls the page smoothly and holds the spy until the scroll ends, so the
   * marker does not walk through every section on the way (D-54). A scroll
   * that would not move the page never ends, so it does not hold the spy.
   */
  private scrollSmoothly(root: HTMLElement, top: number, spyAfter: boolean): void {
    const reachable = Math.min(Math.max(0, top), Math.max(0, root.scrollHeight - root.clientHeight));
    if (Math.abs(reachable - root.scrollTop) >= 1) {
      this.programmaticScroll = true;
      this.spyAfterProgrammaticScroll = spyAfter;
    }
    root.scrollTo({ top, behavior: 'smooth' });
  }

  private afterRender(work: () => void): void {
    afterNextRender(work, { injector: this.injector });
  }

  private anchors(): { id: string; top: number }[] {
    const root = this.detail()?.nativeElement;
    if (!root) {
      return [];
    }
    const base = root.getBoundingClientRect().top - root.scrollTop;
    return [...root.querySelectorAll<HTMLElement>('[data-settings-section]')].map((el) => ({
      id: el.dataset['settingsSection'] ?? '',
      top: el.getBoundingClientRect().top - base,
    }));
  }

  private updateSpy(): void {
    const root = this.detail()?.nativeElement;
    if (!root || this.searching()) {
      return;
    }
    if (root.scrollTop === 0) {
      // At the top of a page no section is singled out (board 7g: only the category is lit).
      this.currentSection.set(null);
      return;
    }
    this.currentSection.set(activeSection(this.anchors(), root.scrollTop, SPY_OFFSET));
  }

  private scrollToSection(sectionId: string): void {
    const root = this.detail()?.nativeElement;
    const anchor = this.anchors().find((a) => a.id === sectionId);
    if (root && anchor) {
      this.scrollSmoothly(root, Math.max(0, anchor.top - SPY_OFFSET / 2), false);
      this.currentSection.set(sectionId);
    }
  }

  private scrollToEntry(entry: SettingsSearchEntry): void {
    const root = this.detail()?.nativeElement;
    if (!root) {
      return;
    }
    let target: HTMLElement | null =
      entry.key === ''
        ? null
        : root.querySelector<HTMLElement>(`[data-setting-key="${CSS.escape(entry.key)}"]`);
    if (!target && entry.key !== '') {
      target =
        [...root.querySelectorAll<HTMLElement>('label, h3, h4, .switch-label, .field-label')].find(
          (el) => el.textContent?.trim().startsWith(entry.label),
        ) ?? null;
    }
    if (target) {
      const found = target;
      // The setting centred in the page; the spy settles on the section where the scroll ends.
      const offset = found.getBoundingClientRect().top - root.getBoundingClientRect().top;
      this.scrollSmoothly(root, root.scrollTop + offset - (root.clientHeight - found.offsetHeight) / 2, true);
      found.classList.add('setting-found');
      setTimeout(() => found.classList.remove('setting-found'), 1600);
    } else if (entry.section) {
      this.scrollToSection(entry.section);
    } else {
      root.scrollTo({ top: 0 });
    }
  }

  /** A text field took the focus: hold the automatic save until it is left. */
  protected onFocusIn(event: FocusEvent): void {
    if (isTextEntry(event.target)) {
      this.settings.editingText.set(true);
    }
  }

  protected onFocusOut(event: FocusEvent): void {
    if (isTextEntry(event.target)) {
      this.settings.editingText.set(false);
      this.flush();
    }
  }

  /** Enter in a one-line field commits it (a textarea keeps Enter for the line break). */
  protected onEnter(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      // After the field's own `change` handler, which Enter also triggers.
      setTimeout(() => this.flush());
    }
  }

  protected flush(): void {
    void this.settings.flush();
  }

  /**
   * Saves what is pending, then closes the tab. A failed save keeps the tab
   * open with the error under the page, whose button then closes without
   * saving (`closeWithoutSaving`). Escape first leaves a search.
   */
  protected async requestClose(): Promise<void> {
    if (this.searching()) {
      this.clearSearch();
      return;
    }
    if (await this.settings.flush()) {
      void this.editor.closeTab(SETTINGS_DOC_KEY);
    }
  }

  /**
   * Escape closes the tab when it was meant for it: focus inside the tab, or on nothing (a button
   * that went away leaves it on the body). Focus in another pane, the palette or a dialog is theirs.
   */
  protected onEscape(event: Event): void {
    const target = event.target;
    if (target === document.body || (target instanceof Node && this.hostEl.contains(target))) {
      void this.requestClose();
    }
  }

  protected closeWithoutSaving(): void {
    this.settings.closeScreen(this.session);
    void this.editor.closeTab(SETTINGS_DOC_KEY);
  }

  /** The tab went (closed, or another tab shown): save what is pending, end the session. */
  ngOnDestroy(): void {
    if (this.presentTimer !== null) {
      clearTimeout(this.presentTimer);
    }
    this.presentObserver?.disconnect();
    void this.settings.flush().finally(() => this.settings.closeScreen(this.session));
  }
}

/** A field whose value is typed -- not a checkbox, radio, colour or file input. */
function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  return (
    target instanceof HTMLInputElement &&
    ['text', 'number', 'password', 'url', 'search', 'email', ''].includes(target.type)
  );
}
