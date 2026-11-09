import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName = 'restart' | 'stop' | 'start' | 'release' | 'minimize' | 'maximize' | 'close' | 'chevron-down';

/** The window's inline glyphs: 24-unit grid, 1.75 stroke, as the boards draw them. */
@Component({
  selector: 'sw-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon.html',
  styleUrl: './icon.css',
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(16);
}
