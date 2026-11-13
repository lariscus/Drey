/**
 * `tickets/_meta/projects/<id>.md` (req-282, `specs/ticket-schema.md`): one
 * project per file — frontmatter `name`, `color`, `repos`, `folders` and
 * `vaults`, the body the purpose. Read tolerantly like the other `_meta`
 * files (what parses reads, the rest is a warning on the board) and written
 * canonically, so a round trip is byte-stable.
 */
import { parseDocument, stringify } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { PROJECT_ID_PATTERN, PROJECT_VAULT_ACCESS, PROJECTS_DIR, type ProjectRecord, type ProjectVaultAccess } from '../contracts/projects';

export interface ProjectParse {
  readonly project: ProjectRecord;
  /** Tolerated deviations, one message each (the board shows them as warnings). */
  readonly warnings: readonly string[];
}

export interface ProjectsParse {
  /** The readable records, by id. */
  readonly projects: readonly ProjectRecord[];
  readonly warnings: readonly string[];
}

type Entry = Record<string, unknown>;

const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** A list of non-empty strings, duplicates dropped; a single string reads as a one-entry list. */
function listOf(value: unknown): string[] {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return [...new Set(raw.map(textOf).filter((s): s is string => s !== null))];
}

/** `vaults:` — registered name -> access; an unknown access is a warning and reads as `none`. */
function vaultsOf(id: string, value: unknown, warnings: string[]): Record<string, ProjectVaultAccess> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(`project "${id}": vaults must be a mapping of vault name -> none | read | write`);
    return {};
  }
  const vaults: Record<string, ProjectVaultAccess> = {};
  for (const [name, raw] of Object.entries(value as Entry)) {
    const access = textOf(raw);
    if (access !== null && (PROJECT_VAULT_ACCESS as readonly string[]).includes(access)) {
      vaults[name.trim()] = access as ProjectVaultAccess;
    } else {
      warnings.push(`project "${id}": vault "${name}" must be none, read or write — read as none`);
      vaults[name.trim()] = 'none';
    }
  }
  return vaults;
}

/** The frontmatter mapping, or the warning the file reads as an empty record with. */
function frontmatterOf(id: string, text: string): { root: Entry; body: string; warning: string | null } {
  const { yamlText, body, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    return { root: {}, body: text, warning: `project "${id}" has no frontmatter fence` };
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return { root: {}, body, warning: `project "${id}" does not parse: ${doc.errors[0]!.message}` };
  }
  const parsed = doc.toJS() as unknown;
  return { root: parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Entry) : {}, body, warning: null };
}

/** One project file. The id is the file stem; a missing name reads as the id. */
export function parseProjectFile(id: string, text: string): ProjectParse {
  const warnings: string[] = [];
  const { root, body, warning } = frontmatterOf(id, text);
  if (warning !== null) {
    warnings.push(warning);
  }
  const color = textOf(root['color']) ?? '';
  if (color !== '' && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    warnings.push(`project "${id}": color must be #rrggbb`);
  }
  return {
    project: {
      id,
      name: textOf(root['name']) ?? id,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '',
      repos: listOf(root['repos']),
      folders: listOf(root['folders']),
      vaults: vaultsOf(id, root['vaults'], warnings),
      purpose: body.trim(),
    },
    warnings,
  };
}

/** The project id of a vault-relative path (`tickets/_meta/projects/<id>.md`), or null for anything else. */
export function projectIdOfPath(relPath: string): string | null {
  const prefix = `${PROJECTS_DIR}/`;
  if (!relPath.startsWith(prefix) || !relPath.endsWith('.md')) {
    return null;
  }
  const stem = relPath.slice(prefix.length, -'.md'.length);
  return PROJECT_ID_PATTERN.test(stem) ? stem : null;
}

/** Every project file of a listing (other paths are skipped), sorted by id; a stray name under the folder is a warning. */
export function parseProjects(files: readonly { readonly path: string; readonly text: string }[]): ProjectsParse {
  const projects: ProjectRecord[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    if (!file.path.startsWith(`${PROJECTS_DIR}/`)) {
      continue;
    }
    const id = projectIdOfPath(file.path);
    if (id === null) {
      warnings.push(`unexpected file in ${PROJECTS_DIR}: ${file.path} (a project file is <id>.md, lowercase letters, digits and dashes)`);
      continue;
    }
    const parsed = parseProjectFile(id, file.text);
    projects.push(parsed.project);
    warnings.push(...parsed.warnings);
  }
  projects.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { projects, warnings };
}

/** The canonical file text: the keys in schema order, the empty ones left out, the purpose as the body. */
export function projectFileText(project: ProjectRecord): string {
  const header: Entry = { name: project.name };
  if (project.color !== '') {
    header['color'] = project.color;
  }
  header['repos'] = [...project.repos];
  if (project.folders.length > 0) {
    header['folders'] = [...project.folders];
  }
  if (Object.keys(project.vaults).length > 0) {
    header['vaults'] = { ...project.vaults };
  }
  const yaml = stringify(header, { lineWidth: 0 });
  const purpose = project.purpose.trim();
  return `---\n${yaml}---\n${purpose === '' ? '' : `${purpose}\n`}`;
}

/** A project id from a name: lowercase, runs of anything else as one dash; '' when nothing is left. */
export function projectIdOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
