// i18n: catalog
/**
 * The page's Allowed to block, pure half (R11, req-171/req-142): the five
 * permissions as rows with their choices. Read vaults is fixed (a persona
 * reads every registered vault through the vault MCP); the other four are
 * the record's `allowed:` keys. Only `write-vaults` and
 * `spend-above-allowance` are enforced so far — the commands and network
 * choices are recorded (roadmap req-142's remainder). DOM-free.
 */
import type { MessageKey } from '../../../../shared/i18n/types';
import type { AllowedDraft } from './persona-model';

export interface VaultChoice {
  readonly id: string;
  readonly name: string;
}

export interface Choice {
  readonly value: string;
  readonly label: MessageKey;
}

export const COMMAND_CHOICES: readonly Choice[] = [
  { value: '', label: 'persona.allowed.commands.crew' },
  { value: 'accept-edits', label: 'persona.allowed.commands.accept_edits' },
  { value: 'bypass', label: 'persona.allowed.commands.bypass' },
];

export const NETWORK_CHOICES: readonly Choice[] = [
  { value: 'off', label: 'persona.allowed.off' },
  { value: 'on', label: 'persona.allowed.on' },
];

export const SPEND_CHOICES: readonly Choice[] = [
  { value: 'ask', label: 'persona.allowed.spend.ask' },
  { value: 'allow', label: 'persona.allowed.spend.allow' },
];

/** The write-vaults button's text: the chosen vaults' names, an unknown id as it is. */
export function writeVaultsText(selected: readonly string[], vaults: readonly VaultChoice[], none: string): string {
  if (selected.length === 0) {
    return none;
  }
  return selected.map((id) => vaults.find((vault) => vault.id === id)?.name ?? id).join(', ');
}

/** The selection after one vault is ticked or unticked; the order is the registry's, then unknown ids. */
export function writeVaultsToggled(selected: readonly string[], vaults: readonly VaultChoice[], id: string, on: boolean): readonly string[] {
  const next = new Set(on ? [...selected, id] : selected.filter((entry) => entry !== id));
  const known = vaults.filter((vault) => next.has(vault.id)).map((vault) => vault.id);
  return [...known, ...[...next].filter((entry) => !known.includes(entry))];
}

export function networkValueOf(allowed: AllowedDraft): string {
  return allowed.network ? 'on' : 'off';
}

export function spendValueOf(allowed: AllowedDraft): string {
  return allowed.spend ? 'allow' : 'ask';
}
