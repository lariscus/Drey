// i18n: catalog
/**
 * The right side of Settings → Projects (req-284, board 7m): the head with
 * the project's dot and name and its actions, Name and Colour, Purpose in
 * Drey's Markdown editor (formatting strip, Live | Source, its token count),
 * Repositories beside Folders, and the Vaults. Every change is one commit,
 * applied as made: Name when the field is left or on Enter, Purpose when
 * the editor loses focus, everything else on the click.
 */
import type { MarkdownFormatAction, MarkdownViewHandle } from '../../../../shared/plugin-api/renderer';
import type { MessageKey } from '../../../../shared/i18n/types';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { estimateTokens, tokenizerFor } from '../../../../packages/tickets-engine/src/core/config/token-count';
import { h } from '../board/desk-deps';
import { accessControl, dot, iconBtn, tag } from './projects-dom';
import { colorOf, PROJECT_COLOR_PRESETS, presetOf, vaultRowsOf, withVaultAccess } from './projects-model';
import type { ProjectsContext } from './projects-context';
import { foldersBlock, repositoriesBlock } from './projects-sources';

const STRIP: readonly { readonly action: MarkdownFormatAction; readonly icon: string; readonly label: MessageKey }[] = [
  { action: 'bold', icon: 'bold', label: 'persona.format.bold' },
  { action: 'italic', icon: 'italic', label: 'persona.format.italic' },
  { action: 'heading', icon: 'heading', label: 'persona.format.heading' },
  { action: 'bullet', icon: 'list', label: 'persona.format.bullet' },
  { action: 'task', icon: 'check', label: 'persona.format.task' },
  { action: 'code', icon: 'code', label: 'persona.format.code' },
];

const purposeTokens = (text: string): number => estimateTokens(text.trim(), tokenizerFor('claude-code', null));

export interface ProjectDetail {
  readonly element: HTMLElement;
  /** Writes a Purpose typed but not yet committed (the page switches project or closes). */
  flush(): void;
  dispose(): void;
}

function headOf(ctx: ProjectsContext, project: ProjectRecord): HTMLElement {
  const { t } = ctx;
  const head = h('div', 'prj-head');
  const title = h('h1', 'prj-title', project.name);
  const menu = h('div', 'prj-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const actions = iconBtn(ctx.api, 'more-horizontal', t('projects.actions'), () => {
    menu.hidden = !menu.hidden;
    menu.replaceChildren(deleteItem());
  });
  const deleteItem = (): HTMLElement => {
    const item = h('button', 'prj-menu-item prj-danger', t('projects.delete'));
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.addEventListener('click', () => {
      const ask = h('div', 'prj-ask');
      const yes = h('button', 'prj-btn prj-danger', t('projects.delete_confirm'));
      const no = h('button', 'prj-btn', t('projects.keep'));
      yes.type = 'button';
      no.type = 'button';
      yes.addEventListener('click', () => void ctx.remove(project.id));
      no.addEventListener('click', () => (menu.hidden = true));
      ask.append(h('span', undefined, t('projects.delete_ask', { name: project.name })), yes, no);
      menu.replaceChildren(ask);
    });
    return item;
  };
  const wrap = h('div', 'prj-menu-wrap');
  wrap.append(actions, menu);
  head.append(dot(colorOf(project), 'prj-dot prj-dot-14'), title, h('span', 'prj-grow'), wrap);
  return head;
}

function nameAndColour(ctx: ProjectsContext, project: ProjectRecord): HTMLElement {
  const { t } = ctx;
  const row = h('div', 'prj-row');
  const nameField = h('div', 'prj-field');
  const label = h('label', 'prj-label', t('projects.name'));
  const input = h('input', 'prj-input');
  input.id = `prj-name-${project.id}`;
  label.htmlFor = input.id;
  input.type = 'text';
  input.value = project.name;
  input.addEventListener('change', () => {
    const name = input.value.trim();
    if (name === '') {
      input.value = project.name;
    } else if (name !== project.name) {
      void ctx.save(project.id, { name });
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      input.blur();
    }
  });
  nameField.append(label, input);

  const colourField = h('div', 'prj-field');
  const group = h('div', 'prj-swatches');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', t('projects.colour'));
  const current = colorOf(project);
  const pick = (hex: string): void => {
    if (hex.toLowerCase() !== current) {
      void ctx.save(project.id, { color: hex.toLowerCase() });
    }
  };
  for (const preset of PROJECT_COLOR_PRESETS) {
    const swatch = h('button', 'prj-swatch');
    swatch.type = 'button';
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-checked', String(preset.hex === current));
    swatch.title = t(preset.label);
    swatch.setAttribute('aria-label', t(preset.label));
    swatch.style.background = preset.hex;
    swatch.addEventListener('click', () => pick(preset.hex));
    group.append(swatch);
  }
  const custom = h('label', 'prj-swatch prj-swatch-custom');
  custom.title = t('projects.custom_colour');
  custom.classList.toggle('prj-swatch-on', presetOf(current) === null);
  const picker = h('input');
  picker.type = 'color';
  picker.value = current;
  picker.setAttribute('aria-label', t('projects.custom_colour'));
  picker.addEventListener('change', () => pick(picker.value));
  custom.append(picker);
  group.append(custom);
  colourField.append(h('span', 'prj-label', t('projects.colour')), group);
  row.append(nameField, colourField);
  return row;
}

function purposeBlock(ctx: ProjectsContext, project: ProjectRecord): { element: HTMLElement; flush(): void; dispose(): void } {
  const { t, api } = ctx;
  const block = h('div', 'prj-block');
  const title = h('h2', 'prj-h2', t('projects.purpose'));
  const tokens = h('span', 'prj-h2-note', t('projects.tokens', { count: purposeTokens(project.purpose) }));
  title.append(tokens);
  let committed = project.purpose;
  let view: MarkdownViewHandle | null = api.ui.createMarkdownView({
    content: project.purpose,
    mode: 'live',
    onChange: (text) => (tokens.textContent = t('projects.tokens', { count: purposeTokens(text) })),
  });
  view.element.classList.add('prj-ed-view');
  view.element.setAttribute('aria-label', t('projects.purpose_of', { name: project.name }));
  const flush = (): void => {
    const text = view?.getContent() ?? committed;
    if (text.trim() !== committed.trim()) {
      committed = text;
      void ctx.save(project.id, { purpose: text });
    }
  };
  const bar = h('div', 'prj-ed-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('persona.format.label'));
  for (const entry of STRIP) {
    bar.append(iconBtn(api, entry.icon, t(entry.label), () => view?.format(entry.action), 14));
  }
  const modes = h('div', 'prj-ed-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', t('projects.editor_mode'));
  const mode = (word: MessageKey, value: 'live' | 'source', on: boolean): HTMLButtonElement => {
    const button = h('button', 'prj-mode', t(word));
    button.type = 'button';
    button.setAttribute('aria-pressed', String(on));
    button.addEventListener('click', () => {
      view?.setMode(value);
      for (const other of Array.from(modes.children)) {
        other.setAttribute('aria-pressed', String(other === button));
      }
    });
    return button;
  };
  modes.append(mode('persona.mode.live', 'live', true), mode('persona.mode.source', 'source', false));
  bar.append(h('span', 'prj-grow'), modes);
  const frame = h('div', 'prj-ed');
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', t('projects.purpose'));
  const body = h('div', 'prj-ed-body');
  body.append(view.element);
  frame.append(bar, body);
  frame.addEventListener('focusout', (event) => {
    if (!frame.contains(event.relatedTarget as Node | null)) {
      flush();
    }
  });
  block.append(title, frame);
  return {
    element: block,
    flush,
    dispose: () => {
      view?.dispose();
      view = null;
    },
  };
}

function vaultsBlock(ctx: ProjectsContext, project: ProjectRecord): HTMLElement {
  const { t } = ctx;
  const block = h('div', 'prj-block prj-vaults');
  block.append(h('h2', 'prj-h2', t('projects.vaults')));
  const words = { none: t('projects.access.none'), read: t('projects.access.read'), write: t('projects.access.write') } as const;
  const list = h('div', 'prj-vault-list');
  for (const row of vaultRowsOf(project, ctx.vaultNames())) {
    const line = h('div', row.notOnDevice ? 'prj-vault prj-vault-away' : 'prj-vault');
    line.append(h('span', 'prj-vault-name', row.name));
    if (row.notOnDevice) {
      line.append(tag(t('projects.not_on_device')), h('span', 'prj-grow'));
    }
    line.append(accessControl(t('projects.access_of', { name: row.name }), words, row.access, row.notOnDevice, (access) => void ctx.save(project.id, { vaults: withVaultAccess(ctx.latest(project.id).vaults, row.name, access) })));
    list.append(line);
  }
  block.append(list);
  return block;
}

export function projectDetail(ctx: ProjectsContext, project: ProjectRecord): ProjectDetail {
  const element = h('div', 'prj-detail');
  const purpose = purposeBlock(ctx, project);
  const sources = h('div', 'prj-row prj-sources');
  sources.append(repositoriesBlock(ctx, project), foldersBlock(ctx, project));
  element.append(headOf(ctx, project), nameAndColour(ctx, project), purpose.element, sources, vaultsBlock(ctx, project));
  return { element, flush: purpose.flush, dispose: purpose.dispose };
}
