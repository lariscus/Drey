/**
 * A persona's picture written by the owner (req-288, D-67; req-235's desktop
 * half): the Persona page's *Upload picture…* and *Remove picture*, over the
 * invoke channel (`personaAvatarSet`, `personaAvatarRemove`) and the routes
 * `POST /api/personas/<id>/avatar` and `POST /api/personas/<id>/avatar/remove`.
 */

/** An upload: the picture as a `data:image/png;base64,…` URL (at most 2 MB of PNG). */
export interface PersonaPictureSet {
  readonly persona: string;
  readonly dataUrl: string;
}

export interface PersonaPictureRemove {
  readonly persona: string;
}

/** One commit; `warning` when the commit failed but the file is written. */
export type PersonaPictureReply = { readonly ok: true; readonly warning?: string } | { readonly ok: false; readonly error: string };
