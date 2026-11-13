import { InjectionToken } from '@angular/core';

/**
 * The persona pictures (req-292): `personas/<id>/avatar.png`, which every
 * `mc-ph-avatar` draws in place of the silhouette. The shell binds it to
 * the desk's persona list and its `GET /api/personas/<id>/avatar`; without
 * a binding every circle keeps the silhouette.
 */
export interface McPersonaPictures {
  /**
   * The picture's URL for the persona a circle names — by id, or by title
   * where a surface only knows the name; null while there is none (or it is
   * still loading). Reads signals, so a `computed` follows it.
   */
  pictureOf(who: string): string | null;
}

export const MC_PERSONA_PICTURES = new InjectionToken<McPersonaPictures | null>('mc-persona-pictures', {
  providedIn: 'root',
  factory: () => null,
});
