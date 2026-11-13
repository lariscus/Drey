// i18n: catalog
/** Small DOM pieces of Settings → Projects (req-284): buttons, the colour dot, the segmented access control. */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { ProjectVaultAccess } from '../../../../packages/tickets-engine/src/contracts/projects';
import { h } from '../desk-deps';

export function iconBtn(api: DreyPluginApi, icon: string, label: string, onClick: () => void, size = 16): HTMLButtonElement {
  const button = h('button', 'prj-ib');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(api.ui.icon(icon, size));
  button.addEventListener('click', onClick);
  return button;
}

export function dot(color: string, className = 'prj-dot'): HTMLElement {
  const node = h('span', className);
  node.setAttribute('aria-hidden', 'true');
  node.style.background = color;
  return node;
}

/** A dashed button with a plus: *Add repository*, *Add folder*. */
export function addButton(api: DreyPluginApi, label: string, onClick: () => void, accent: boolean): HTMLButtonElement {
  const button = h('button', accent ? 'prj-add prj-add-accent' : 'prj-add');
  button.type = 'button';
  button.append(api.ui.icon('plus', 14), document.createTextNode(label));
  button.addEventListener('click', onClick);
  return button;
}

/** A small framed tag: `primary`, `Read`, `not on this device`. */
export function tag(text: string, className = 'prj-tag'): HTMLElement {
  return h('span', className, text);
}

/** None | Read | Write as a radio group (board 7m's segmented control). */
export function accessControl(
  label: string,
  words: Readonly<Record<ProjectVaultAccess, string>>,
  value: ProjectVaultAccess,
  disabled: boolean,
  onPick: (access: ProjectVaultAccess) => void,
): HTMLElement {
  const group = h('div', 'prj-seg');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const access of ['none', 'read', 'write'] as const) {
    const button = h('button', 'prj-seg-btn', words[access]);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(access === value));
    button.disabled = disabled;
    button.addEventListener('click', () => {
      if (access !== value) {
        onPick(access);
      }
    });
    group.append(button);
  }
  return group;
}
