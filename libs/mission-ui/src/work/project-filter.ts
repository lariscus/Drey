import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { McI18nPipe } from '../i18n/i18n.pipe';
import { PhoneIcon } from '../phone/icon';
import { allProjectsDotOf, type McProject, type McProjectChoice, type McProjectFilter } from './projects';

/** The frame the filter is drawn in: the phone's cost strip, the iPad header, the desk's top nav. */
export type ProjectFilterFace = 'phone' | 'pad' | 'desk';

/**
 * Mission Control's project filter (req-298): board 7n's control — a dot, the
 * choice (or *All projects*), a chevron — and its menu: *All projects* with the
 * wheel of the first three colours, each project, *Unassigned* with its count.
 * No *Manage projects…* row: Mission Control does not edit projects. Each face
 * keeps its frame's style: a group of its own beside the area switch on the
 * iPad and beside the tabs on the desk, a plain end of the cost strip on the
 * phone. The choice is the parent's (device-local); this only draws and picks.
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
  /** The choice in effect; null = all projects. */
  readonly value = input<McProjectFilter>(null);

  readonly pick = output<McProjectFilter>();

  protected readonly open = signal(false);

  protected readonly faceClass = computed(() => `face-${this.face()}`);
  protected readonly active = computed(() => this.choices().find((choice) => choice.id === this.value()) ?? null);
  protected readonly allDot = computed(() => allProjectsDotOf(this.projects()));

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected choose(filter: McProjectFilter): void {
    this.open.set(false);
    if (filter !== this.value()) {
      this.pick.emit(filter);
    }
  }
}
