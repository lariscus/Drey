/**
 * D-7d — the iOS keyboard. Safari keeps the layout viewport at full height
 * when the keyboard opens: the visual viewport shrinks and, to bring the
 * focused field into view, pans down inside it — which pushed the header and
 * the top of the thread out of sight. The frame is therefore sized from the
 * visual viewport instead: `--mc-vh` is its height, `--mc-vv-top` how far it
 * has panned, and styles.css lays the body over exactly that rectangle. The
 * composer sits right above the keyboard, header and thread stay in place.
 */

export interface ViewportBox {
  readonly height: number;
  readonly offsetTop: number;
  /** Pinch-zoom factor; absent = 1. */
  readonly scale?: number;
}

/**
 * D-5b: only a keyboard resizes the frame. A smaller difference is the browser's
 * own bar collapsing or an inset change — following it made the chrome twitch by
 * a few pixels — and while the owner pinch-zooms, the visual viewport is smaller
 * and panned by design.
 */
export const KEYBOARD_MIN_PX = 120;

/**
 * D-55: while a field has focus, a shrink of the visual viewport is the keyboard's
 * and nothing else — the bar collapsing does not happen under a typing finger. The
 * short ones (the shortcut bar an iPad shows with a hardware keyboard, the accessory
 * row, a floating keyboard's strip) are well under `KEYBOARD_MIN_PX` and used to
 * leave the bottom bar behind them; below this still counts as no change at all.
 */
export const EDITING_KEYBOARD_MIN_PX = 40;

/** The CSS variables for a visual viewport; both null = full height, the stylesheet's fallbacks apply. */
export function viewportVarsOf(
  box: ViewportBox,
  innerHeight: number,
  editing = false,
): { readonly vh: string | null; readonly top: string | null } {
  const top = Math.max(0, Math.round(box.offsetTop));
  const height = Math.round(box.height);
  const min = editing ? EDITING_KEYBOARD_MIN_PX : KEYBOARD_MIN_PX;
  if ((box.scale ?? 1) > 1.01 || Math.round(innerHeight) - height < min) {
    return { vh: null, top: null };
  }
  return { vh: `${height}px`, top: `${top}px` };
}

/** True for what a keyboard types into: text fields and contenteditable surfaces (CodeMirror's content). */
export function isEditableElement(element: Element | null | undefined): boolean {
  if (element === null || element === undefined) {
    return false;
  }
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') {
    return true;
  }
  if (tag === 'input') {
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color', 'image'].includes(
      (element.getAttribute('type') ?? 'text').toLowerCase(),
    );
  }
  const editable = element.getAttribute('contenteditable');
  return editable !== null && editable.toLowerCase() !== 'false';
}

/** The slice of `window` the tracker needs — the spec passes a fake. */
export interface ViewportHost {
  readonly innerHeight: number;
  readonly document: {
    readonly documentElement: { readonly style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'> };
    /** The focused element; optional so a spec host stays small. */
    readonly activeElement?: Element | null;
  };
  readonly visualViewport?: (ViewportBox & Pick<EventTarget, 'addEventListener'>) | null;
  scrollTo(x: number, y: number): void;
  /** Optional so a spec host stays small; the browser has them. */
  addEventListener?(type: string, listener: () => void): void;
  setTimeout?(handler: () => void, ms: number): unknown;
}

/** When to look again after a focus change: iOS settles the keyboard animation, and sometimes never says so. */
export const RECHECK_AFTER_MS: readonly number[] = [120, 400, 900];

/** Keeps the two variables current; a browser without a visual viewport keeps the plain full-height frame. */
export function trackVisualViewport(host: ViewportHost): void {
  const viewport = host.visualViewport;
  if (viewport === undefined || viewport === null) {
    return;
  }
  const style = host.document.documentElement.style;
  const update = (): void => {
    const vars = viewportVarsOf(viewport, host.innerHeight, isEditableElement(host.document.activeElement));
    if (vars.vh === null || vars.top === null) {
      style.removeProperty('--mc-vh');
      style.removeProperty('--mc-vv-top');
      return;
    }
    style.setProperty('--mc-vh', vars.vh);
    style.setProperty('--mc-vv-top', vars.top);
    // The document may be scrolled to reveal the field; the frame is not a page.
    host.scrollTo(0, 0);
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  // D-5b: iOS has been seen to close the keyboard WITHOUT a final visual-viewport
  // resize (the Done key, a tap outside, a backgrounded app): the variables then
  // stayed at the keyboard's values for the rest of the session and the frame sat
  // short and shifted — the "wobble after the composer was used". Every focus
  // change, orientation change, page show and touch end therefore re-reads the
  // viewport, and a focus change re-reads it again once the animation is over.
  const recheck = (): void => {
    update();
    for (const ms of RECHECK_AFTER_MS) {
      host.setTimeout?.(update, ms);
    }
  };
  host.addEventListener?.('resize', update);
  host.addEventListener?.('orientationchange', recheck);
  host.addEventListener?.('pageshow', recheck);
  host.addEventListener?.('focusin', recheck);
  host.addEventListener?.('focusout', recheck);
  host.addEventListener?.('touchend', update);
  update();
}
