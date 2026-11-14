// i18n: catalog
/**
 * The page's Allowed to block, pure half (R11, req-171/req-142): the run
 * commands' choices (the three yes/no permissions are switches since
 * req-288, board 7k v3), each a key of the record's `allowed:`. Which vaults a run reads and writes is its project's
 * (req-283); the persona keeps the yes/no `write-notes`. `write-notes` and
 * `spend-above-allowance` are enforced — the commands and network choices
 * are recorded (roadmap req-142's remainder). DOM-free.
 */
import type { MessageKey } from '../../../../shared/i18n/types';

export interface Choice {
  readonly value: string;
  readonly label: MessageKey;
}

export const COMMAND_CHOICES: readonly Choice[] = [
  { value: '', label: 'persona.allowed.commands.crew' },
  { value: 'accept-edits', label: 'persona.allowed.commands.accept_edits' },
  { value: 'bypass', label: 'persona.allowed.commands.bypass' },
];
