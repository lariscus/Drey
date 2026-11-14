import { CREW_FILE } from '../contracts/crew-config';
import type { PersonaPictureRemove, PersonaPictureReply, PersonaPictureSet } from '../contracts/persona-picture';
import { SEEDED_PICTURES_KEY, seededListOf, withSeededList } from '../core/crew-seed-marker';
import { personaRef } from '../core/persona';
import type { TicketsGit } from '../core/tickets-git';
import type { CrewConfigFiles } from './crew-config-files';
import type { EngineHost, EngineVault } from './host';
import { AVATAR_MAX_BYTES, avatarPathOf, PNG_SIGNATURE, SHIPPED_AVATAR_IDS } from './persona-avatars';
import type { PersonaFolderPort } from './persona-folders';

/** What the service writes the picture with: replace and remove (`PersonaAvatars` fits it). */
export interface PersonaPictureFiles {
  write(vault: EngineVault, id: string, bytes: Buffer): Promise<string | null>;
  remove(vault: EngineVault, id: string): Promise<boolean>;
}

export interface PersonaPictureServiceDeps {
  readonly board: { detect(): Promise<EngineVault | null> };
  readonly host: Pick<EngineHost, 'announceChanges'>;
  readonly git: Pick<TicketsGit, 'locate' | 'commitTree'>;
  readonly folders: PersonaFolderPort;
  readonly files: PersonaPictureFiles;
  readonly crewFiles: Pick<CrewConfigFiles, 'read' | 'put' | 'serial'>;
  /** The board and the persona list changed (a client reads `avatarVersion` again). */
  readonly changed: () => void;
  readonly log: (message: string, level?: 'info' | 'warn') => void;
}

const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The PNG's bytes of a `data:image/png;base64,…` URL, or why it is no picture the record takes. */
function pngOf(dataUrl: unknown): Buffer | string {
  const match = typeof dataUrl === 'string' ? DATA_URL.exec(dataUrl.trim()) : null;
  if (match === null) {
    return 'the picture is a data:image/png;base64 URL';
  }
  const bytes = Buffer.from(match[1]!, 'base64');
  if (bytes.length === 0 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'the picture is not a PNG';
  }
  return bytes.length > AVATAR_MAX_BYTES ? `the picture is larger than ${AVATAR_MAX_BYTES / (1024 * 1024)} MB` : bytes;
}

/**
 * A persona's picture changed and removed by the owner (req-288, D-67 —
 * req-235's desktop half): an upload writes `personas/<id>/avatar.png` as one
 * commit; a removal deletes it and, for a picture the package ships (the
 * default crew and `you`), adds the id to `seeded-pictures:` in `crew.md` in
 * the same commit, so the engine's backfill (req-292) leaves it removed. The
 * client sends a PNG (the Persona page draws any image onto a square PNG first).
 */
export class PersonaPictureService {
  constructor(private readonly deps: PersonaPictureServiceDeps) {}

  async set(cmd: PersonaPictureSet): Promise<PersonaPictureReply> {
    const png = pngOf(cmd.dataUrl);
    if (typeof png === 'string') {
      return { ok: false, error: png };
    }
    return this.inFolder(cmd.persona, async (vault, id) => {
      const written = await this.deps.files.write(vault, id, png);
      if (written === null) {
        return { ok: false, error: `the folder of persona ${id} is outside the tickets vault` };
      }
      return this.done(vault, [written], `personas: ${id} picture`);
    });
  }

  async remove(cmd: PersonaPictureRemove): Promise<PersonaPictureReply> {
    return this.inFolder(cmd.persona, (vault, id) =>
      this.deps.crewFiles.serial(async (): Promise<PersonaPictureReply> => {
        if (!(await this.deps.files.remove(vault, id))) {
          return { ok: false, error: `persona ${id} has no picture` };
        }
        const marked = SHIPPED_AVATAR_IDS.includes(id) ? await this.markRemoved(vault, id) : null;
        return this.done(vault, [avatarPathOf(id), ...(marked === null ? [] : [marked])], `personas: ${id} picture removed`);
      }),
    );
  }

  /** The id joins `seeded-pictures:`, so the backfill never lays the shipped picture down again; the path written, or null when it is listed already. */
  private async markRemoved(vault: EngineVault, id: string): Promise<string | null> {
    const read = await this.deps.crewFiles.read(vault);
    const listed = seededListOf(read.text, SEEDED_PICTURES_KEY);
    if (read.parse.error !== null || listed.includes(id)) {
      return null;
    }
    const next = withSeededList(read.text, SEEDED_PICTURES_KEY, [...listed, id]);
    if (!next.ok) {
      this.deps.log(`persona ${id}: crew.md was not marked — ${next.error}`, 'warn');
      return null;
    }
    await this.deps.crewFiles.put(vault, next.text);
    return CREW_FILE;
  }

  /** The vault and the checked id of a persona whose folder exists, or the refusal. */
  private async inFolder(persona: unknown, work: (vault: EngineVault, id: string) => Promise<PersonaPictureReply>): Promise<PersonaPictureReply> {
    try {
      const id = personaRef(typeof persona === 'string' ? persona : '');
      const vault = await this.deps.board.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      if (!(await this.deps.folders.has(vault, id))) {
        return { ok: false, error: `persona "${id}" not found` };
      }
      return await work(vault, id);
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /** One commit of exactly these paths (a removal staged too); a failed commit is the reply's warning. */
  private async done(vault: EngineVault, paths: readonly string[], message: string): Promise<PersonaPictureReply> {
    let warning: string | null = null;
    const location = await this.deps.git.locate(vault.path).catch(() => null);
    if (location !== null) {
      await this.deps.git.commitTree(location.root, paths.map((p) => `${location.prefix}${p}`), message).catch((error: unknown) => {
        warning = `git commit failed: ${messageOf(error)}`;
      });
    }
    this.deps.host.announceChanges(vault.id, paths);
    this.deps.changed();
    return warning === null ? { ok: true } : { ok: true, warning };
  }
}
