/**
 * req-292 — the persona's picture in the circle: `mc-ph-avatar` draws the
 * persona's `avatar.png` when the shell's pictures know one (by id, else by
 * the name the surface passes), cropped to the circle on the persona colour;
 * without one it keeps the silhouette.
 */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PhoneAvatar } from './avatar';
import { MC_PERSONA_PICTURES, type McPersonaPictures } from './persona-pictures';

@Component({
  selector: 'mc-host',
  imports: [PhoneAvatar],
  template: `<mc-ph-avatar [persona]="persona()" [name]="name()" color="#a78bfa" [size]="36" />`,
})
class Host {
  readonly persona = signal('');
  readonly name = signal('Ben');
}

const URL_BEN = 'data:image/png;base64,QkVO';

function mount(pictures: McPersonaPictures | null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: MC_PERSONA_PICTURES, useValue: pictures }] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('PhoneAvatar — the persona picture (req-292)', () => {
  it('draws the picture cropped to the circle, the persona colour behind it', () => {
    const { el } = mount({ pictureOf: (who) => (who === 'ben' || who === 'Ben' ? URL_BEN : null) });
    const img = el.querySelector('img.ava.pic') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(URL_BEN);
    expect(img.getAttribute('alt')).toBe('Ben');
    expect(img.getAttribute('width')).toBe('36');
    expect(img.style.background).toContain('rgb(167, 139, 250)');
    expect(el.querySelector('svg')).toBeNull();
  });

  it('looks the picture up by the persona id when the surface passes one', () => {
    const asked: string[] = [];
    const { fixture } = mount({ pictureOf: (who) => (asked.push(who), null) });
    fixture.componentInstance.persona.set('ben');
    fixture.detectChanges();
    expect(asked.at(-1)).toBe('ben');
  });

  it('keeps the silhouette for a persona without a picture', () => {
    const { el } = mount({ pictureOf: () => null });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('svg.ava')?.getAttribute('aria-label')).toBe('Ben');
  });

  it('keeps the silhouette when the shell binds no pictures', () => {
    const { el } = mount(null);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('svg.ava')).not.toBeNull();
  });

  it('follows the pictures: one that arrives later replaces the silhouette', () => {
    const known = signal<string | null>(null);
    const { fixture, el } = mount({ pictureOf: () => known() });
    expect(el.querySelector('img')).toBeNull();
    known.set(URL_BEN);
    fixture.detectChanges();
    expect(el.querySelector('img')?.getAttribute('src')).toBe(URL_BEN);
  });
});
