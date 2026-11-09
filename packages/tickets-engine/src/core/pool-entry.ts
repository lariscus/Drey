import { isWorkerProvider } from '../fleet/protocol';

/**
 * A pool entry is `<model>` or `<provider>/<model>` with one of the fleet's
 * worker providers (the worker value grammar of `fleet/assignment.ts`); a
 * slash after anything else is part of the model id (`zai/glm-5.3`). Its own
 * file, free of the YAML parser, so the Persona page's renderer bundle can
 * read it (ADR-0044 rule 1); `core/persona.ts` re-exports it.
 */
export function splitPoolEntry(entry: string): { readonly provider: string | null; readonly model: string } {
  const text = entry.trim();
  const slashAt = text.indexOf('/');
  if (slashAt > 0 && isWorkerProvider(text.slice(0, slashAt)) && text.slice(slashAt + 1) !== '') {
    return { provider: text.slice(0, slashAt), model: text.slice(slashAt + 1) };
  }
  return { provider: null, model: text };
}
