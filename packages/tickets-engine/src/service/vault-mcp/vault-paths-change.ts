/**
 * One announced change (req-213): the folder of the vault a worker's tool
 * call touched and the vault-relative paths that changed or went away (a
 * move = both). The shape of the engine hub's `PathsChange` — the engine's
 * paths channel tells Drey's vault round.
 */
export interface VaultPathsChange {
  readonly vaultPath: string;
  readonly changed: readonly string[];
  readonly deleted: readonly string[];
}
