import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CREW_IDS } from '../core/default-crew';
import { HUMAN_PERSONA_ID, PERSONAS_DIR } from '../core/persona';
import type { EngineHost, EngineVault } from './host';
import { SHIPPED_PERSONAS_DIR } from './shipped-crew-files';

/** The picture's file name in a persona's folder (`specs/ticket-schema.md`, Personas). */
export const AVATAR_FILE = 'avatar.png';

/** The ids the package ships a picture for: the default crew and the human persona. */
export const SHIPPED_AVATAR_IDS: readonly string[] = [...DEFAULT_CREW_IDS, HUMAN_PERSONA_ID];

/** A picture larger than this is not served, nor taken by an upload (the shipped ones are about 110 KB). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `tickets/_meta/personas/<id>/avatar.png`, vault-relative. */
export function avatarPathOf(id: string): string {
  return `${PERSONAS_DIR}/${id}/${AVATAR_FILE}`;
}

/** What reads a persona's picture: its version (to cache by) and its bytes. */
export interface PersonaAvatarReader {
  /** A token that changes when the picture changes (size and mtime); null = no picture. */
  versionOf(vault: EngineVault, id: string): Promise<string | null>;
  /** The PNG's bytes; null = none, too large or not a PNG. */
  read(vault: EngineVault, id: string): Promise<Buffer | null>;
}

/** What lays down a shipped picture: never over a picture that is there. */
export interface PersonaAvatarWriter {
  /** Whether the persona's folder holds a picture. */
  has(vault: EngineVault, id: string): Promise<boolean>;
  /** Copies the package's picture of `id` into the vault; the vault path written, or null (nothing shipped, or a picture already there). */
  copyShipped(vault: EngineVault, id: string): Promise<string | null>;
}

/**
 * The persona pictures (req-292): `personas/<id>/avatar.png` in the tickets
 * vault, read for the Crew's circles, and the pictures the package ships
 * (`packages/tickets-engine/personas/<id>/avatar.png`, the default crew
 * and the human `you`) copied in. A copy never overwrites: the file is
 * opened exclusively, so a picture the owner put there stays.
 */
export class PersonaAvatars implements PersonaAvatarReader, PersonaAvatarWriter {
  constructor(
    private readonly host: Pick<EngineHost, 'resolveAssetPath'>,
    private readonly shippedDir: string = SHIPPED_PERSONAS_DIR,
  ) {}

  async versionOf(vault: EngineVault, id: string): Promise<string | null> {
    const file = this.fileOf(vault, id);
    const stat = file === null ? null : await fsp.stat(file).catch(() => null);
    if (stat === null || !stat.isFile() || stat.size === 0 || stat.size > AVATAR_MAX_BYTES) {
      return null;
    }
    return `${Math.floor(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}`;
  }

  async read(vault: EngineVault, id: string): Promise<Buffer | null> {
    if ((await this.versionOf(vault, id)) === null) {
      return null;
    }
    const bytes = await fsp.readFile(this.fileOf(vault, id)!).catch(() => null);
    return bytes !== null && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? bytes : null;
  }

  async has(vault: EngineVault, id: string): Promise<boolean> {
    const file = this.fileOf(vault, id);
    return file !== null && (await fsp.stat(file).catch(() => null)) !== null;
  }

  async copyShipped(vault: EngineVault, id: string): Promise<string | null> {
    const target = this.fileOf(vault, id);
    // Read, then an exclusive create: the package may sit in an asar archive, and `wx` never replaces a file.
    const bytes = await fsp.readFile(path.join(this.shippedDir, id, AVATAR_FILE)).catch(() => null);
    if (target === null || bytes === null) {
      return null;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.writeFile(target, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return null;
      }
      throw error;
    }
    return avatarPathOf(id);
  }

  /** req-288: writes the owner's picture over any there; the vault path written, or null when the path escapes the vault. */
  async write(vault: EngineVault, id: string, bytes: Buffer): Promise<string | null> {
    const target = this.fileOf(vault, id);
    if (target === null) {
      return null;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, bytes);
    return avatarPathOf(id);
  }

  /** req-288: removes the picture; whether there was one. */
  async remove(vault: EngineVault, id: string): Promise<boolean> {
    const target = this.fileOf(vault, id);
    if (target === null || (await fsp.stat(target).catch(() => null)) === null) {
      return false;
    }
    await fsp.rm(target, { force: true });
    return true;
  }

  private fileOf(vault: EngineVault, id: string): string | null {
    return this.host.resolveAssetPath(vault.id, avatarPathOf(id));
  }
}
