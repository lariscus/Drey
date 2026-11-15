/**
 * The checks and the id of a project write (req-284): what Settings →
 * Projects may save, normalised, and the file stem of a new record. Pure —
 * the IO is `services/project-service.ts`.
 */
import type { ProjectDraft } from '../../contracts/project-commands';
import { PROJECT_ID_PATTERN, PROJECT_VAULT_ACCESS, type ProjectRecord, type ProjectVaultAccess } from '../../contracts/projects';
import { projectIdOf } from './project-record';

/** A draft cleaned for writing, or the reason it cannot be written. */
export type DraftCheck = { readonly ok: true; readonly draft: ProjectDraft } | { readonly ok: false; readonly error: string };

const uniqueTrimmed = (values: readonly unknown[]): string[] => [
  ...new Set(values.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter((v) => v !== '')),
];

function vaultsOf(raw: Readonly<Record<string, unknown>>): Record<string, ProjectVaultAccess> | string {
  const vaults: Record<string, ProjectVaultAccess> = {};
  for (const [name, access] of Object.entries(raw)) {
    const key = name.trim();
    if (key === '') {
      continue;
    }
    if (typeof access !== 'string' || !(PROJECT_VAULT_ACCESS as readonly string[]).includes(access)) {
      return `vault "${key}" must be none, read or write`;
    }
    vaults[key] = access as ProjectVaultAccess;
  }
  return vaults;
}

/** The draft as it may be written: a name, a `#rrggbb` colour or none, lists without blanks or duplicates. */
export function checkDraft(draft: ProjectDraft): DraftCheck {
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (name === '') {
    return { ok: false, error: 'a project needs a name' };
  }
  const color = typeof draft.color === 'string' ? draft.color.trim().toLowerCase() : '';
  if (color !== '' && !/^#[0-9a-f]{6}$/.test(color)) {
    return { ok: false, error: 'the colour must be #rrggbb' };
  }
  const vaults = vaultsOf(typeof draft.vaults === 'object' && draft.vaults !== null ? draft.vaults : {});
  if (typeof vaults === 'string') {
    return { ok: false, error: vaults };
  }
  return {
    ok: true,
    draft: {
      name,
      color,
      repos: uniqueTrimmed(Array.isArray(draft.repos) ? draft.repos : []),
      folders: uniqueTrimmed(Array.isArray(draft.folders) ? draft.folders : []),
      vaults,
      purpose: typeof draft.purpose === 'string' ? draft.purpose.trim() : '',
    },
  };
}

/** A new record's file stem: the name's id, `-2`, `-3`… when taken; `project` when the name leaves nothing. */
export function mintProjectId(name: string, taken: readonly string[]): string {
  const base = projectIdOf(name) || 'project';
  const used = new Set(taken);
  if (!used.has(base)) {
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}

/** True for a string that can be a record's file stem. */
export function isProjectId(id: unknown): id is string {
  return typeof id === 'string' && PROJECT_ID_PATTERN.test(id);
}

/** The record a checked draft writes. */
export function recordOf(id: string, draft: ProjectDraft): ProjectRecord {
  return { id, ...draft };
}
