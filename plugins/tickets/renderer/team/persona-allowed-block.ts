// i18n: catalog
/**
 * The Allowed to block (R11, req-142's page half): four rows, each a
 * permission and its choice; the explanation of a row is its tooltip, never
 * a line under it. Which vaults a run reads and writes is its project's
 * (req-283) — the persona keeps "Change notes where the project allows"
 * (`allowed: write-notes`). That switch and spend above the allowance are
 * enforced by the engine; the commands and network choices are recorded in
 * `allowed:` and not yet read by the runner (req-142's remainder), so the
 * page says nothing more about them.
 */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { blockHead, choiceOptions, selectOf } from './persona-dom';
import { COMMAND_CHOICES, NETWORK_CHOICES, SPEND_CHOICES, networkValueOf, spendValueOf, writeNotesValueOf } from './persona-allowed-model';
import type { AllowedDraft } from './persona-model';

function row(label: string, tip: string, control: HTMLElement): HTMLElement {
  const node = h('div', 'persona-allow-row');
  const name = h('span', 'persona-grow', label);
  node.title = tip;
  node.append(name, control);
  return node;
}

export function allowedBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const draft = ctx.draft();
  const set = (next: Partial<AllowedDraft>): void => ctx.edit({ allowed: { ...ctx.draft().allowed, ...next } });
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.allowed.title'));
  const notes = selectOf(choiceOptions(t, NETWORK_CHOICES), writeNotesValueOf(draft.allowed), (value) => set({ writeNotes: value === 'on' }), 'persona-select persona-select-sm');
  notes.setAttribute('aria-label', t('persona.allowed.notes'));
  const commands = selectOf(choiceOptions(t, COMMAND_CHOICES), draft.allowed.runCommands, (value) => set({ runCommands: value as AllowedDraft['runCommands'] }), 'persona-select persona-select-sm');
  commands.setAttribute('aria-label', t('persona.allowed.commands'));
  const network = selectOf(choiceOptions(t, NETWORK_CHOICES), networkValueOf(draft.allowed), (value) => set({ network: value === 'on' }), 'persona-select persona-select-sm');
  network.setAttribute('aria-label', t('persona.allowed.network'));
  const spend = selectOf(choiceOptions(t, SPEND_CHOICES), spendValueOf(draft.allowed), (value) => set({ spend: value === 'allow' }), 'persona-select persona-select-sm');
  spend.setAttribute('aria-label', t('persona.allowed.spend'));
  const rows = h('div', 'persona-allow');
  rows.append(
    row(t('persona.allowed.notes'), t('persona.allowed.notes_tip'), notes),
    row(t('persona.allowed.commands'), t('persona.allowed.commands_tip'), commands),
    row(t('persona.allowed.network'), t('persona.allowed.network_tip'), network),
    row(t('persona.allowed.spend'), t('persona.allowed.spend_tip'), spend),
  );
  block.append(blockHead(t('persona.allowed.title')), rows);
  return block;
}
