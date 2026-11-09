/** The New session form's folder list (req-173); the rest of the model is shared with the Crew tab. */
import type { I18n } from '../../../../../shared/i18n';
import type { NewSessionOptions } from '../../../../../shared/new-session-form';

export interface FolderChoice {
  readonly value: string;
  readonly label: string;
}

const baseName = (path: string): string => path.split(/[\\/]/).filter((part) => part !== '').pop() ?? path;

/** The tickets repository first — it is an allowed directory — then the work repositories. */
export function folderChoices(i18n: I18n, options: NewSessionOptions): readonly FolderChoice[] {
  return [
    { value: options.ticketsVault, label: i18n.t('service_window.new_session.vault', { name: baseName(options.ticketsVault) }) },
    ...options.repos.map((repo) => ({ value: repo.path, label: repo.name })),
  ];
}
