// i18n: catalog
/**
 * The Profile block (R11; board 7k v3, req-288): the picture with its camera
 * button — *Upload picture…* and, when there is one, *Remove picture* (D-67,
 * req-235's desktop half) — the name, the role, the one line for the crew
 * list. A picture change goes to the engine at once (one commit), not with
 * the page's Save; the persona list's next `avatarVersion` redraws the circles.
 */
import { h } from '../board/desk-deps';
import type { BlockContext } from './persona-block-context';
import { avatarNode, blockHead, labelled, outlineButton, selectOf, textInput } from './persona-dom';
import { ROLE_OPTIONS } from './persona-model';
import { squarePngOf } from './persona-picture-upload';
import { personaPictures } from './persona-pictures';
import { roleLabel } from './team-model';

/** The one line stays one line: the record holds at most this many characters (the engine refuses more). */
export const SUMMARY_MAX = 200;

/** The last picture failure per persona, shown under the picture until the next try. */
const pictureFailures = new Map<string, string>();

/** The personas whose picture menu is open: it survives the page's repaint (a reload after the list changed). */
const openMenus = new Set<string>();

async function sendPicture(ctx: BlockContext, method: 'personaAvatarSet' | 'personaAvatarRemove', payload: Record<string, string>): Promise<void> {
  const reply = (await ctx.deps.invoke(method, { persona: ctx.persona.id, ...payload }).catch((error: unknown) => ({ ok: false, error: String(error) }))) as { ok?: boolean; error?: string };
  if (reply.ok === true) {
    pictureFailures.delete(ctx.persona.id);
    // The list's new `avatarVersion` (or none) is what the circles draw from: read it, then redraw.
    await ctx.refreshPersonas();
  } else {
    pictureFailures.set(ctx.persona.id, ctx.t('persona.picture.failed', { error: reply.error ?? '' }));
  }
  ctx.change({});
}

function pictureMenu(ctx: BlockContext, close: () => void, input: HTMLInputElement): HTMLElement {
  const { t } = ctx;
  const menu = h('div', 'persona-menu persona-picture-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', t('persona.picture.menu'));
  const item = (label: string, run: () => void): void => {
    const button = outlineButton(label, 'persona-menu-item', () => {
      close();
      run();
    });
    button.setAttribute('role', 'menuitem');
    menu.append(button);
  };
  item(t('persona.picture.upload'), () => input.click());
  if (personaPictures.has(ctx.persona.id)) {
    item(t('persona.picture.remove'), () => void sendPicture(ctx, 'personaAvatarRemove', {}));
  }
  return menu;
}

function pictureRow(ctx: BlockContext): HTMLElement {
  const { t, api } = ctx;
  const row = h('div', 'persona-profile-row');
  const frame = h('div', 'persona-picture-frame');
  frame.append(avatarNode('persona-avatar persona-avatar-profile', ctx.draft().title, ctx.persona.color, ctx.persona.id));
  const input = h('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.hidden = true;
  input.dataset['pick'] = 'picture';
  input.addEventListener('change', () => {
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file !== null) {
      void squarePngOf(file).then(
        (dataUrl) => sendPicture(ctx, 'personaAvatarSet', { dataUrl }),
        () => {
          pictureFailures.set(ctx.persona.id, t('persona.picture.unreadable'));
          ctx.change({});
        },
      );
    }
  });
  const camera = h('button', 'persona-picture-btn');
  camera.type = 'button';
  camera.title = t('persona.picture.change');
  camera.setAttribute('aria-label', t('persona.picture.change'));
  camera.setAttribute('aria-haspopup', 'menu');
  camera.setAttribute('aria-expanded', 'false');
  camera.dataset['field'] = 'picture';
  camera.append(api.ui.icon('camera', 14));
  let menu: HTMLElement | null = null;
  const close = (): void => {
    menu?.remove();
    menu = null;
    openMenus.delete(ctx.persona.id);
    camera.setAttribute('aria-expanded', 'false');
  };
  const open = (): void => {
    menu = pictureMenu(ctx, close, input);
    row.append(menu);
    openMenus.add(ctx.persona.id);
    camera.setAttribute('aria-expanded', 'true');
  };
  camera.addEventListener('click', () => (menu !== null ? close() : open()));
  frame.append(camera);
  row.append(frame, input);
  if (openMenus.has(ctx.persona.id)) {
    open();
  }
  return row;
}

export function profileBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const draft = ctx.draft();
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.page.profile'));
  const roles = ROLE_OPTIONS.map((role) => ({ value: roleLabel(role), label: t(`persona.role.${role}`) }));
  const role = selectOf(roles, draft.role, (value) => ctx.edit({ role: value }));
  role.dataset['field'] = 'role';
  const summary = textInput(draft.summary, (value) => ctx.edit({ summary: value }), 'summary');
  summary.maxLength = SUMMARY_MAX;
  const failure = pictureFailures.get(ctx.persona.id);
  block.append(
    blockHead(t('persona.page.profile')),
    pictureRow(ctx),
    ...(failure === undefined ? [] : [Object.assign(h('div', 'persona-note persona-state-error', failure), { role: 'alert' })]),
    labelled(t('persona.page.name'), textInput(draft.title, (value) => ctx.edit({ title: value }), 'title')),
    // Mission Control's persona has no role to choose (board 7k v4 `DeskPersonaPia`).
    ...(ctx.persona.kind === 'mission' ? [] : [labelled(t('persona.page.role'), role)]),
    labelled(t('persona.page.summary'), summary),
  );
  return block;
}
