// i18n: catalog
/**
 * Repositories and Folders of a project (req-284, board 7m): the repository
 * chips (the first `primary`), *Add repository* opening the inline picker of
 * `repos.md`'s other entries plus *From folder…*; the plain folders, each
 * `Read`, *Add folder* through the folder picker.
 */
import type { RepoCandidate, RepoRef } from '../../shared/tickets';
import type { ProjectDraft } from '../../../../packages/tickets-engine/src/contracts/project-commands';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { h } from '../desk-deps';
import { addButton, iconBtn, tag } from './projects-dom';
import { repoChoices } from './projects-model';
import type { ProjectsContext } from './projects-context';

const FROM_FOLDER = '\u0000from-folder';

/** A picked folder's repositories as `repos.md` entries (a checkout without a remote names itself by its path). */
function refOf(candidate: RepoCandidate): RepoRef {
  return { name: candidate.name, url: candidate.url ?? candidate.path, branch: candidate.branch, policy: null, path: candidate.path, worker: null, worktrees: null, launch: null, instructions: null };
}

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
  const picker = h('div', 'prj-picker');
  picker.hidden = true;
  const add = addButton(api, t('projects.add_repository'), () => toggle(picker.hidden === true), true);
  add.setAttribute('aria-expanded', 'false');
  chips.append(add);

  const select = h('select', 'prj-picker-list');
  select.id = `prj-repo-${project.id}`;
  select.size = 4;
  const label = h('label', 'prj-sr', t('projects.repository'));
  label.htmlFor = select.id;
  let candidates: readonly RepoCandidate[] = [];
  const fill = (): void => {
    select.replaceChildren();
    const names = candidates.length > 0 ? candidates.map((c) => c.name) : repoChoices(ctx.repoNames(), project.repos);
    for (const name of names) {
      select.append(new Option(name, name));
    }
    if (candidates.length === 0) {
      select.append(new Option(t('projects.from_folder'), FROM_FOLDER));
    }
    select.selectedIndex = 0;
  };
  const toggle = (open: boolean): void => {
    candidates = [];
    picker.hidden = !open;
    add.setAttribute('aria-expanded', String(open));
    if (open) {
      fill();
      select.focus();
    }
  };
  const confirm = async (): Promise<void> => {
    const value = select.value;
    if (value === FROM_FOLDER) {
      const found = await ctx.scanFolder();
      if (found.length === 1) {
        await ctx.addRepo(project.id, refOf(found[0]!));
        toggle(false);
      } else if (found.length > 1) {
        candidates = found;
        fill();
      }
      return;
    }
    const candidate = candidates.find((c) => c.name === value);
    if (candidate !== undefined) {
      await ctx.addRepo(project.id, refOf(candidate));
    } else if (value !== '') {
      await ctx.save(project.id, { repos: [...ctx.latest(project.id).repos, value] });
    }
    toggle(false);
  };
  select.addEventListener('dblclick', () => void confirm());
  select.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirm();
    } else if (event.key === 'Escape') {
      toggle(false);
    }
  });
  const actions = h('div', 'prj-picker-actions');
  actions.append(iconBtn(api, 'check', t('projects.add_repository'), () => void confirm()), iconBtn(api, 'x', t('projects.cancel'), () => toggle(false)));
  picker.append(label, select, actions);
  block.append(chips, picker);
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
      void ctx.pickFolder().then((path) => {
        if (path !== null && !ctx.latest(project.id).folders.includes(path)) {
          write({ folders: [...ctx.latest(project.id).folders, path] });
        }
      });
    }, false),
  );
  block.append(wrap);
  return block;
}
