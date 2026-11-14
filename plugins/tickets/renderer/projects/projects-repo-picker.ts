// i18n: catalog
/**
 * The inline picker under *Add repository* (req-284, board 7m; req-304): a Git
 * URL field — Drey asks where to clone it, clones with the installed git and
 * lists the checkout — above the list of `repos.md`'s other entries and
 * *From folder…*, which opens the system folder picker and recognises a git
 * repository in the folder it returns.
 */
import { h } from '../desk-deps';
import { checkGitUrl } from '../../shared/git-url';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { iconBtn } from './projects-dom';
import { repoChoices } from './projects-model';
import type { FolderOutcome, ProjectsContext } from './projects-context';

const FROM_FOLDER = '\u0000from-folder';

export interface RepoPicker {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  toggle(open: boolean): void;
}

export function repoPicker(ctx: ProjectsContext, project: ProjectRecord, onToggle: (open: boolean) => void): RepoPicker {
  const { api, t } = ctx;
  const element = h('div', 'prj-picker');
  element.hidden = true;
  const body = h('div', 'prj-picker-body');

  const urlLabel = h('label', 'prj-picker-label', t('projects.git_url'));
  const url = h('input', 'prj-url');
  url.type = 'text';
  url.id = `prj-url-${project.id}`;
  url.spellcheck = false;
  url.autocomplete = 'off';
  urlLabel.htmlFor = url.id;

  const select = h('select', 'prj-picker-list');
  select.id = `prj-repo-${project.id}`;
  select.size = 4;
  const listLabel = h('label', 'prj-sr', t('projects.repository'));
  listLabel.htmlFor = select.id;

  const error = h('p', 'prj-picker-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const progress = h('p', 'prj-picker-progress');
  progress.setAttribute('role', 'status');
  progress.hidden = true;

  let open = false;
  let working = false;
  const showError = (message: string): void => {
    error.textContent = message;
    error.hidden = message === '';
  };
  const setWorking = (on: boolean, text = ''): void => {
    working = on;
    url.disabled = on;
    select.disabled = on;
    progress.hidden = !on;
    progress.textContent = text;
    confirmBtn.disabled = on;
    cancelBtn.title = on ? t('projects.cancel_clone') : t('projects.cancel');
    cancelBtn.setAttribute('aria-label', cancelBtn.title);
  };
  const fill = (): void => {
    select.replaceChildren();
    for (const name of repoChoices(ctx.repoNames(), project.repos)) {
      select.append(new Option(name, name));
    }
    select.append(new Option(t('projects.from_folder'), FROM_FOLDER));
    select.selectedIndex = 0;
  };
  const toggle = (next: boolean): void => {
    open = next;
    element.hidden = !next;
    onToggle(next);
    showError('');
    if (next) {
      url.value = '';
      fill();
      url.focus();
    }
  };
  const finish = (outcome: FolderOutcome): void => {
    if (outcome.ok) {
      toggle(false);
    } else if (outcome.cancelled !== true) {
      showError(outcome.message);
    }
  };

  const clone = async (text: string): Promise<void> => {
    const checked = checkGitUrl(text);
    if (!checked.ok) {
      showError(checked.problem === 'credentials' ? t('projects.clone_error.credentials') : t('projects.clone_error.bad_url'));
      return;
    }
    const parent = await ctx.pickFolder(t('projects.clone_into', { name: checked.name }));
    if (parent === null) {
      return;
    }
    showError('');
    setWorking(true, t('projects.cloning', { name: checked.name }));
    const outcome = await ctx.cloneRepo(project.id, checked.url, parent, (p) => {
      progress.textContent = t('projects.cloning_progress', { name: checked.name, phase: p.phase, percent: p.percent });
    });
    setWorking(false);
    finish(outcome);
  };

  const fromFolder = async (): Promise<void> => {
    const folder = await ctx.pickFolder(t('projects.pick_repository'));
    if (folder !== null) {
      showError('');
      finish(await ctx.addFolder(project.id, folder, true));
    }
  };

  const confirm = async (): Promise<void> => {
    if (working) {
      return;
    }
    const text = url.value.trim();
    if (text !== '') {
      await clone(text);
    } else if (select.value === FROM_FOLDER) {
      await fromFolder();
    } else if (select.value !== '') {
      await ctx.save(project.id, { repos: [...ctx.latest(project.id).repos, select.value] });
      toggle(false);
    }
  };
  const cancel = (): void => {
    if (working) {
      ctx.cancelClone();
    } else {
      toggle(false);
    }
  };

  const keys = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirm();
    } else if (event.key === 'Escape') {
      cancel();
    }
  };
  url.addEventListener('keydown', keys);
  select.addEventListener('keydown', keys);
  select.addEventListener('dblclick', () => void confirm());
  url.addEventListener('input', () => showError(''));

  const actions = h('div', 'prj-picker-actions');
  const confirmBtn = iconBtn(api, 'check', t('projects.add_repository'), () => void confirm());
  const cancelBtn = iconBtn(api, 'x', t('projects.cancel'), cancel);
  actions.append(confirmBtn, cancelBtn);
  body.append(urlLabel, url, listLabel, select, error, progress);
  element.append(body, actions);
  return {
    element,
    get isOpen() {
      return open;
    },
    toggle,
  };
}
