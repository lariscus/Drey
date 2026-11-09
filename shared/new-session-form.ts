/**
 * The New session form's model (req-173), one for the service window and the
 * Crew tab: what it offers, its defaults, and the ask it makes. Pure.
 */
import type {
  NewSessionAsk,
  NewSessionClass,
  NewSessionOptionsReply,
  NewSessionPermission,
} from './service-window/contract';

export type NewSessionOptions = Extract<NewSessionOptionsReply, { readonly ok: true }>;

/** What the owner has entered. An empty `poolClass` is Auto. */
export interface NewSessionDraft {
  readonly persona: string;
  /** The folder picked from the list (an absolute path). */
  readonly folder: string;
  /** A folder typed or browsed; when not blank it wins over the list. */
  readonly typedFolder: string;
  readonly poolClass: NewSessionClass | '';
  readonly permission: NewSessionPermission;
  readonly firstLine: string;
}

export const PERMISSIONS: readonly NewSessionPermission[] = ['read-only', 'accept-edits', 'bypass'];

export function draftOf(options: NewSessionOptions): NewSessionDraft {
  return {
    persona: options.defaultPersona ?? options.personas[0]?.id ?? '',
    folder: options.ticketsVault,
    typedFolder: '',
    poolClass: '',
    permission: options.permissionMode,
    firstLine: '',
  };
}

/** The folder the ask will name: the typed one when there is one, else the list's. */
export function directoryOf(draft: NewSessionDraft): string {
  const typed = draft.typedFolder.trim();
  return typed === '' ? draft.folder : typed;
}

/** The ask the form makes; null while a persona or a folder is missing. */
export function askOf(draft: NewSessionDraft): NewSessionAsk | null {
  const directory = directoryOf(draft);
  if (draft.persona === '' || directory === '') {
    return null;
  }
  const line = draft.firstLine.trim();
  return {
    persona: draft.persona,
    directory,
    poolClass: draft.poolClass === '' ? null : draft.poolClass,
    permissionMode: draft.permission,
    ...(line === '' ? {} : { firstLine: line }),
  };
}
