import { signal, type Signal } from '@angular/core';
import type { McPersonaPictures } from '@mission-ui/phone/persona-pictures';

/** The persona list's slice the pictures need. */
export interface PicturePersona {
  readonly id: string;
  readonly title: string;
  readonly avatarVersion?: string;
}

/** Fetches one persona's picture (`GET /api/personas/<id>/avatar`); null = none or failed. */
export type PictureFetch = (id: string) => Promise<string | null>;

/**
 * The persona pictures of Mission Control (req-292): the desk's persona list
 * says which persona has a picture and its version; each picture is asked
 * for once per version, the first time a circle names its persona, and kept
 * in memory. A circle that names a persona by title finds it too.
 */
export class McPersonaPictureStore implements McPersonaPictures {
  private readonly urls = signal<ReadonlyMap<string, string>>(new Map());
  private readonly asked = new Set<string>();

  constructor(
    private readonly personas: Signal<readonly PicturePersona[]>,
    private readonly fetch: PictureFetch,
  ) {}

  pictureOf(who: string): string | null {
    const wanted = who.trim().toLowerCase();
    const list = this.personas();
    const persona = list.find((p) => p.id === who) ?? list.find((p) => p.title.trim().toLowerCase() === wanted);
    if (persona === undefined || persona.avatarVersion === undefined || persona.avatarVersion === '') {
      return null;
    }
    const key = `${persona.id}@${persona.avatarVersion}`;
    const url = this.urls().get(key);
    if (url === undefined) {
      this.ask(persona.id, key);
    }
    return url ?? null;
  }

  private ask(id: string, key: string): void {
    if (this.asked.has(key)) {
      return;
    }
    this.asked.add(key);
    // The write lands after the fetch, outside the computed that asked.
    void this.fetch(id).then((url) => {
      if (url !== null) {
        this.urls.update((map) => new Map(map).set(key, url));
      }
    });
  }
}

/** The picture out of the route's reply: a `data:image/…` URL, anything else none. */
export function pictureUrlOf(reply: unknown): string | null {
  const body = reply as { ok?: unknown; dataUrl?: unknown } | null;
  return body !== null && typeof body === 'object' && body.ok === true && typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:image/') ? body.dataUrl : null;
}
