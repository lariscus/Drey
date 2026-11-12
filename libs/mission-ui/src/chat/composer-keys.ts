import { computed, signal, type Signal } from '@angular/core';

const HARDWARE_CODE = /^(Key|Digit|Arrow|Tab$|Escape$|Home$|End$|Page|F\d)/;

/**
 * True for a key event only a physical keyboard produces: a letter, digit, arrow, Tab, Escape or
 * function key by its `code` (a soft keyboard leaves `code` empty), a modifier held down, or a
 * Shift+Enter (a soft return has no Shift).
 */
export function isHardwareKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (event.shiftKey && event.key === 'Enter') ||
    HARDWARE_CODE.test(event.code)
  );
}

/**
 * The composer's return key by input device (D-57, owner's ruling 2026-11-12). Where there is a
 * mouse, Enter sends and Shift+Enter breaks the line. On a touch face the return key is a newline
 * and the arrow sends — the convention of WhatsApp, Telegram and the ChatGPT and Claude apps —
 * until a hardware keyboard shows itself (an iPad with a keyboard): from the first physical key on,
 * Enter sends there too.
 */
export class ComposerKeys {
  private readonly hardware = signal(false);

  readonly enterSends: Signal<boolean>;
  /** The soft keyboard's return-key label: the arrow's job is the button's, not the key's. */
  readonly enterKeyHint: Signal<'send' | 'enter'>;

  constructor(touchFace: Signal<boolean>) {
    this.enterSends = computed(() => !touchFace() || this.hardware());
    this.enterKeyHint = computed(() => (this.enterSends() ? 'send' : 'enter'));
  }

  /** Reads a keydown of the composer: remembers a hardware keyboard, answers whether this key sends. */
  sendsOn(event: KeyboardEvent): boolean {
    if (isHardwareKey(event)) {
      this.hardware.set(true);
    }
    return event.key === 'Enter' && !event.shiftKey && !event.isComposing && this.enterSends();
  }
}
