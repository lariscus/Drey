/**
 * The title bar's scope choice (SDK 1.59, `ui.workspaceScope()`) as far as
 * a vault search needs it: the ids of the registered vaults the choice
 * names. Pure -- the Find panel's Search mode (tags plugin) and its Tasks
 * mode (tasks plugin) both read it.
 */

/**
 * A scope choice as far as the lookup needs it -- structurally the SDK's
 * `WorkspaceScopeOption` (kept local: `shared/` is also compiled into main,
 * which has no DOM types for the renderer SDK).
 */
export interface ScopeSources {
  readonly sources: { readonly vaults: readonly { readonly name: string }[] } | null;
}

/** A registered vault, as far as the lookup needs it. */
export interface NamedVault {
  readonly id: string;
  readonly name: string;
}

/**
 * The ids of the registered vaults the choice names (by registry NAME,
 * since vault ids are per device). `null` when the choice does not narrow:
 * no choice ("all") or one without sources ("Unassigned"). A name this
 * device has not registered contributes nothing; plain folders are not
 * vaults and are left out.
 */
export function scopeVaultIds(
  option: ScopeSources | null,
  vaults: readonly NamedVault[],
): ReadonlySet<string> | null {
  const sources = option?.sources ?? null;
  if (sources === null) {
    return null;
  }
  const names = new Set(sources.vaults.map((vault) => vault.name));
  return new Set(vaults.filter((vault) => names.has(vault.name)).map((vault) => vault.id));
}

/** Whether the choice narrows at all (a `project` scope is offered only then). */
export function scopeNarrows(option: ScopeSources | null): boolean {
  return (option?.sources ?? null) !== null;
}
