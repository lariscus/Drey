import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ComposerKeys, isHardwareKey } from './composer-keys';

type Keys = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>;
const key = (key: string, extra: Partial<Keys> = {}): KeyboardEvent =>
  ({ key, code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...extra }) as KeyboardEvent;

describe('isHardwareKey (D-57)', () => {
  it('knows what a soft keyboard cannot send: physical letter keys, arrows, Tab, Escape, function keys, a modifier held', () => {
    expect(isHardwareKey(key('a', { code: 'KeyA' }))).toBe(true);
    expect(isHardwareKey(key('1', { code: 'Digit1' }))).toBe(true);
    expect(isHardwareKey(key('ArrowLeft', { code: 'ArrowLeft' }))).toBe(true);
    expect(isHardwareKey(key('Tab', { code: 'Tab' }))).toBe(true);
    expect(isHardwareKey(key('k', { metaKey: true }))).toBe(true);
    expect(isHardwareKey(key('Enter', { shiftKey: true }))).toBe(true);
  });

  it('does not take a touch keyboard for one: no physical code, and a bare return', () => {
    expect(isHardwareKey(key('a'))).toBe(false);
    expect(isHardwareKey(key('Unidentified'))).toBe(false);
    expect(isHardwareKey(key('Enter', { code: '' }))).toBe(false);
  });
});

describe('ComposerKeys (D-57): the return key by input device', () => {
  it('sends on Enter and breaks the line on Shift+Enter where there is a mouse — the desktop web', () => {
    const keys = new ComposerKeys(signal(false));
    expect(keys.enterSends()).toBe(true);
    expect(keys.enterKeyHint()).toBe('send');
    expect(keys.sendsOn(key('Enter', { code: 'Enter' }))).toBe(true);
    expect(keys.sendsOn(key('Enter', { code: 'Enter', shiftKey: true }))).toBe(false);
  });

  it('makes a newline of the return key on a touch face with the soft keyboard — the arrow sends', () => {
    const keys = new ComposerKeys(signal(true));
    expect(keys.enterSends()).toBe(false);
    expect(keys.enterKeyHint()).toBe('enter');
    expect(keys.sendsOn(key('Enter'))).toBe(false);
    expect(keys.sendsOn(key('Enter', { code: 'Enter' }))).toBe(false);
  });

  it('switches to Enter-sends on a touch face once a hardware keyboard has shown itself (an iPad with a keyboard)', () => {
    const keys = new ComposerKeys(signal(true));
    expect(keys.sendsOn(key('h', { code: 'KeyH' }))).toBe(false);
    expect(keys.enterSends()).toBe(true);
    expect(keys.enterKeyHint()).toBe('send');
    expect(keys.sendsOn(key('Enter', { code: 'Enter' }))).toBe(true);
    expect(keys.sendsOn(key('Enter', { code: 'Enter', shiftKey: true }))).toBe(false);
  });

  it('never sends on the Enter that confirms an input-method composition', () => {
    const keys = new ComposerKeys(signal(false));
    expect(keys.sendsOn(key('Enter', { code: 'Enter', isComposing: true }))).toBe(false);
  });

  it('follows a face change: the same field after a rotation or a window resize', () => {
    const touch = signal(true);
    const keys = new ComposerKeys(touch);
    expect(keys.enterSends()).toBe(false);
    touch.set(false);
    expect(keys.enterSends()).toBe(true);
  });
});
