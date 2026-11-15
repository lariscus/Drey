// i18n: catalog
/**
 * The Crew tab's "New session…" form (req-173, R12): persona, folder, class,
 * permission and an optional first line, asked of the engine through the
 * plugin's `sessionOptions` / `sessionStart`. Plain DOM; the model is the
 * one the service window uses (`shared/new-session-form.ts`). The form
 * keeps its own DOM across the Crew tab's repaints.
 */
import type { NewSessionClass, NewSessionOptionsReply, NewSessionPermission, NewSessionReply } from '../../../../shared/service-window/contract';
import { askOf, draftOf, PERMISSIONS, type NewSessionDraft, type NewSessionOptions } from '../../../../shared/new-session-form';
import { h, textButton, type DeskDeps } from '../board/desk-deps';

export interface NewSessionFormHandle {
  readonly node: HTMLElement;
  /** Loads the options; resolves once the form is drawn (or its error is). */
  readonly ready: Promise<void>;
}

const baseName = (path: string): string => path.split(/[\\/]/).filter((part) => part !== '').pop() ?? path;

function field(label: string, control: HTMLElement): HTMLElement {
  const row = h('label', 'desk-session-row');
  row.append(h('span', 'desk-label', label), control);
  return row;
}

function select(label: string, entries: readonly { value: string; label: string }[], selected: string, change: (value: string) => void): HTMLElement {
  const control = h('select', 'desk-input');
  for (const entry of entries) {
    const option = h('option', undefined, entry.label);
    option.value = entry.value;
    option.selected = entry.value === selected;
    control.append(option);
  }
  control.addEventListener('change', () => change(control.value));
  return field(label, control);
}

/** `onDone(runId)` after a start went through; `onCancel` for Cancel. */
export function mountNewSessionForm(deps: DeskDeps, onDone: (runId: string) => void, onCancel: () => void): NewSessionFormHandle {
  const t = deps.api.i18n.t.bind(deps.api.i18n);
  const node = h('section', 'desk-session-form');
  node.setAttribute('aria-label', t('tickets.team.new_session.title'));
  let draft: NewSessionDraft | null = null;
  let options: NewSessionOptions | null = null;
  let error = '';
  let busy = false;

  const paint = (): void => {
    node.replaceChildren();
    if (options !== null && draft !== null) {
      const current = draft;
      const patch = (change: Partial<NewSessionDraft>): void => {
        draft = { ...current, ...change };
        paint();
      };
      node.append(
        select(t('tickets.team.new_session.persona'), options.personas.map((p) => ({ value: p.id, label: p.title })), current.persona, (persona) => patch({ persona })),
        select(
          t('tickets.team.new_session.folder'),
          [{ value: options.ticketsVault, label: t('tickets.team.new_session.vault', { name: baseName(options.ticketsVault) }) }, ...options.repos.map((r) => ({ value: r.path, label: r.name }))],
          current.folder,
          (folder) => patch({ folder }),
        ),
      );
      const typed = h('input', 'desk-input');
      typed.type = 'text';
      typed.value = current.typedFolder;
      typed.setAttribute('aria-label', t('tickets.team.new_session.typed'));
      typed.addEventListener('input', () => {
        draft = { ...current, typedFolder: typed.value };
        syncStart();
      });
      node.append(field('', typed));
      node.append(
        select(
          t('tickets.team.new_session.class'),
          [{ value: '', label: t('tickets.team.new_session.class_auto') }, ...options.classes.map((c) => ({ value: c, label: c }))],
          current.poolClass,
          (poolClass) => patch({ poolClass: poolClass as NewSessionClass | '' }),
        ),
        select(
          t('tickets.team.new_session.permission'),
          PERMISSIONS.map((value) => ({ value, label: t(`tickets.team.new_session.mode.${value.replace('-', '_')}` as never) })),
          current.permission,
          (permission) => patch({ permission: permission as NewSessionPermission }),
        ),
      );
      const line = h('textarea', 'desk-input');
      line.rows = 3;
      line.value = current.firstLine;
      line.addEventListener('input', () => {
        draft = { ...current, firstLine: line.value };
      });
      node.append(field(t('tickets.team.new_session.first_line'), line));
    }
    if (error !== '') {
      const note = h('div', 'desk-note desk-note-error', error);
      note.setAttribute('role', 'alert');
      node.append(note);
    }
    const actions = h('div', 'desk-detail-actions');
    start.disabled = busy || draft === null || askOf(draft) === null;
    actions.append(textButton(t('tickets.team.new_session.cancel'), 'desk-btn', t('tickets.team.new_session.cancel'), onCancel), start);
    node.append(actions);
  };

  const start = textButton(t('tickets.team.new_session.start'), 'desk-btn desk-btn-primary', t('tickets.team.new_session.start'), () => {
    const ask = draft === null ? null : askOf(draft);
    if (ask === null) {
      return;
    }
    busy = true;
    error = '';
    paint();
    void deps
      .invoke('sessionStart', ask)
      .then((reply) => {
        const result = reply as NewSessionReply;
        busy = false;
        if (result.ok) {
          onDone(result.runId);
        } else {
          error = result.error;
          paint();
        }
      })
      .catch((cause: unknown) => {
        busy = false;
        error = cause instanceof Error ? cause.message : String(cause);
        paint();
      });
  });
  const syncStart = (): void => {
    start.disabled = busy || draft === null || askOf(draft) === null;
  };

  paint();
  const ready = deps
    .invoke('sessionOptions')
    .then((reply) => {
      const result = reply as NewSessionOptionsReply;
      if (result.ok) {
        options = result;
        draft = draftOf(result);
      } else {
        error = result.error;
      }
    })
    .catch((cause: unknown) => {
      error = cause instanceof Error ? cause.message : String(cause);
    })
    .then(paint);
  return { node, ready };
}
