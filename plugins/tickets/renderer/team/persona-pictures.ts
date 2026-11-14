/**
 * The persona pictures (req-292): `personas/<id>/avatar.png` drawn in every
 * circle the desk draws for a persona. The persona list says which persona
 * has a picture and its version (`avatarVersion`); a picture is asked for
 * once per version (`personaAvatar`, a data URL) and then served from
 * memory, so a re-render draws it at once. A circle keeps its initials or
 * silhouette until the picture is there, and for good when there is none.
 */

/** The persona list's slice the pictures need. */
export interface PictureNote {
  readonly id: string;
  readonly avatarVersion?: string;
}

/** Asks the engine for one picture; anything but `{ ok: true, dataUrl }` reads as none. */
export type PictureInvoke = (method: string, payload?: unknown) => Promise<unknown>;

function dataUrlOf(reply: unknown): string | null {
  const body = reply as { ok?: unknown; dataUrl?: unknown } | null;
  return body !== null && typeof body === 'object' && body.ok === true && typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:image/') ? body.dataUrl : null;
}

export class PersonaPictures {
  private readonly versions = new Map<string, string>();
  private readonly resolved = new Map<string, string | null>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private invoke: PictureInvoke | null = null;

  /** The IPC seam; until it is set no picture is asked for. */
  connect(invoke: PictureInvoke): void {
    this.invoke = invoke;
  }

  /** A persona list arrived: its ids' versions replace what was known (no version = no picture). */
  note(personas: readonly PictureNote[]): void {
    for (const persona of personas) {
      if (typeof persona.avatarVersion === 'string' && persona.avatarVersion !== '') {
        this.versions.set(persona.id, persona.avatarVersion);
      } else {
        this.versions.delete(persona.id);
      }
    }
  }

  /** Whether the latest persona list says the persona has a picture (req-288: the Profile block's *Remove picture*). */
  has(id: string): boolean {
    return this.versions.has(id);
  }

  /** The picture's data URL when it is already in memory; null otherwise (and for a persona without one). */
  urlOf(id: string | null | undefined): string | null {
    const key = this.keyOf(id);
    return key === null ? null : (this.resolved.get(key) ?? null);
  }

  /**
   * Draws the persona's picture into `target`: a circle (its initials give
   * way to the picture, other children such as a status dot stay) or a
   * silhouette `<svg>` (replaced by a picture of its size and classes).
   * Nothing happens for a persona without a picture. Returns what stands
   * in the target's place now: the picture when it was in memory, else
   * the target (a picture still loading swaps in once it is there).
   */
  paint(target: Element, id: string | null | undefined, alt = ''): Element {
    const key = this.keyOf(id);
    if (key === null) {
      return target;
    }
    const known = this.resolved.get(key);
    if (known !== undefined) {
      return known === null ? target : swapIn(target, known, alt);
    }
    void this.load(id!, key).then((url) => {
      if (url !== null) {
        swapIn(target, url, alt);
      }
    });
    return target;
  }

  /** Resolves once every picture asked for so far has loaded or failed (the specs wait on it). */
  async idle(): Promise<void> {
    await Promise.all([...this.pending.values()]);
  }

  private keyOf(id: string | null | undefined): string | null {
    const version = id === null || id === undefined ? undefined : this.versions.get(id);
    return version === undefined ? null : `${id}@${version}`;
  }

  private load(id: string, key: string): Promise<string | null> {
    const asked = this.pending.get(key);
    if (asked !== undefined) {
      return asked;
    }
    const invoke = this.invoke;
    const next = (invoke === null ? Promise.resolve(null) : invoke('personaAvatar', { persona: id }).then(dataUrlOf, () => null)).then((url) => {
      this.resolved.set(key, url);
      this.pending.delete(key);
      return url;
    });
    this.pending.set(key, next);
    return next;
  }
}

/** The picture in place of the initials or the silhouette; cropped to the circle by `.persona-picture`. */
function swapIn(target: Element, url: string, alt: string): Element {
  const img = document.createElement('img');
  img.className = 'persona-picture';
  img.src = url;
  img.alt = alt;
  img.draggable = false;
  if (target instanceof SVGElement) {
    for (const cls of (target.getAttribute('class') ?? '').split(/\s+/).filter((name) => name !== '')) {
      img.classList.add(cls);
    }
    img.width = Number(target.getAttribute('width') ?? '20');
    img.height = Number(target.getAttribute('height') ?? '20');
    target.replaceWith(img);
    return img;
  }
  for (const node of [...target.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE || (node instanceof HTMLImageElement && node.classList.contains('persona-picture'))) {
      node.remove();
    }
  }
  target.classList.add('has-picture');
  target.prepend(img);
  return target;
}

/** The one cache the desk's views share (the Crew, the Capacity band, the Persona page, the ticket card). */
export const personaPictures = new PersonaPictures();
