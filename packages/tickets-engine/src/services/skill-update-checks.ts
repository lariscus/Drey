import { isVersionRef, newerVersionRef, parseGithubRepo } from '../core/skills/skill-source';
import { recordId, type SkillSourceRecord } from '../core/skills/skill-sources-file';
import type { GithubClient } from './github-client';

/** What the last look found for one source. */
export interface UpdateLook {
  readonly updateAvailable: string | null;
  readonly checked: string | null;
  readonly checkError: string | null;
}

interface Entry extends UpdateLook {
  /** The record the look was for: a fetch or update at another ref or commit makes it stale. */
  readonly key: string;
  readonly at: number;
}

const NONE: UpdateLook = { updateAvailable: null, checked: null, checkError: null };
/** A look younger than this is not repeated when the page opens again. */
const FRESH_MS = 5 * 60_000;

const keyOf = (record: SkillSourceRecord): string => `${record.ref}@${record.commit}`;

/**
 * The look for newer refs of the library's sources (req-289), kept in memory
 * for the service's life: a version tag's update is a higher tag of the same
 * spelling, a branch's is a newer commit on it. It runs only when asked —
 * the Skills library's first look and a fetch — never on a timer; every
 * listing (the Persona page's included) reads what it last found.
 */
export class SkillUpdateChecks {
  private readonly looks = new Map<string, Entry>();

  constructor(
    private readonly github: GithubClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Looks at every source whose last look is older than five minutes or was for another ref or commit. */
  async check(records: readonly SkillSourceRecord[]): Promise<void> {
    for (const record of records) {
      const known = this.looks.get(recordId(record));
      if (known === undefined || known.key !== keyOf(record) || this.now().getTime() - known.at > FRESH_MS) {
        this.looks.set(recordId(record), await this.lookAt(record));
      }
    }
  }

  lookOf(record: SkillSourceRecord): UpdateLook {
    const known = this.looks.get(recordId(record));
    return known === undefined || known.key !== keyOf(record) ? NONE : { updateAvailable: known.updateAvailable, checked: known.checked, checkError: known.checkError };
  }

  /** The newer ref of a record, asked of GitHub; null when it is at its newest. */
  async newerRef(record: SkillSourceRecord): Promise<string | null> {
    const repo = parseGithubRepo(record.repo);
    if (repo === null) {
      return null;
    }
    if (isVersionRef(record.ref)) {
      return newerVersionRef(record.ref, await this.github.tagsOf(repo));
    }
    const head = await this.github.commitOf(repo, record.ref);
    return head.sha === record.commit ? null : record.ref;
  }

  private async lookAt(record: SkillSourceRecord): Promise<Entry> {
    const at = this.now();
    const base = { key: keyOf(record), at: at.getTime(), checked: at.toISOString() };
    try {
      return { ...base, updateAvailable: await this.newerRef(record), checkError: null };
    } catch (error) {
      return { ...base, updateAvailable: null, checkError: error instanceof Error ? error.message : String(error) };
    }
  }
}
