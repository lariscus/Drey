import type { SkillRemoveCommand, SkillToggleCommand, SkillUploadCommand } from '../contracts/skills';
import type { Parsed } from '../core/ticket/commands';

/**
 * The skill routes' request bodies (req-172): shape only — the persona id is
 * pinned by the path, names and archives are judged by the service, which
 * answers with a code. A body that is not the shape is a plain refusal.
 */

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseSkillToggle(persona: string, body: unknown): Parsed<SkillToggleCommand> {
  const obj = asObject(body);
  const skill = text(obj?.['skill']);
  const on = obj?.['on'];
  return skill === undefined || typeof on !== 'boolean' ? { ok: false, error: 'a toggle needs skill (a name) and on (true or false)' } : { ok: true, value: { persona, skill, on } };
}

export function parseSkillRemove(persona: string, body: unknown): Parsed<SkillRemoveCommand> {
  const name = text(asObject(body)?.['name']);
  return name === undefined ? { ok: false, error: 'a removal needs the name of the skill' } : { ok: true, value: { persona, name } };
}

export function parseSkillUpload(body: unknown): Parsed<SkillUploadCommand> {
  const obj = asObject(body);
  const scope = obj?.['scope'];
  const format = obj?.['format'];
  if (obj === null || (scope !== 'shared' && scope !== 'own') || (format !== 'markdown' && format !== 'zip')) {
    return { ok: false, error: 'an upload needs scope (shared or own) and format (markdown or zip)' };
  }
  const overwrite = obj['overwrite'];
  if (overwrite !== undefined && typeof overwrite !== 'boolean') {
    return { ok: false, error: 'overwrite is true or false' };
  }
  const fields = { persona: text(obj['persona']), name: text(obj['name']), text: text(obj['text']), zipBase64: text(obj['zipBase64']) };
  const given = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  return { ok: true, value: { scope, format, ...given, ...(overwrite === undefined ? {} : { overwrite }) } };
}
