// i18n: catalog
/**
 * Settings → Skills library, the top (board 7o): the title with *Upload
 * skill…* (the zip / file / folder pick of milestone 232, into the shared
 * pool) and *Add from GitHub*, which opens the row below it — Repository,
 * Path, Ref, Fetch and Cancel — and the one line under it for a refusal or
 * what a fetch skipped.
 */
import { el } from '../settings-dom';
import { pickedOf } from '../team/persona-skill-add';
import { labelled, onEnterEscape, textButton, textField } from './models-dom';
import { glyphTextButton, menuOf } from './skills-library-dom';
import { fetchCommand } from './skills-library-model';
import type { SkillsLibraryState } from './skills-library-state';

export interface HeadPart {
  readonly element: HTMLElement;
  paint(): void;
}

function pickInput(kind: 'file' | 'folder', onPick: (kind: 'file' | 'folder', files: readonly File[]) => void): HTMLInputElement {
  const input = el('input');
  input.type = 'file';
  input.hidden = true;
  input.dataset['pick'] = kind;
  if (kind === 'file') {
    input.accept = '.md,.markdown,.zip';
  } else {
    input.setAttribute('webkitdirectory', '');
  }
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) {
      onPick(kind, files);
    }
  });
  return input;
}

export function createHeadPart(state: SkillsLibraryState): HeadPart {
  const { t } = state;
  const title = el('h3', 'mdl-title', t('tickets.settings.skills.title'));
  title.id = 'tset-skills-head';
  const onPick = (kind: 'file' | 'folder', files: readonly File[]): void => void state.upload(kind, files.map(pickedOf));
  const fileInput = pickInput('file', onPick);
  const folderInput = pickInput('folder', onPick);
  const upload = glyphTextButton('upload', t('tickets.settings.skills.upload'), 'dashed');
  const uploadMenu = menuOf(upload, [
    { label: t('persona.skills.add_file'), run: () => fileInput.click() },
    { label: t('persona.skills.add_folder'), run: () => folderInput.click() },
  ]);
  const add = glyphTextButton('branch', t('tickets.settings.skills.add_github'), '');
  const titleRow = el('div', 'mdl-titlerow skl-titlerow');
  titleRow.dataset['settingsSection'] = 'skills';
  titleRow.append(title, el('span', 'mdl-grow'), uploadMenu, fileInput, folderInput, add);

  const repo = textField('', t('tickets.settings.skills.field.repo'), 'mdl-fld skl-mono skl-fld-repo');
  const path = textField('', t('tickets.settings.skills.field.path'), 'mdl-fld skl-mono skl-fld-path');
  const ref = textField('main', t('tickets.settings.skills.field.ref'), 'mdl-fld skl-mono skl-fld-ref');
  const fetch = textButton(t('tickets.settings.skills.fetch'), 'primary', false);
  const cancel = textButton(t('tickets.settings.skills.cancel'), '', false);
  const box = el('div', 'skl-addbox');
  box.append(labelled(t('tickets.settings.skills.field.repo'), repo), labelled(t('tickets.settings.skills.field.path'), path), labelled(t('tickets.settings.skills.field.ref'), ref), el('span', 'mdl-grow'), fetch, cancel);
  const note = el('div', 'tset-error skl-note');
  note.setAttribute('role', 'alert');

  const close = (): void => {
    state.adding = false;
    repo.value = '';
    path.value = '';
    ref.value = 'main';
    state.changed();
  };
  const submit = async (): Promise<void> => {
    const command = fetchCommand(repo.value, path.value, ref.value);
    if (command !== null && (await state.fetchSource(command))) {
      close();
    }
  };
  add.addEventListener('click', () => {
    state.adding = !state.adding;
    state.changed();
    if (state.adding) {
      repo.focus();
    }
  });
  fetch.addEventListener('click', () => void submit());
  cancel.addEventListener('click', close);
  for (const field of [repo, path, ref]) {
    onEnterEscape(field, () => void submit(), close);
    field.addEventListener('input', () => (fetch.disabled = state.busy || fetchCommand(repo.value, path.value, ref.value) === null));
  }

  const element = el('div');
  element.append(titleRow, box, note);
  return {
    element,
    paint: () => {
      box.hidden = !state.adding;
      add.setAttribute('aria-expanded', String(state.adding));
      upload.disabled = state.busy;
      fetch.disabled = state.busy || fetchCommand(repo.value, path.value, ref.value) === null;
      fetch.textContent = state.busy && state.adding ? t('tickets.settings.skills.fetching') : t('tickets.settings.skills.fetch');
      note.textContent = state.note;
      note.hidden = state.note === '';
    },
  };
}
