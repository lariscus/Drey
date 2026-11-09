// i18n: catalog
/**
 * The Allowed to block (R11, req-142's page half): five rows, each a
 * permission and its choice; the explanation of a row is its tooltip, never
 * a line under it. Read vaults is fixed. Write vaults and spend above the
 * allowance are enforced by the engine; the commands and network choices
 * are recorded in `allowed:` and not yet read by the runner (req-142's
 * remainder), so the page says nothing more about them.
 */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { blockHead, choiceOptions, outlineButton, selectOf } from './persona-dom';
import { COMMAND_CHOICES, NETWORK_CHOICES, SPEND_CHOICES, networkValueOf, spendValueOf, writeVaultsText, writeVaultsToggled } from './persona-allowed-model';
import type { AllowedDraft } from './persona-model';

function row(label: string, tip: string, control: HTMLElement): HTMLElement {
  const node = h('div', 'persona-allow-row');
  const name = h('span', 'persona-grow', label);
  node.title = tip;
  node.append(name, control);
  return node;
}

function writeVaults(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const draft = ctx.draft();
  const { vaults } = ctx.extras;
  const wrap = h('span', 'persona-vault-pick');
  const button = outlineButton(writeVaultsText(draft.allowed.writeVaults, vaults, t('persona.allowed.none')), 'persona-sel', () => {
    list.hidden = !list.hidden;
    button.setAttribute('aria-expanded', String(!list.hidden));
  });
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', t('persona.allowed.write'));
  button.append(h('span', 'persona-caret', '▾'));
  const list = h('div', 'persona-menu persona-vault-list');
  list.hidden = true;
  for (const vault of vaults) {
    const line = h('label', 'persona-menu-item persona-vault-item');
    const box = h('input');
    box.type = 'checkbox';
    box.checked = draft.allowed.writeVaults.includes(vault.id);
    box.dataset['vault'] = vault.id;
    box.addEventListener('change', () => {
      const allowed: AllowedDraft = { ...ctx.draft().allowed, writeVaults: writeVaultsToggled(ctx.draft().allowed.writeVaults, vaults, vault.id, box.checked) };
      ctx.edit({ allowed });
      button.firstChild!.textContent = writeVaultsText(allowed.writeVaults, vaults, t('persona.allowed.none'));
    });
    line.append(box, h('span', undefined, vault.name));
    list.append(line);
  }
  wrap.append(button, list);
  return wrap;
}

export function allowedBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const draft = ctx.draft();
  const set = (next: Partial<AllowedDraft>): void => ctx.edit({ allowed: { ...ctx.draft().allowed, ...next } });
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.allowed.title'));
  const commands = selectOf(choiceOptions(t, COMMAND_CHOICES), draft.allowed.runCommands, (value) => set({ runCommands: value as AllowedDraft['runCommands'] }), 'persona-select persona-select-sm');
  commands.setAttribute('aria-label', t('persona.allowed.commands'));
  const network = selectOf(choiceOptions(t, NETWORK_CHOICES), networkValueOf(draft.allowed), (value) => set({ network: value === 'on' }), 'persona-select persona-select-sm');
  network.setAttribute('aria-label', t('persona.allowed.network'));
  const spend = selectOf(choiceOptions(t, SPEND_CHOICES), spendValueOf(draft.allowed), (value) => set({ spend: value === 'allow' }), 'persona-select persona-select-sm');
  spend.setAttribute('aria-label', t('persona.allowed.spend'));
  const rows = h('div', 'persona-allow');
  rows.append(
    row(t('persona.allowed.read'), t('persona.allowed.read_tip'), h('span', 'persona-muted', t('persona.allowed.all'))),
    row(t('persona.allowed.write'), t('persona.allowed.write_tip'), writeVaults(ctx)),
    row(t('persona.allowed.commands'), t('persona.allowed.commands_tip'), commands),
    row(t('persona.allowed.network'), t('persona.allowed.network_tip'), network),
    row(t('persona.allowed.spend'), t('persona.allowed.spend_tip'), spend),
  );
  block.append(blockHead(t('persona.allowed.title')), rows);
  return block;
}
