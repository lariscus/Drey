import type { PersonaAvatarReply } from '../contracts/remote-protocol';
import type { EngineVault } from './host';
import type { PersonaAvatarReader } from './persona-avatars';

/** A persona id as the routes pin it (the personaRef grammar); anything else never reaches the disk. */
const PERSONA_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The pictures of the board's personas, the way the remote port and the gateway read them. */
export interface BoardAvatarsPort {
  /** id → picture version, for the ids that have a picture. */
  versions(ids: readonly string[]): Promise<Readonly<Record<string, string>>>;
  /** The PNG's bytes; null = no such persona or picture. */
  bytes(id: string): Promise<Buffer | null>;
  /** The picture as a `data:image/png` URL (the desktop renderer's IPC read). */
  dataUrl(id: string): Promise<PersonaAvatarReply>;
}

/**
 * The persona pictures of the tickets vault the board detects (req-292):
 * the versions the persona list carries, the bytes `GET /api/personas/<id>/avatar`
 * serves, the data URL Drey's renderer draws. Never throws: a failure reads
 * as no picture, so a circle falls back to its initials or silhouette.
 */
export class BoardAvatars implements BoardAvatarsPort {
  constructor(
    private readonly board: { detect(): Promise<EngineVault | null> },
    private readonly reader: PersonaAvatarReader,
  ) {}

  async versions(ids: readonly string[]): Promise<Readonly<Record<string, string>>> {
    const vault = await this.board.detect().catch(() => null);
    if (vault === null) {
      return {};
    }
    const found: Record<string, string> = {};
    for (const id of ids.filter((each) => PERSONA_ID.test(each))) {
      const version = await this.reader.versionOf(vault, id).catch(() => null);
      if (version !== null) {
        found[id] = version;
      }
    }
    return found;
  }

  async bytes(id: string): Promise<Buffer | null> {
    if (!PERSONA_ID.test(id)) {
      return null;
    }
    const vault = await this.board.detect().catch(() => null);
    return vault === null ? null : this.reader.read(vault, id).catch(() => null);
  }

  async dataUrl(id: string): Promise<PersonaAvatarReply> {
    const bytes = await this.bytes(id);
    return bytes === null ? { ok: false, error: `persona ${id} has no picture` } : { ok: true, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  }
}
