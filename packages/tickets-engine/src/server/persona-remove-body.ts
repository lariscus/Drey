import type { PersonaPictureSet } from '../contracts/persona-picture';
import type { PersonaRemoveCommand } from '../contracts/persona-remove';
import type { Parsed } from '../core/commands';

/**
 * The persona removal's request body (req-261): shape only — the persona id is
 * pinned by the path, and whether the typed text is the title is the service's
 * judgment (it answers with a code), never the router's.
 */
/** req-288: an upload's body — `{ dataUrl }`, the picture as a PNG data URL (the service checks the bytes). */
export function parsePersonaPicture(persona: string, body: unknown): Parsed<PersonaPictureSet> {
  const dataUrl = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)['dataUrl'] : undefined;
  return typeof dataUrl === 'string' ? { ok: true, value: { persona, dataUrl } } : { ok: false, error: 'an upload needs dataUrl: the picture as a data:image/png;base64 URL' };
}

export function parsePersonaRemove(persona: string, body: unknown): Parsed<PersonaRemoveCommand> {
  const confirm = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)['confirm'] : undefined;
  return typeof confirm === 'string' ? { ok: true, value: { persona, confirm } } : { ok: false, error: 'a removal needs confirm: the persona\'s title, typed' };
}
