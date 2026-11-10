import type { PersonaRemoveCommand } from '../contracts/persona-remove';
import type { Parsed } from '../core/commands';

/**
 * The persona removal's request body (req-261): shape only — the persona id is
 * pinned by the path, and whether the typed text is the title is the service's
 * judgment (it answers with a code), never the router's.
 */
export function parsePersonaRemove(persona: string, body: unknown): Parsed<PersonaRemoveCommand> {
  const confirm = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)['confirm'] : undefined;
  return typeof confirm === 'string' ? { ok: true, value: { persona, confirm } } : { ok: false, error: 'a removal needs confirm: the persona\'s title, typed' };
}
