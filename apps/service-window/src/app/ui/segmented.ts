import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** The log filters' segmented control: 26 px segments in a bordered 8 px frame. */
@Component({
  selector: 'sw-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './segmented.html',
  styleUrl: './segmented.css',
})
export class Segmented<T extends string = string> {
  readonly options = input.required<readonly SegmentOption<T>[]>();
  readonly value = input.required<T>();
  readonly label = input.required<string>();
  readonly picked = output<T>();
}
