import type { TicketsGit } from '../core/tickets-git';
import type { EngineHost, EngineVault } from './host';

/**
 * The git step of a skill change (req-172): one commit for exactly the paths
 * the change touched — removals included, a skill folder that went leaves the
 * index in the same commit — then the vault's change round for them. A vault
 * outside git keeps the write unversioned (a warning, never a failure), the
 * same discipline as `crew.md` and `repos.md`.
 */
export class SkillCommitter {
  constructor(
    private readonly host: Pick<EngineHost, 'announceChanges' | 'log'>,
    private readonly git: Pick<TicketsGit, 'locate' | 'commitTree'>,
  ) {}

  /** `changed` and `deleted` are vault-relative files; returns a warning line, or null when all went well. */
  async commit(vault: EngineVault, change: { readonly changed: readonly string[]; readonly deleted: readonly string[] }, message: string): Promise<string | null> {
    const paths = [...change.changed, ...change.deleted];
    if (paths.length === 0) {
      return null;
    }
    this.host.announceChanges(vault.id, change.changed, change.deleted);
    const location = await this.git.locate(vault.path);
    if (location === null) {
      return 'the tickets vault is not a git repository — the change is not versioned';
    }
    try {
      await this.git.commitTree(location.root, paths.map((p) => `${location.prefix}${p}`), message);
      return null;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.host.log(`git commit failed: ${text}`, 'warn');
      return `git commit failed: ${text.split('\n')[0]}`;
    }
  }
}
