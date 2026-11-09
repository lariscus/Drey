import { Directive, ElementRef, afterRenderEffect, inject, input, output } from '@angular/core';

/**
 * Keeps a scrolling list at its bottom while `swFollow` is on and the content
 * (`swTick`) changes; the reader scrolling up emits `followLost` so the owner
 * can turn Follow off.
 */
@Directive({
  selector: '[swFollow]',
  host: { '(scroll)': 'onScroll()' },
})
export class FollowScroll {
  readonly swFollow = input.required<boolean>();
  readonly swTick = input<unknown>(null);
  readonly followLost = output<void>();

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    afterRenderEffect(() => {
      this.swTick();
      if (this.swFollow()) {
        this.element.scrollTop = this.element.scrollHeight;
      }
    });
  }

  onScroll(): void {
    const gap = this.element.scrollHeight - this.element.scrollTop - this.element.clientHeight;
    if (gap > 24 && this.swFollow()) {
      this.followLost.emit();
    }
  }
}
