import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MC_PERSONA_PICTURES } from './persona-pictures';

/**
 * A persona's picture on the boards: its `avatar.png` when it has one
 * (req-292), cropped to the circle on the persona's colour; else the
 * silhouette on the persona's colour.
 */
@Component({
  selector: 'mc-ph-avatar',
  template: `@if (src(); as url) {
      <img class="ava pic" [src]="url" [attr.alt]="name()" [attr.width]="size()" [attr.height]="size()" [style.background]="color()" draggable="false" />
    } @else {
      <svg class="ava" role="img" [attr.aria-label]="name()" [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24">
        <rect width="24" height="24" [attr.fill]="color()" />
        <circle cx="12" cy="9.5" r="4.2" fill="var(--on-pastel)" fill-opacity="0.78" />
        <path d="M3.5 24c0-5 3.8-8 8.5-8s8.5 3 8.5 8z" fill="var(--on-pastel)" fill-opacity="0.78" />
      </svg>
    }`,
  styleUrl: './avatar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneAvatar {
  readonly name = input('');
  readonly color = input('var(--text-2)');
  readonly size = input(24);
  /** The persona's id; the picture is looked up by it, else by `name`. */
  readonly persona = input('');

  private readonly pictures = inject(MC_PERSONA_PICTURES);

  readonly src = computed(() => {
    const who = this.persona() || this.name();
    return who === '' ? null : (this.pictures?.pictureOf(who) ?? null);
  });
}
