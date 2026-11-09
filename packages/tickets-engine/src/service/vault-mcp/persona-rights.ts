/**
 * What a worker may write (req-167, the owner's ruling R5; req-142's vault
 * right): every registered vault is readable; writing is granted per vault by
 * the run's persona (`allowed: write-vaults: [...]` in `persona.md`), read at
 * every call so a change to the persona applies to the next call. A run with
 * no persona, a persona without the entry, and a read-only run (a review,
 * req-183) write nothing. A move is a write right.
 */
import type { VaultWriteGrant } from '../../../../../shared/vault-tools';

/** Where a persona's grant is read: the board's persona records. */
export interface PersonaSource {
  /** The persona's `allowed: write-vaults`; null when there is no such persona. */
  writeVaultsOf(personaId: string): Promise<readonly string[] | null>;
}

export class PersonaRights {
  constructor(private readonly source: PersonaSource) {}

  async grantFor(who: { readonly persona: string | null; readonly readOnly: boolean }): Promise<VaultWriteGrant> {
    if (who.persona === null) {
      return { who: 'this run', vaults: [] };
    }
    const vaults = who.readOnly ? [] : ((await this.source.writeVaultsOf(who.persona).catch(() => null)) ?? []);
    return { who: who.persona, vaults };
  }
}
