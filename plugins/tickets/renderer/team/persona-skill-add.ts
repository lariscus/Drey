// i18n: catalog
/**
 * `Add skill…` (R11, req-237): a button with a two-item menu — a skill file
 * or zip, or a skill folder — over the browser's own file inputs (the
 * renderer's page has no native dialog of its own, and a `webkitdirectory`
 * input is how a folder is picked there). The pick is read into
 * `PickedFile`s and handed on; what to send, and what to refuse before
 * sending, is `skill-upload-model.ts`.
 */
import { h } from '../desk-deps';
import type { Translate } from './persona-dom';
import { outlineButton } from './persona-dom';
import type { PickedFile } from './skill-upload-model';

type WebkitFile = File & { readonly webkitRelativePath?: string };

/** A file's bytes; `arrayBuffer()` where the page has it, a `FileReader` where it does not. */
function bytesOf(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)));
    reader.addEventListener('error', () => reject(reader.error ?? new DOMException('', 'NotReadableError')));
    reader.readAsArrayBuffer(file);
  });
}

export function pickedOf(file: WebkitFile): PickedFile {
  const path = file.webkitRelativePath !== undefined && file.webkitRelativePath !== '' ? file.webkitRelativePath : file.name;
  return { path, size: file.size, bytes: () => bytesOf(file) };
}

export interface SkillAddControl {
  readonly element: HTMLElement;
  /** Greys the button while a call runs. */
  setBusy(busy: boolean): void;
}

export function skillAddControl(t: Translate, onPick: (kind: 'file' | 'folder', files: readonly PickedFile[]) => void): SkillAddControl {
  const wrap = h('span', 'persona-menu-wrap persona-skill-add');
  const menu = h('div', 'persona-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const input = (kind: 'file' | 'folder'): HTMLInputElement => {
    const node = h('input');
    node.type = 'file';
    node.hidden = true;
    node.dataset['pick'] = kind;
    if (kind === 'file') {
      node.accept = '.md,.markdown,.zip';
    } else {
      node.setAttribute('webkitdirectory', '');
    }
    node.addEventListener('change', () => {
      const files = [...(node.files ?? [])].map(pickedOf);
      node.value = '';
      if (files.length > 0) {
        onPick(kind, files);
      }
    });
    return node;
  };
  const fileInput = input('file');
  const folderInput = input('folder');
  const item = (label: string, pick: HTMLInputElement): void => {
    const button = outlineButton(label, 'persona-menu-item', () => {
      menu.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
      pick.click();
    });
    button.setAttribute('role', 'menuitem');
    menu.append(button);
  };
  const opener = outlineButton(t('persona.skills.add'), 'persona-btn persona-btn-28', () => {
    menu.hidden = !menu.hidden;
    opener.setAttribute('aria-expanded', String(!menu.hidden));
  });
  opener.setAttribute('aria-haspopup', 'menu');
  opener.setAttribute('aria-expanded', 'false');
  item(t('persona.skills.add_file'), fileInput);
  item(t('persona.skills.add_folder'), folderInput);
  wrap.append(opener, menu, fileInput, folderInput);
  return { element: wrap, setBusy: (busy) => (opener.disabled = busy) };
}
