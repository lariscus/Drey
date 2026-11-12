import { describe, expect, it } from 'vitest';
import { isEditableElement, trackVisualViewport, viewportVarsOf, type ViewportHost } from './viewport';

describe('viewportVarsOf (D-7d)', () => {
  it('is silent at full height, so the stylesheet fallbacks stay in charge', () => {
    expect(viewportVarsOf({ height: 844, offsetTop: 0 }, 844)).toEqual({ vh: null, top: null });
  });

  it('follows the visual viewport when the keyboard has shrunk it', () => {
    expect(viewportVarsOf({ height: 508.4, offsetTop: 0 }, 844)).toEqual({ vh: '508px', top: '0px' });
  });

  it('ignores a bar collapsing or an inset change — only a keyboard resizes the frame (D-5b)', () => {
    expect(viewportVarsOf({ height: 800, offsetTop: 0 }, 844)).toEqual({ vh: null, top: null });
    expect(viewportVarsOf({ height: 800, offsetTop: 30 }, 844)).toEqual({ vh: null, top: null });
  });

  it('leaves a pinch-zoomed viewport alone (D-5b)', () => {
    expect(viewportVarsOf({ height: 400, offsetTop: 120, scale: 2 }, 844)).toEqual({ vh: null, top: null });
    expect(viewportVarsOf({ height: 500, offsetTop: 0, scale: 1 }, 844)).toEqual({ vh: '500px', top: '0px' });
  });

  it('carries the pan iOS adds to reveal the focused field, never a negative one', () => {
    expect(viewportVarsOf({ height: 508, offsetTop: 120.6 }, 844)).toEqual({ vh: '508px', top: '121px' });
    expect(viewportVarsOf({ height: 508, offsetTop: -3 }, 844)).toEqual({ vh: '508px', top: '0px' });
  });
});

describe('viewportVarsOf while a field is being edited (D-55)', () => {
  it('follows a short shrink — the shortcut bar of a hardware keyboard, the accessory row — while a field has focus', () => {
    expect(viewportVarsOf({ height: 790, offsetTop: 0 }, 844, true)).toEqual({ vh: '790px', top: '0px' });
  });

  it('still ignores the same shrink without a focused field: that is the browser bar collapsing (D-5b)', () => {
    expect(viewportVarsOf({ height: 790, offsetTop: 0 }, 844, false)).toEqual({ vh: null, top: null });
  });

  it('ignores a few pixels and a pinch-zoomed viewport even while editing', () => {
    expect(viewportVarsOf({ height: 830, offsetTop: 0 }, 844, true)).toEqual({ vh: null, top: null });
    expect(viewportVarsOf({ height: 400, offsetTop: 120, scale: 2 }, 844, true)).toEqual({ vh: null, top: null });
  });
});

describe('isEditableElement (D-55)', () => {
  const el = (html: string): Element => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild!;
  };

  it('knows the fields a keyboard types into', () => {
    expect(isEditableElement(el('<textarea></textarea>'))).toBe(true);
    expect(isEditableElement(el('<input type="search" />'))).toBe(true);
    expect(isEditableElement(el('<div contenteditable="true"></div>'))).toBe(true);
    expect(isEditableElement(el('<div contenteditable=""></div>'))).toBe(true);
  });

  it('knows what is not one', () => {
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement(el('<button></button>'))).toBe(false);
    expect(isEditableElement(el('<input type="checkbox" />'))).toBe(false);
    expect(isEditableElement(el('<div contenteditable="false"></div>'))).toBe(false);
  });
});

describe('trackVisualViewport (D-7d)', () => {
  function fakeHost() {
    const props = new Map<string, string>();
    const scrolls: number[][] = [];
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: (type: string, listener: unknown) => void listeners.set(type, listener as () => void),
      fire: (type: string) => listeners.get(type)?.(),
    };
    const host = {
      innerHeight: 844,
      document: {
        documentElement: {
          style: {
            setProperty: (name: string, value: string) => void props.set(name, value),
            removeProperty: (name: string) => {
              props.delete(name);
              return '';
            },
          },
        },
      },
      visualViewport: viewport,
      scrollTo: (x: number, y: number) => void scrolls.push([x, y]),
    } as unknown as ViewportHost;
    return { host, props, viewport, scrolls };
  }

  it('shrinks the frame while the keyboard is up and restores it afterwards', () => {
    const { host, props, viewport, scrolls } = fakeHost();
    trackVisualViewport(host);
    expect(props.size).toBe(0);

    viewport.height = 500;
    viewport.offsetTop = 90;
    viewport.fire('resize');
    expect(props.get('--mc-vh')).toBe('500px');
    expect(props.get('--mc-vv-top')).toBe('90px');
    expect(scrolls).toEqual([[0, 0]]);

    viewport.offsetTop = 0;
    viewport.fire('scroll');
    expect(props.get('--mc-vv-top')).toBe('0px');

    viewport.height = 844;
    viewport.fire('resize');
    expect(props.size).toBe(0);
  });

  it('re-reads the viewport on focus changes — also when iOS never sends the closing resize (D-5b)', () => {
    const { host, props, viewport } = fakeHost();
    const listeners = new Map<string, () => void>();
    const timers: { fn: () => void; ms: number }[] = [];
    const wired = {
      ...host,
      addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
      setTimeout: (fn: () => void, ms: number) => void timers.push({ fn, ms }),
    } as unknown as ViewportHost;
    trackVisualViewport(wired);

    viewport.height = 500;
    viewport.offsetTop = 90;
    listeners.get('focusin')!();
    expect(props.get('--mc-vh')).toBe('500px');

    // The keyboard closes; iOS fires no resize. The blur alone must restore the frame.
    viewport.height = 844;
    viewport.offsetTop = 0;
    listeners.get('focusout')!();
    expect(props.size).toBe(0);
    expect(timers.map((t) => t.ms)).toEqual([120, 400, 900, 120, 400, 900]);

    // A late settle after the animation re-reads once more.
    viewport.height = 500;
    timers[3]!.fn();
    expect(props.get('--mc-vh')).toBe('500px');
  });

  it('reads a focused field into the threshold: a short shrink moves the frame only while one has focus (D-55)', () => {
    const { host, props, viewport } = fakeHost();
    const doc = host.document as unknown as { activeElement: Element | null };
    doc.activeElement = null;
    trackVisualViewport(host);

    viewport.height = 790;
    viewport.fire('resize');
    expect(props.size).toBe(0);

    doc.activeElement = document.createElement('textarea');
    viewport.fire('resize');
    expect(props.get('--mc-vh')).toBe('790px');

    doc.activeElement = null;
    viewport.fire('resize');
    expect(props.size).toBe(0);
  });

  it('does nothing without a visual viewport', () => {
    const { host, props } = fakeHost();
    expect(() => trackVisualViewport({ ...host, visualViewport: null })).not.toThrow();
    expect(props.size).toBe(0);
  });
});
