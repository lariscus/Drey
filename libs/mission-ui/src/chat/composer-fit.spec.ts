import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPOSER_MAX_ROWS, ComposerFit, composerFitOf, fitComposer, type ComposerMetrics } from './composer-fit';

/** The phone's field: 24 px lines, no padding (phone.css), border-box with no border. */
const phoneField = (scrollHeight: number): ComposerMetrics => ({
  scrollHeight,
  lineHeight: 24,
  paddingY: 0,
  borderY: 0,
  borderBox: true,
});

describe('composerFitOf (D-57)', () => {
  it('is one row for an empty or one-line draft', () => {
    expect(composerFitOf(phoneField(24))).toEqual({ height: 24, scrolls: false, grown: false });
    expect(composerFitOf(phoneField(0))).toEqual({ height: 24, scrolls: false, grown: false });
  });

  it('grows with the wrapped text, which has no newline at all', () => {
    expect(composerFitOf(phoneField(72)).height).toBe(72);
    expect(composerFitOf(phoneField(72)).grown).toBe(true);
  });

  it('caps at five rows and scrolls beyond', () => {
    expect(composerFitOf(phoneField(120))).toEqual({ height: 120, scrolls: false, grown: true });
    expect(composerFitOf(phoneField(240))).toEqual({ height: 120, scrolls: true, grown: true });
    expect(COMPOSER_MAX_ROWS).toBe(5);
  });

  it('honours a custom cap', () => {
    expect(composerFitOf(phoneField(240), 3)).toEqual({ height: 72, scrolls: true, grown: true });
  });

  it('counts padding and border as the box model says', () => {
    const padded: ComposerMetrics = { scrollHeight: 44, lineHeight: 20, paddingY: 20, borderY: 2, borderBox: true };
    expect(composerFitOf(padded)).toEqual({ height: 46, scrolls: false, grown: false });
    expect(composerFitOf({ ...padded, borderBox: false })).toEqual({ height: 24, scrolls: false, grown: false });
    expect(composerFitOf({ ...padded, scrollHeight: 400 })).toEqual({ height: 122, scrolls: true, grown: true });
  });
});

describe('fitComposer (D-57)', () => {
  afterEach(() => {
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)['scrollHeight'];
  });

  function field(scrollHeight: number): HTMLTextAreaElement {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    const el = document.createElement('textarea');
    el.style.cssText = 'box-sizing: border-box; padding: 0; border: 0; font-size: 16px; line-height: 24px';
    document.body.append(el);
    return el;
  }

  it('sets the height the wrapped text needs, and no scrollbar below the cap', () => {
    const el = field(72);
    fitComposer(el);
    expect(el.style.height).toBe('72px');
    expect(el.style.overflowY).toBe('hidden');
    expect(el.hasAttribute('data-grown')).toBe(true);
    el.remove();
  });

  it('stops at five rows and scrolls', () => {
    const el = field(300);
    fitComposer(el);
    expect(el.style.height).toBe('120px');
    expect(el.style.overflowY).toBe('auto');
    el.remove();
  });
});

describe('mcComposerFit (D-57)', () => {
  @Component({
    template: `<textarea [mcComposerFit]="draft()" [value]="draft()"></textarea>`,
    imports: [ComposerFit],
  })
  class Host {
    readonly draft = signal('');
  }

  afterEach(() => {
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)['scrollHeight'];
  });

  it('refits after the draft changes, not only on input events', async () => {
    let needed = 24;
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => needed });
    const fixture = TestBed.createComponent(Host);
    const el = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    el.style.cssText = 'box-sizing: border-box; padding: 0; border: 0; font-size: 16px; line-height: 24px';
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.style.height).toBe('24px');

    needed = 96;
    fixture.componentInstance.draft.set('a long sentence that wraps over four lines on a phone');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.style.height).toBe('96px');

    needed = 24;
    fixture.componentInstance.draft.set('');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.style.height).toBe('24px');
    fixture.nativeElement.remove();
  });
});
