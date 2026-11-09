// i18n: catalog
/**
 * The Instructions block (R11): Drey's own Markdown editor directly in the
 * block, over `prompt.md` — Live Preview ⇄ Source and the formatting strip
 * as the host offers them (`ui.createMarkdownView`, SDK 1.30 + 1.57; the
 * plugin never carries a CodeMirror of its own, ADR-0044 rule 1). The head
 * says what the prompt costs; "Preview full prompt" is drawn once an engine
 * route assembles the prompt (req-238, `PromptPreviewSeam`).
 */
import type { MarkdownFormatAction, MarkdownViewHandle } from '../../../../shared/plugin-api/renderer';
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { blockHead, iconButton, outlineButton } from './persona-dom';
import { estimateTokens, type PromptPreview } from './persona-seams';

const STRIP: readonly { readonly action: MarkdownFormatAction; readonly icon: string; readonly label: 'persona.format.bold' | 'persona.format.italic' | 'persona.format.heading' | 'persona.format.bullet' | 'persona.format.task' | 'persona.format.code' }[] = [
  { action: 'bold', icon: 'bold', label: 'persona.format.bold' },
  { action: 'italic', icon: 'italic', label: 'persona.format.italic' },
  { action: 'heading', icon: 'heading', label: 'persona.format.heading' },
  { action: 'bullet', icon: 'list', label: 'persona.format.bullet' },
  { action: 'task', icon: 'check', label: 'persona.format.task' },
  { action: 'code', icon: 'code', label: 'persona.format.code' },
];

export interface InstructionsBlock {
  readonly element: HTMLElement;
  /** Puts the saved or discarded text back, keeping the caret where the text allows. */
  setText(text: string): void;
  /** False while the file could not be read: nothing may be typed over text that was never loaded. */
  setEditable(editable: boolean): void;
  dispose(): void;
}

export function createInstructionsBlock(ctx: BlockContext, initial: string, editable: boolean): InstructionsBlock {
  const { t, api } = ctx;
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.page.instructions'));
  const tokens = h('small', 'persona-muted persona-tokens');
  const countTokens = (text: string): void => {
    tokens.textContent = t('persona.page.tokens', { count: estimateTokens(text) });
  };
  countTokens(initial);

  let view: MarkdownViewHandle | null = api.ui.createMarkdownView({
    content: initial,
    mode: 'live',
    readOnly: !editable,
    onChange: (text) => {
      countTokens(text);
      ctx.edit({ prompt: text });
    },
  });
  view.element.classList.add('persona-ed-view');
  view.element.setAttribute('aria-label', t('persona.page.instructions_for', { name: ctx.draft().title }));

  const bar = h('div', 'persona-ed-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('persona.format.label'));
  for (const entry of STRIP) {
    bar.append(iconButton(api, entry.icon, t(entry.label), () => view?.format(entry.action)));
  }
  const modes = h('span', 'persona-ed-modes');
  const live = outlineButton(t('persona.mode.live'), 'persona-mode persona-mode-on', () => setMode('live'));
  const source = outlineButton(t('persona.mode.source'), 'persona-mode', () => setMode('source'));
  live.setAttribute('aria-pressed', 'true');
  source.setAttribute('aria-pressed', 'false');
  const setMode = (mode: 'live' | 'source'): void => {
    view?.setMode(mode);
    for (const [button, on] of [[live, mode === 'live'], [source, mode === 'source']] as const) {
      button.classList.toggle('persona-mode-on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  };
  modes.append(live, source);
  bar.append(h('span', 'persona-grow'), modes);

  const frame = h('div', 'persona-ed');
  frame.append(bar, view.element);

  let preview: HTMLElement | null = null;
  let previewView: MarkdownViewHandle | null = null;
  const closePreview = (): void => {
    previewView?.dispose();
    previewView = null;
    preview?.remove();
    preview = null;
  };
  const showPreview = async (): Promise<void> => {
    if (preview !== null) {
      closePreview();
      return;
    }
    const reply: PromptPreview | null = await ctx.previewSeam.preview(ctx.persona.id);
    if (reply === null || preview !== null) {
      return;
    }
    previewView = api.ui.createMarkdownView({ content: reply.text, mode: 'view', readOnly: true });
    preview = h('div', 'persona-ed persona-ed-preview');
    preview.append(h('small', 'persona-muted persona-tokens', t('persona.page.tokens', { count: reply.tokens })), previewView.element);
    block.append(preview);
  };
  const previewButton = ctx.previewSeam.available ? outlineButton(t('persona.page.preview_prompt'), 'persona-btn persona-btn-28', () => void showPreview()) : null;

  block.append(blockHead(t('persona.page.instructions'), tokens, previewButton), frame);
  return {
    element: block,
    setText: (text) => {
      view?.setContent(text);
      countTokens(text);
    },
    setEditable: (value) => view?.setReadOnly(!value),
    dispose: () => {
      closePreview();
      view?.dispose();
      view = null;
    },
  };
}
