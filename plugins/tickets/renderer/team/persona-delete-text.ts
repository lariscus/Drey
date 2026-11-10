// i18n: catalog
/**
 * What a refused deletion says (req-261): the catalog's line for the engine's
 * code — `persona.delete.error.<code>` — with the pinning columns named; a code
 * this build does not know shows the English text it came with.
 */
import type { PersonaRemoveFailure } from '../../../../packages/tickets-engine/src/contracts/persona-remove';
import type { I18n } from '../../../../shared/i18n/types';

/** A reply that is not the engine's own shape (a transport failure) is a plain text. */
export type DeleteFailure = Pick<PersonaRemoveFailure, 'error' | 'columns' | 'crewDefault'> & { readonly code: string | null };

/** The failure a reply or a thrown error stands for; null when the reply is a success. */
export function failureOf(reply: unknown): DeleteFailure | null {
  const body = typeof reply === 'object' && reply !== null ? (reply as Record<string, unknown>) : null;
  if (body?.['ok'] === true) {
    return null;
  }
  const columns = Array.isArray(body?.['columns']) ? (body['columns'] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : undefined;
  return {
    code: typeof body?.['code'] === 'string' ? body['code'] : null,
    error: typeof body?.['error'] === 'string' ? body['error'] : '',
    ...(columns === undefined ? {} : { columns }),
    ...(body?.['crewDefault'] === true ? { crewDefault: true } : {}),
  };
}

function pinnedKey(failure: DeleteFailure): string {
  const columns = (failure.columns?.length ?? 0) > 0;
  if (columns && failure.crewDefault === true) {
    return 'persona.delete.error.pinned_both';
  }
  return failure.crewDefault === true ? 'persona.delete.error.pinned_default' : 'persona.delete.error.pinned';
}

export function refusalText(i18n: I18n, name: string, failure: DeleteFailure): string {
  const key = failure.code === 'pinned' ? pinnedKey(failure) : `persona.delete.error.${failure.code}`;
  if (failure.code === null || !i18n.has(key)) {
    return failure.error !== '' ? failure.error : i18n.t('persona.delete.error.internal');
  }
  const columns = failure.columns ?? [];
  return i18n.lookup(key, { name, count: columns.length, columns: new Intl.ListFormat(i18n.locale, { style: 'long', type: 'conjunction' }).format(columns) });
}
