import type { VaultPathsChange } from './vault-paths-change';

interface Touched {
  readonly changed: Set<string>;
  readonly deleted: Set<string>;
}

/**
 * What one tool call changed, by vault (req-213): the shared tool set
 * announces the files it wrote or deleted; a move also names the old and the
 * new path, which the set announces only as a refresh. The last state of a
 * path wins (written after it was deleted counts once, as written). One
 * collector per call: {@link changes} is what a successful call tells the
 * engine's paths channel, so Drey's vault round hears one report per call.
 */
export class ChangeCollector {
  private readonly byVault = new Map<string, Touched>();

  add(vaultId: string, changed: readonly string[], deleted: readonly string[]): void {
    const touched = this.touchedOf(vaultId);
    for (const path of changed) {
      touched.deleted.delete(path);
      touched.changed.add(path);
    }
    for (const path of deleted) {
      touched.changed.delete(path);
      touched.deleted.add(path);
    }
  }

  /** The old path is gone, the new one is there. */
  addMove(vaultId: string, from: string, to: string): void {
    this.add(vaultId, [to], [from]);
  }

  /** The reports, one per vault that was touched, the vault's id resolved to its folder. */
  changes(folderOf: (vaultId: string) => string): readonly VaultPathsChange[] {
    return [...this.byVault.entries()]
      .filter(([, touched]) => touched.changed.size + touched.deleted.size > 0)
      .map(([vaultId, touched]) => ({ vaultPath: folderOf(vaultId), changed: [...touched.changed], deleted: [...touched.deleted] }));
  }

  private touchedOf(vaultId: string): Touched {
    let touched = this.byVault.get(vaultId);
    if (touched === undefined) {
      touched = { changed: new Set(), deleted: new Set() };
      this.byVault.set(vaultId, touched);
    }
    return touched;
  }
}
