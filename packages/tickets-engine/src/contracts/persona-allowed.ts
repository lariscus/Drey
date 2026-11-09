import type { PersonaAllowed, PersonaRunCommands } from '../core/persona';

/**
 * The `allowed:` keys a persona patch may send (req-171, the page's "Allowed
 * to" block): only the sent keys change, the others stay. `runCommands: null`
 * clears the key (the crew setting decides again); `writeVaults` replaces the
 * list of vault ids the persona's runs may change.
 */
export interface PersonaAllowedPatch {
  readonly spendAboveAllowance?: boolean;
  readonly runCommands?: PersonaRunCommands | null;
  readonly network?: boolean;
  readonly writeVaults?: readonly string[];
}

/** The record's `allowed:` after a patch: sent keys replace, the others stay; an empty vault list and a cleared mode leave the key out. */
export function allowedAfter(current: PersonaAllowed, patch: PersonaAllowedPatch): PersonaAllowed {
  const { runCommands: _commands, network: _network, writeVaults: _vaults, ...rest } = current;
  const commands = patch.runCommands === undefined ? current.runCommands : (patch.runCommands ?? undefined);
  const network = patch.network === undefined ? current.network : patch.network;
  const vaults = patch.writeVaults === undefined ? current.writeVaults : [...new Set(patch.writeVaults.map((v) => v.trim()))];
  return {
    ...rest,
    spendAboveAllowance: patch.spendAboveAllowance ?? current.spendAboveAllowance,
    ...(commands !== undefined ? { runCommands: commands } : {}),
    ...(network === true ? { network: true } : {}),
    ...(vaults !== undefined && vaults.length > 0 ? { writeVaults: vaults } : {}),
  };
}
