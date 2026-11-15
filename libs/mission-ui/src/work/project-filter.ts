import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { McI18nPipe } from '../i18n/i18n.pipe';
import { PhoneIcon } from '../phone/icon';
import type { McProject, McProjectChoice, McProjectFilter } from './projects';

/** The frame the filter is drawn in: the phone's cost strip, the iPad header, the desk's top nav. */
export type ProjectFilterFace = 'phone' | 'pad' | 'desk';

/**
 * Mission Control's project filter (req-298; req-308: one project is always
 * active — no *All projects*, no *Unassigned*): board 7n's control — a dot,
 * the active project's name, a chevron — and its menu, one row per project.
 * No *Manage projects…* row: Mission Control does not edit projects. Each
 * face keeps its frame's style: a group of its own beside the area switch on
 * the iPad and beside the tabs on the desk, a plain end of the cost strip on
 * the phone. The choice is the parent's (device-local); this only draws and
 * picks.
 */
@Component({
  selector: 'mc-project-filter',
  imports: [McI18nPipe, PhoneIcon],
  templateUrl: './project-filter.html',
  styleUrl: './project-filter.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'faceClass()' },
})
export class ProjectFilter {
  readonly face = input<ProjectFilterFace>('phone');
  readonly projects = input.required<readonly McProject[]>();
  readonly choices = input.required<readonly McProjectChoice[]>();
  /** The choice in effect; null only on a board without projects. */
  readonly value = input<McProjectFilter>(null);

  readonly pick = output<string>();

  protected readonly open = signal(false);

  protected readonly faceClass = computed(() => `face-${this.face()}`);
  protected readonly active = computed(() => this.choices().find((choice) => choice.id === this.value()) ?? null);

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected choose(id: string): void {
    this.open.set(false);
    if (id !== this.value()) {
      this.pick.emit(id);
    }
  }
}
