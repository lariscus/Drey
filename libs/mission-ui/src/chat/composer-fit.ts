import { Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

/** The composer grows with its text up to this many rows, then scrolls (D-57). */
export const COMPOSER_MAX_ROWS = 5;

/** What the browser reports about the field, in CSS pixels. */
export interface ComposerMetrics {
  /** `scrollHeight` with the height released: the text's own height plus the vertical padding. */
  readonly scrollHeight: number;
  readonly lineHeight: number;
  readonly paddingY: number;
  readonly borderY: number;
  readonly borderBox: boolean;
}

/**
 * The height to set on the field and whether the text then outgrows it. The text decides, not the
 * count of `\n` — a sentence that wraps takes as many rows as it shows; five rows is the cap.
 */
export function composerFitOf(m: ComposerMetrics, maxRows = COMPOSER_MAX_ROWS): { readonly height: number; readonly scrolls: boolean; readonly grown: boolean } {
  const cap = maxRows * m.lineHeight + m.paddingY;
  const outer = Math.min(Math.max(m.scrollHeight, m.lineHeight + m.paddingY), cap);
  return {
    height: m.borderBox ? outer + m.borderY : outer - m.paddingY,
    scrolls: m.scrollHeight > cap + 0.5,
    grown: outer - m.paddingY > m.lineHeight * 1.5,
  };
}

/** Releases the height, measures the text, sets the height it needs. */
export function fitComposer(field: HTMLTextAreaElement, maxRows = COMPOSER_MAX_ROWS): void {
  field.style.height = 'auto';
  const style = getComputedStyle(field);
  const px = (value: string): number => Number.parseFloat(value) || 0;
  const fontSize = px(style.fontSize) || 16;
  const lineHeight = px(style.lineHeight) || fontSize * 1.4;
  const fit = composerFitOf(
    {
      scrollHeight: field.scrollHeight,
      lineHeight,
      paddingY: px(style.paddingTop) + px(style.paddingBottom),
      borderY: px(style.borderTopWidth) + px(style.borderBottomWidth),
      borderBox: style.boxSizing === 'border-box',
    },
    maxRows,
  );
  field.style.height = `${fit.height}px`;
  field.style.overflowY = fit.scrolls ? 'auto' : 'hidden';
  // The phone's pill turns into a rounded box once the text takes a second row (chat/phone.css).
  field.toggleAttribute('data-grown', fit.grown);
}

/**
 * `<textarea [mcComposerFit]="draft()">`: the field follows its text at once on every keystroke (no frame
 * with a stale height after Delete or a paste) and after every render, for the changes that do not come
 * from the keyboard — dictation, a prefill, the clear after a send.
 */
@Directive({
  selector: 'textarea[mcComposerFit]',
  host: { '(window:resize)': 'refit()', '(input)': 'refit()' },
})
export class ComposerFit {
  /** The draft; a change of it (typing, dictation, a prefill, the clear after a send) refits. */
  readonly value = input.required<string>({ alias: 'mcComposerFit' });
  readonly maxRows = input(COMPOSER_MAX_ROWS);

  private readonly field = inject<ElementRef<HTMLTextAreaElement>>(ElementRef).nativeElement;

  constructor() {
    afterRenderEffect(() => {
      this.value();
      this.refit();
    });
  }

  protected refit(): void {
    fitComposer(this.field, this.maxRows());
  }
}
