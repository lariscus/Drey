// i18n: catalog
/**
 * The Allowed to block (R11, req-142's page half; board 7k v3, req-288): Run
 * commands as a choice, then Reach the network, Change notes where the
 * project allows (`allowed: write-notes`, req-283) and Spend above allowance
 * as switches; the explanation of a row is its tooltip, never a line under it.
 * Which vaults a run reads and writes is its project's: the link under the
 * rows opens Settings → Projects. The notes switch and spend above the
 * allowance are enforced by the engine; the commands and network choices are
 * recorded in `allowed:` and not yet read by the runner (req-142's remainder).
 */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { COMMAND_CHOICES } from './persona-allowed-model';
import { switchButton } from './persona-controls';
import { blockHead, choiceOptions, outlineButton, selectOf } from './persona-dom';
import type { AllowedDraft } from './persona-model';

function row(label: string, tip: string, control: HTMLElement): HTMLElement {
  const node = h('div', 'persona-row persona-allow-row');
  node.title = tip;
  node.append(h('span', 'persona-grow', label), control);
  return node;
}

export function allowedBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const draft = ctx.draft();
  const set = (next: Partial<AllowedDraft>): void => ctx.change({ allowed: { ...ctx.draft().allowed, ...next } });
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.allowed.title'));
  const commands = selectOf(choiceOptions(t, COMMAND_CHOICES), draft.allowed.runCommands, (value) => ctx.edit({ allowed: { ...ctx.draft().allowed, runCommands: value as AllowedDraft['runCommands'] } }), 'persona-select persona-allow-select');
  commands.setAttribute('aria-label', t('persona.allowed.commands'));
  const toggle = (key: 'network' | 'writeNotes' | 'spend', label: string, field: string): HTMLButtonElement =>
    switchButton(label, draft.allowed[key], () => set({ [key]: !ctx.draft().allowed[key] }), { field });
  const vaults = outlineButton(t('persona.allowed.vaults_link'), 'persona-link persona-allow-link', () => ctx.api.commands.run('settings.open', { category: 'projects' }));
  block.append(
    blockHead(t('persona.allowed.title')),
    row(t('persona.allowed.commands'), t('persona.allowed.commands_tip'), commands),
    row(t('persona.allowed.network'), t('persona.allowed.network_tip'), toggle('network', t('persona.allowed.network'), 'network')),
    row(t('persona.allowed.notes'), t('persona.allowed.notes_tip'), toggle('writeNotes', t('persona.allowed.notes'), 'write-notes')),
    row(t('persona.allowed.spend'), t('persona.allowed.spend_tip'), toggle('spend', t('persona.allowed.spend'), 'spend')),
    vaults,
  );
  return block;
}
