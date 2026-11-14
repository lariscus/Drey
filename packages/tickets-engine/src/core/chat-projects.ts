/**
 * req-298: the board's projects in a Mission Control turn. Pia names the
 * project of every ticket she proposes: the turn's system message lists the
 * board's projects and the project filter the owner's client stands on, and
 * a `createTicket` card that names no known project takes the filter's (or
 * the board's only one). Pure — the chat service hands in the snapshot's
 * records and the filter the client sent.
 */
import type { ChatCommand } from '../contracts/chat';
import type { ProjectRecord } from '../contracts/projects';

type Project = Pick<ProjectRecord, 'id' | 'name'>;

/** The filter's project when the board knows it; null = all projects (or an id the board does not have). */
function knownFilter(projects: readonly Project[], filter: string | null | undefined): Project | null {
  return projects.find((project) => project.id === filter) ?? null;
}

/**
 * The `## Projects` block below the board digest: the projects by id and
 * name, then what a new ticket's project is — the board's only one, the
 * filter's, or a question to the owner when the filter is all projects.
 * '' on a board without project records.
 */
export function projectsBlockOf(projects: readonly Project[], filter: string | null | undefined): string {
  if (projects.length === 0) {
    return '';
  }
  const list = projects.map((project) => `${project.id} "${project.name}"`).join(' · ');
  const chosen = knownFilter(projects, filter);
  const rule =
    projects.length === 1
      ? `The board has one project: every new ticket goes to "${projects[0]!.id}".`
      : chosen !== null
        ? `The owner's project filter is ${chosen.name}: a new ticket goes to "${chosen.id}" unless the owner names another project.`
        : "The owner's project filter is all projects: unless the owner named the project, ask which project the new ticket belongs to before you propose it.";
  return `## Projects\n\n${list}\n${rule}`;
}

/** The digest with the projects block after it (nothing added without projects). */
export function withProjectsBlock(digest: string, projects: readonly Project[], filter: string | null | undefined): string {
  const block = projectsBlockOf(projects, filter);
  return block === '' ? digest : `${digest}\n\n${block}`;
}

/**
 * A proposed command with its project settled: a `createTicket` keeps a
 * project the board knows, else takes the filter's project, else the board's
 * only one, else none. Every other command passes unchanged.
 */
export function withCommandProject(command: ChatCommand, projects: readonly Project[], filter: string | null | undefined): ChatCommand {
  if (command.kind !== 'createTicket') {
    return command;
  }
  const { project: named, ...rest } = command;
  const known = projects.find((project) => project.id === named) ?? knownFilter(projects, filter) ?? (projects.length === 1 ? projects[0]! : null);
  return known === null ? rest : { ...rest, project: known.id };
}
