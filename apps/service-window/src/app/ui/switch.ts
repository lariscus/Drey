import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** The Follow switch: 32x18, accent while on. */
@Component({
  selector: 'sw-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './switch.html',
  styleUrl: './switch.css',
})
export class Switch {
  readonly checked = input.required<boolean>();
  readonly label = input.required<string>();
  readonly toggled = output<boolean>();
}
