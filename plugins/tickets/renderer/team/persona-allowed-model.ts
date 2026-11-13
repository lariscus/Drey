// i18n: catalog
/**
 * The page's Allowed to block, pure half (R11, req-171/req-142): the four
 * permissions as rows with their choices, each a key of the record's
 * `allowed:`. Which vaults a run reads and writes is its project's
 * (req-283); the persona keeps the yes/no `write-notes`. `write-notes` and
 * `spend-above-allowance` are enforced — the commands and network choices
 * are recorded (roadmap req-142's remainder). DOM-free.
 */
import type { MessageKey } from '../../../../shared/i18n/types';
import type { AllowedDraft } from './persona-model';

export interface Choice {
  readonly value: string;
  readonly label: MessageKey;
}

export const COMMAND_CHOICES: readonly Choice[] = [
  { value: '', label: 'persona.allowed.commands.crew' },
  { value: 'accept-edits', label: 'persona.allowed.commands.accept_edits' },
  { value: 'bypass', label: 'persona.allowed.commands.bypass' },
];

/** The Off | On choice of a yes/no permission: network and write-notes. */
export const NETWORK_CHOICES: readonly Choice[] = [
  { value: 'off', label: 'persona.allowed.off' },
  { value: 'on', label: 'persona.allowed.on' },
];

export const SPEND_CHOICES: readonly Choice[] = [
  { value: 'ask', label: 'persona.allowed.spend.ask' },
  { value: 'allow', label: 'persona.allowed.spend.allow' },
];

export function writeNotesValueOf(allowed: AllowedDraft): string {
  return allowed.writeNotes ? 'on' : 'off';
}

export function networkValueOf(allowed: AllowedDraft): string {
  return allowed.network ? 'on' : 'off';
}

export function spendValueOf(allowed: AllowedDraft): string {
  return allowed.spend ? 'allow' : 'ask';
}
