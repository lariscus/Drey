import type { PersonaAllowed, PersonaRunCommands } from '../core/persona';

/**
 * The `allowed:` keys a persona patch may send (req-171, the page's "Allowed
 * to" block): only the sent keys change, the others stay. `runCommands: null`
 * clears the key (the crew setting decides again); `writeNotes` is the
 * persona's half of a vault write (req-283: the project says which vaults).
 */
export interface PersonaAllowedPatch {
  readonly spendAboveAllowance?: boolean;
  readonly runCommands?: PersonaRunCommands | null;
  readonly network?: boolean;
  readonly writeNotes?: boolean;
}

/** The record's `allowed:` after a patch: sent keys replace, the others stay; a cleared mode leaves the key out, the retired `write-vaults` goes. */
export function allowedAfter(current: PersonaAllowed, patch: PersonaAllowedPatch): PersonaAllowed {
  const { runCommands: _commands, network: _network, writeNotes: _notes, writeVaults: _vaults, ...rest } = current;
  const commands = patch.runCommands === undefined ? current.runCommands : (patch.runCommands ?? undefined);
  const network = patch.network === undefined ? current.network : patch.network;
  const notes = patch.writeNotes === undefined ? current.writeNotes : patch.writeNotes;
  return {
    ...rest,
    spendAboveAllowance: patch.spendAboveAllowance ?? current.spendAboveAllowance,
    ...(commands !== undefined ? { runCommands: commands } : {}),
    ...(network === true ? { network: true } : {}),
    ...(notes === true ? { writeNotes: true } : {}),
  };
}
