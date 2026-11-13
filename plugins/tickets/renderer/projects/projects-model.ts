/**
 * Settings → Projects (req-284, board 7m) as data: the six colour presets,
 * each project's ticket count, the vault rows (this device's registered
 * vaults, then the vaults a record names that this device lacks), the
 * repositories the inline picker offers and the draft a change writes.
 * Pure — the DOM is `projects-page.ts`.
 */
import type { ProjectDraft } from '../../../../packages/tickets-engine/src/contracts/project-commands';
import { ticketProjectId, type ProjectRecord, type ProjectVaultAccess } from '../../../../packages/tickets-engine/src/contracts/projects';

/** The board's six presets, in its order; the label is a catalog key. */
export const PROJECT_COLOR_PRESETS = [
  { hex: '#8ecbef', label: 'projects.color.blue' },
  { hex: '#f2cfae', label: 'projects.color.orange' },
  { hex: '#bfe3cd', label: 'projects.color.green' },
  { hex: '#f2d3e2', label: 'projects.color.pink' },
  { hex: '#d9cff5', label: 'projects.color.violet' },
  { hex: '#e8a25a', label: 'projects.color.amber' },
] as const;

/** A project without a colour of its own is drawn in the first preset. */
export const DEFAULT_PROJECT_COLOR = PROJECT_COLOR_PRESETS[0].hex;

export function colorOf(project: Pick<ProjectRecord, 'color'>): string {
  return project.color === '' ? DEFAULT_PROJECT_COLOR : project.color;
}

/** The preset a colour is, or null for a custom one. */
export function presetOf(color: string): (typeof PROJECT_COLOR_PRESETS)[number] | null {
  return PROJECT_COLOR_PRESETS.find((p) => p.hex === color.toLowerCase()) ?? null;
}

/** The ticket ids per project of the board's open tickets (a ticket without `project:` counts for the only project). */
export function ticketCounts(tickets: readonly { readonly meta: { readonly project?: string } }[], projects: readonly Pick<ProjectRecord, 'id'>[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    const id = ticketProjectId(ticket.meta.project, projects);
    if (id !== null) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** One row of the Vaults block. */
export interface VaultRow {
  readonly name: string;
  readonly access: ProjectVaultAccess;
  /** The record names it, this device has not registered it: greyed, not editable here. */
  readonly notOnDevice: boolean;
}

/** This device's vaults by registry order, then the record's other names in its order. */
export function vaultRowsOf(project: Pick<ProjectRecord, 'vaults'>, registered: readonly string[]): readonly VaultRow[] {
  const rows: VaultRow[] = registered.map((name) => ({ name, access: project.vaults[name] ?? 'none', notOnDevice: false }));
  for (const [name, access] of Object.entries(project.vaults)) {
    if (!registered.includes(name)) {
      rows.push({ name, access, notOnDevice: true });
    }
  }
  return rows;
}

/** The repositories of `repos.md` the project does not list yet — the inline picker's rows above *From folder…*. */
export function repoChoices(registered: readonly string[], listed: readonly string[]): readonly string[] {
  return registered.filter((name) => !listed.includes(name));
}

/** The record as a draft (the id stays the file stem). */
export function draftOf(project: ProjectRecord): ProjectDraft {
  const { id: _id, ...draft } = project;
  return draft;
}

/** The vaults with one access set; `none` is written as the explicit "never" only for a vault the record already named. */
export function withVaultAccess(vaults: Readonly<Record<string, ProjectVaultAccess>>, name: string, access: ProjectVaultAccess): Record<string, ProjectVaultAccess> {
  if (access === 'none' && !(name in vaults)) {
    return { ...vaults };
  }
  return { ...vaults, [name]: access };
}

/** The name a new project starts with: `New project`, `New project 2`, … */
export function newProjectName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) {
    return base;
  }
  let n = 2;
  while (used.has(`${base} ${n}`.toLowerCase())) {
    n += 1;
  }
  return `${base} ${n}`;
}

/** The next preset no project uses yet (the first again when all are taken). */
export function freshColor(projects: readonly Pick<ProjectRecord, 'color'>[]): string {
  const used = new Set(projects.map((p) => colorOf(p)));
  return PROJECT_COLOR_PRESETS.find((p) => !used.has(p.hex))?.hex ?? DEFAULT_PROJECT_COLOR;
}

/** The last folder name of a path, for a folder row or a Files section. */
export function folderLabel(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
