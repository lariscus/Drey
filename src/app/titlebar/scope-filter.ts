import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Icon } from '../icons/icon';
import { OverlayGuardDirective } from '../services/overlay-guard.directive';
import { WorkspaceScopeService } from '../views';

/**
 * The title bar's scope filter (SDK 1.59, req-285, board 7n): a dot, the
 * active view's choice (or the plugin's "all" label) and a chevron, right of
 * the view switcher. Its menu: all · each choice (a check on the picked one,
 * a count where the plugin gives one) · a separator · the plugin's manage
 * row. Draws nothing while no plugin has registered a filter. The words are
 * the plugin's (its catalog); the base has none of its own here.
 */
@Component({
  selector: 'app-scope-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, OverlayGuardDirective],
  templateUrl: './scope-filter.html',
  styleUrl: './scope-filter.css',
})
export class ScopeFilter {
  protected readonly scope = inject(WorkspaceScopeService);
  protected readonly open = signal(false);

  protected readonly label = computed(() => this.scope.active()?.label ?? this.scope.contrib()?.allLabel ?? '');
  /** The "all" dot: the first three choices' colours as one wheel. */
  protected readonly allDot = computed(() => {
    const colors = this.scope
      .choices()
      .map((o) => o.color)
      .filter((c) => c !== '')
      .slice(0, 3);
    if (colors.length === 0) {
      return 'var(--text-4)';
    }
    const step = 100 / colors.length;
    return `conic-gradient(${colors.map((c, i) => `${c} 0 ${Math.round(step * (i + 1))}%`).join(', ')})`;
  });

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected pick(id: string | null): void {
    this.scope.pick(id);
    this.open.set(false);
  }

  protected manage(): void {
    this.open.set(false);
    this.scope.manage();
  }
}
