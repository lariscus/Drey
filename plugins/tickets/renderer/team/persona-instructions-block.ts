// i18n: catalog
/**
 * The Instructions block (R11): Drey's own Markdown editor directly in the
 * block, over `prompt.md` — Live Preview ⇄ Source and the formatting strip
 * as the host offers them (`ui.createMarkdownView`, SDK 1.30 + 1.57; the
 * plugin never carries a CodeMirror of its own, ADR-0044 rule 1). The head
 * says what a run costs at its start (`≈ N tokens at start`: the engine's
 * count of the assembled brief with the editor's text as the instructions,
 * req-238) and `Preview full prompt` opens that brief read-only below the
 * editor (`persona-preview-panel.ts`).
 */
import type { MarkdownFormatAction, MarkdownViewHandle } from '../../../../shared/plugin-api/renderer';
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { iconButton, outlineButton } from './persona-dom';
import { createEditorGrip } from './persona-ed-grip';
import { createPreviewPanel, type PreviewPanel } from './persona-preview-panel';
import { atStartTokensOf } from './persona-preview-model';
import { estimateTokens, tokenizerFor } from '../../../../packages/tickets-engine/src/core/token-count';
import { failureTextOf } from './persona-skills-model';

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
  /** The token figure and Preview full prompt: they sit in the page's tab row while Instructions is the tab (board 7k v4). */
  readonly controls: readonly HTMLElement[];
  /** Puts the saved or discarded text back, keeping the caret where the text allows. */
  setText(text: string): void;
  /** False while the file could not be read: nothing may be typed over text that was never loaded. */
  setEditable(editable: boolean): void;
  dispose(): void;
}

export function createInstructionsBlock(ctx: BlockContext, initial: string, editable: boolean): InstructionsBlock {
  const { t, api } = ctx;
  const block = h('section', 'persona-block persona-block-fill');
  block.setAttribute('aria-label', t('persona.page.instructions'));
  const tokens = h('small', 'persona-muted persona-tokens');
  let current = initial;
  /** At the start of a run (for her, of a Mission Control turn) once the engine has counted the brief; the instructions alone until then (or when it cannot). */
  const countTokens = (text: string): void => {
    current = text;
    const preview = ctx.preview.preview;
    const own = ctx.draft();
    tokens.textContent = preview === null ? t('persona.page.tokens', { count: estimateTokens(text.trim(), tokenizerFor(own.worker, own.pool[0] ?? null)) }) : t('persona.page.tokens_at_start', { count: atStartTokensOf(preview, text) });
  };
  countTokens(initial);
  const offPreview = ctx.preview.subscribe(() => countTokens(current));

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

  let panel: PreviewPanel | null = null;
  const problem = h('div', 'persona-note persona-state-error persona-problem');
  problem.setAttribute('role', 'alert');
  problem.hidden = true;
  const closePreview = (): void => {
    panel?.dispose();
    panel = null;
    previewButton.setAttribute('aria-pressed', 'false');
  };
  /** The panel shows the brief the engine last assembled; it follows a new one while it is open. */
  const drawPanel = (): void => {
    const brief = ctx.preview.preview;
    panel?.dispose();
    panel = brief === null ? null : createPreviewPanel(ctx, brief);
    if (panel !== null) {
      block.append(panel.element);
    }
    previewButton.setAttribute('aria-pressed', String(panel !== null));
  };
  const showPreview = async (): Promise<void> => {
    if (panel !== null) {
      closePreview();
      return;
    }
    await ctx.preview.ensure(true);
    const failure = ctx.preview.failure;
    problem.textContent = failure === null ? '' : failureTextOf(t, failure);
    problem.hidden = failure === null;
    if (failure === null) {
      drawPanel();
    }
  };
  const previewButton = outlineButton(t('persona.page.preview_prompt'), 'persona-btn persona-btn-28', () => void showPreview());
  previewButton.setAttribute('aria-pressed', 'false');
  const offPanel = ctx.preview.subscribe(() => {
    if (panel !== null) {
      drawPanel();
    }
  });

  const grip = createEditorGrip(frame, t('persona.page.resize_instructions'));
  block.append(problem, frame, grip.element);
  return {
    element: block,
    controls: [tokens, previewButton],
    setText: (text) => {
      view?.setContent(text);
      countTokens(text);
    },
    setEditable: (value) => view?.setReadOnly(!value),
    dispose: () => {
      offPreview();
      offPanel();
      closePreview();
      view?.dispose();
      view = null;
    },
  };
}
