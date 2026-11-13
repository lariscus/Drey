import { CREW_FILE } from '../contracts/crew-config';
import { SEEDED_PICTURES_KEY, seededCrewOf, seededListOf, withSeededList } from '../core/crew-seed-marker';
import { HUMAN_PERSONA_ID } from '../core/persona';
import type { TicketsGit } from '../core/tickets-git';
import type { CrewConfigFiles } from './crew-config-files';
import type { EngineHost, EngineVault } from './host';
import { avatarPathOf, type PersonaAvatarWriter } from './persona-avatars';
import type { PersonaFolderPort } from './persona-folders';

/** The commit message of the one commit a backfill makes. */
export const CREW_PICTURES_COMMIT = 'personas: crew pictures';

export interface CrewPicturesDeps {
  readonly host: Pick<EngineHost, 'announceChanges'>;
  readonly git: Pick<TicketsGit, 'locate' | 'commitPaths'>;
  readonly folders: PersonaFolderPort;
  readonly avatars: PersonaAvatarWriter;
  readonly crewFiles: Pick<CrewConfigFiles, 'read' | 'put' | 'serial'>;
  readonly log: (message: string, level?: 'info' | 'warn') => void;
}

/** What one backfill did: the ids that got their shipped picture. */
export type CrewPicturesResult = { readonly kind: 'pictured'; readonly ids: readonly string[] } | { readonly kind: 'nothing' } | { readonly kind: 'refused'; readonly reason: string };

/**
 * The shipped pictures for a board seeded before they existed (req-292): at
 * the engine's start, after the crew seeding, every persona of the
 * `seeded-crew:` list and the human `you` whose folder is there but holds
 * no `avatar.png` gets the package's picture — one commit of the pictures
 * and `crew.md`. The ids join `seeded-pictures:` in that commit, so a
 * picture the owner removes later stays removed. A deleted persona has no
 * folder and is not re-created; a picture already there is never
 * overwritten (it only joins the list). Never throws.
 */
export class CrewPictures {
  constructor(private readonly deps: CrewPicturesDeps) {}

  async backfill(vault: EngineVault): Promise<CrewPicturesResult> {
    try {
      return await this.deps.crewFiles.serial(() => this.backfillLocked(vault));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.log(`crew: the crew pictures failed — ${reason}`, 'warn');
      return { kind: 'refused', reason };
    }
  }

  private async backfillLocked(vault: EngineVault): Promise<CrewPicturesResult> {
    const read = await this.deps.crewFiles.read(vault);
    if (read.parse.error !== null) {
      return { kind: 'refused', reason: read.parse.error };
    }
    const done = seededListOf(read.text, SEEDED_PICTURES_KEY);
    const candidates = [...new Set([...seededCrewOf(read.text), HUMAN_PERSONA_ID])].filter((id) => !done.includes(id));
    const copied: string[] = [];
    const marked: string[] = [];
    for (const id of candidates) {
      if (!(await this.deps.folders.has(vault, id))) {
        continue;
      }
      const written = await this.deps.avatars.copyShipped(vault, id);
      if (written !== null) {
        copied.push(id);
        marked.push(id);
      } else if (await this.deps.avatars.has(vault, id)) {
        marked.push(id);
      }
    }
    if (copied.length === 0) {
      return { kind: 'nothing' };
    }
    const next = withSeededList(read.text, SEEDED_PICTURES_KEY, [...done, ...marked]);
    if (!next.ok) {
      return { kind: 'refused', reason: next.error };
    }
    await this.deps.crewFiles.put(vault, next.text);
    const paths = [...copied.map(avatarPathOf), CREW_FILE];
    await this.commit(vault, paths);
    this.deps.host.announceChanges(vault.id, paths);
    this.deps.log(`crew: gave ${copied.join(', ')} the shipped picture`);
    return { kind: 'pictured', ids: copied };
  }

  private async commit(vault: EngineVault, paths: readonly string[]): Promise<void> {
    const location = await this.deps.git.locate(vault.path);
    if (location === null) {
      this.deps.log('crew: the tickets vault is not a git repository — the crew pictures are not versioned', 'info');
      return;
    }
    try {
      await this.deps.git.commitPaths(location.root, paths.map((path) => `${location.prefix}${path}`), CREW_PICTURES_COMMIT);
    } catch (error) {
      this.deps.log(`crew: git commit failed: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }
}
