// i18n: catalog
/**
 * Repositories and Folders of a project (req-284, board 7m; req-304): the
 * repository chips (the first `primary`), *Add repository* opening the inline
 * picker (`projects-repo-picker.ts`: a Git URL to clone, `repos.md`'s other
 * entries, *From folder…*); the plain folders, each `Read`, *Add folder*
 * through the system folder picker — a folder that is a git repository is
 * listed as one of the project's repositories instead, with no second choice.
 */
import type { ProjectDraft } from '../../../../packages/tickets-engine/src/contracts/project-commands';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { h } from '../board/desk-deps';
import { addButton, iconBtn, tag } from './projects-dom';
import { repoPicker } from './projects-repo-picker';
import type { ProjectsContext } from './projects-context';

export function repositoriesBlock(ctx: ProjectsContext, project: ProjectRecord): HTMLElement {
  const { api, t } = ctx;
  const block = h('div', 'prj-col');
  block.append(h('h2', 'prj-h2', t('projects.repositories')));
  const chips = h('div', 'prj-chips');
  project.repos.forEach((name, index) => {
    const chip = h('span', 'prj-chip', name);
    if (index === 0) {
      chip.append(tag(t('projects.primary'), 'prj-tag prj-tag-accent'));
    }
    const remove = iconBtn(api, 'x', t('projects.remove_repository', { name }), () => void ctx.save(project.id, { repos: ctx.latest(project.id).repos.filter((r) => r !== name) }), 12);
    remove.classList.add('prj-chip-x');
    chip.append(remove);
    chips.append(chip);
  });
  const add = addButton(api, t('projects.add_repository'), () => picker.toggle(!picker.isOpen), true);
  add.setAttribute('aria-expanded', 'false');
  const picker = repoPicker(ctx, project, (open) => add.setAttribute('aria-expanded', String(open)));
  chips.append(add);
  block.append(chips, picker.element);
  return block;
}

export function foldersBlock(ctx: ProjectsContext, project: ProjectRecord): HTMLElement {
  const { api, t } = ctx;
  const block = h('div', 'prj-col');
  block.append(h('h2', 'prj-h2', t('projects.folders')));
  const write = (patch: Partial<ProjectDraft>): void => void ctx.save(project.id, patch);
  for (const folder of project.folders) {
    const row = h('div', 'prj-folder');
    const icon = h('span', 'prj-muted-icon');
    icon.append(api.ui.icon('folder', 14));
    row.append(icon, h('span', 'prj-folder-path', folder), tag(t('projects.read')));
    row.append(iconBtn(api, 'x', t('projects.remove_folder'), () => write({ folders: ctx.latest(project.id).folders.filter((f) => f !== folder) }), 14));
    block.append(row);
  }
  const wrap = h('div');
  wrap.append(
    addButton(api, t('projects.add_folder'), () => {
      void ctx.pickFolder(t('projects.pick_folder')).then((path) => (path === null ? undefined : ctx.addFolder(project.id, path, false)));
    }, false),
  );
  block.append(wrap);
  return block;
}
