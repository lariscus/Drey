/**
 * `vault_edit`, `vault_write`, `vault_move` and `vault_delete` (ADR-0071):
 * everything that changes the vault. One path for all of them — resolve
 * the vault inside the call's scope, refuse the app's own folders, ask
 * the user where the write rule says so, then apply and announce.
 *
 * A file that is open in the editor is changed through its tab: the
 * change is made to what the tab shows (unsaved text included), lands in
 * the buffer and is saved from there. Only a file that is not open is
 * written through the vault manager (history, own-write ledger).
 */
import { applyTextEdits, TextEdit } from '../text-edit';
import { currentText } from './current-text';
import type { ScopedVault } from './scope';
import { fail, NO_VAULT, ok, plural, type McpToolResult, type VaultWriteRule } from './types';
import { raceSignal, refuseProtected, refuseUngranted, WRITES_OFF, type WriteContext } from './write-context';

/**
 * How a change to this file is made: `live` puts it into the open tab at
 * once, unasked and unsaved (ADR-0049); a file the call carries in its
 * scope by itself (the attached note) is never refused — a rule of `off`
 * asks first instead.
 */
function ruleFor(ctx: WriteContext, vault: ScopedVault, path: string): VaultWriteRule | 'live' {
  const own = ctx.scope.file(vault.id, path);
  if (own?.live === true) {
    return 'live';
  }
  return own !== undefined && ctx.rule === 'off' ? 'confirm' : ctx.rule;
}

/** Asks where the rule says so, applies, announces. A string is the note to add to the result; a result is the refusal. */
async function commit(
  ctx: WriteContext,
  vault: ScopedVault,
  path: string,
  file: { text: string; crlf: boolean; open: boolean } | null,
  after: string,
  mode: 'overwrite' | 'append',
): Promise<McpToolResult | string> {
  const before = file?.text ?? '';
  const rule = ruleFor(ctx, vault, path);
  if (rule === 'off') {
    return fail(WRITES_OFF);
  }
  if (rule === 'confirm') {
    const approved = await raceSignal(
      ctx.deps.confirmWrite({
        path,
        before,
        after,
        mode,
        vaultId: vault.id,
        vaultName: vault.name,
        ...(ctx.origin === 'assistant' ? { origin: 'assistant' as const } : {}),
      }),
      ctx.signal,
    );
    if (!approved) {
      return fail(
        'Error: the user declined this change — nothing was written. Do not try again unless they ask.',
      );
    }
  }
  let note = '';
  if (vault.id === NO_VAULT && file?.open !== true) {
    return fail(`Error: ${path} is not open in the editor any more — nothing was changed.`);
  }
  if (file?.open === true && ctx.deps.openDocs !== undefined) {
    // A tab that was never saved stays unsaved: saving it is the user's
    // choice of a place.
    const save = rule !== 'live' && vault.id !== NO_VAULT;
    const { applied, saved } = await ctx.deps.openDocs.apply(vault.id, path, after, {
      save,
      origin: ctx.origin,
    });
    if (!applied) {
      return fail(
        `Error: ${path} is open in the editor and the change could not be applied there — nothing was changed. Read the file again and retry once.`,
      );
    }
    if (save && !saved) {
      note = ' The change is in the open editor tab and not saved yet.';
    }
  } else {
    const crlf = file?.crlf ?? false;
    await ctx.deps.vault.writeFile(path, crlf ? after.replace(/\n/g, '\r\n') : after, vault.id, {
      origin: ctx.origin,
    });
    ctx.deps.announce({ vaultId: vault.id, changedPaths: [path], deletedPaths: [] });
  }
  ctx.onChange?.({ vaultId: vault.id, path, before, after });
  return note;
}

function parseEdits(raw: unknown): TextEdit[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      error:
        'Error: vault_edit needs `edits`: a non-empty array of {"old_text": "…", "new_text": "…"}.',
    };
  }
  const edits: TextEdit[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown> | null;
    const oldText = entry !== null && typeof entry === 'object' ? entry['old_text'] : undefined;
    const newText = entry !== null && typeof entry === 'object' ? entry['new_text'] : undefined;
    if (typeof oldText !== 'string' || typeof newText !== 'string') {
      return {
        error: `Error: edit ${i + 1} needs the strings "old_text" and "new_text" — e.g. {"old_text": "Fee: 10", "new_text": "Fee: 12"}.`,
      };
    }
    edits.push({
      oldText: oldText.replace(/\r\n/g, '\n'),
      newText: newText.replace(/\r\n/g, '\n'),
      replaceAll: entry?.['replace_all'] === true,
    });
  }
  return edits;
}

export async function vaultEdit(
  ctx: WriteContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const located = ctx.scope.locate(args['path'], args['vault']);
  if ('error' in located) {
    return fail(located.error);
  }
  const { vault, path } = located;
  const ungranted = refuseUngranted(ctx, vault);
  if (ungranted !== null) {
    return ungranted;
  }
  if (ruleFor(ctx, vault, path) === 'off') {
    return fail(WRITES_OFF);
  }
  if (ctx.scope.isProtected(path)) {
    return refuseProtected(path);
  }
  const edits = parseEdits(args['edits']);
  if ('error' in edits) {
    return fail(edits.error);
  }
  const file = await currentText(ctx.deps, vault.id, path);
  if (file === null) {
    return fail(
      `Error: there is no file "${path}" in ${vault.name} to edit. Check the path with vault_list, or create the file with vault_write (mode "create").`,
    );
  }
  const result = applyTextEdits(file.text, edits);
  if (!result.ok) {
    return fail(result.error);
  }
  const done = await commit(ctx, vault, path, file, result.text, 'overwrite');
  if (typeof done !== 'string') {
    return done;
  }
  return ok(
    `Edited ${path}: ${plural(result.replacements, 'replacement')} at line${result.lines.length === 1 ? '' : 's'} ${result.lines.join(', ')}.${done}`,
  );
}

export async function vaultWrite(
  ctx: WriteContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const located = ctx.scope.locate(args['path'], args['vault']);
  if ('error' in located) {
    return fail(located.error);
  }
  const { vault, path } = located;
  const ungranted = refuseUngranted(ctx, vault);
  if (ungranted !== null) {
    return ungranted;
  }
  if (ruleFor(ctx, vault, path) === 'off') {
    return fail(WRITES_OFF);
  }
  if (ctx.scope.isProtected(path)) {
    return refuseProtected(path);
  }
  const mode = args['mode'];
  if (mode !== 'create' && mode !== 'append' && mode !== 'overwrite') {
    return fail(
      'Error: vault_write needs `mode`: "create" (a new file), "append" (add to the end) or "overwrite" (replace the whole file).',
    );
  }
  if (typeof args['content'] !== 'string') {
    return fail('Error: vault_write needs `content` as a string.');
  }
  const content = args['content'].replace(/\r\n/g, '\n');
  const file = await currentText(ctx.deps, vault.id, path);
  if (mode === 'create' && file !== null) {
    return fail(
      `Error: ${path} already exists — nothing was written. Change it with vault_edit, add to it with mode "append", or pick another path.`,
    );
  }
  const before = file?.text ?? '';
  const after =
    mode === 'append' && before !== ''
      ? `${before}${before.endsWith('\n') ? '' : '\n'}${content}`
      : content;
  if (file !== null && after === before) {
    return ok(`No change — ${path} already has this content.`);
  }
  const done = await commit(ctx, vault, path, file, after, mode === 'append' ? 'append' : 'overwrite');
  if (typeof done !== 'string') {
    return done;
  }
  const lines = after.split('\n').length;
  return ok(
    (file === null
      ? `Created ${path} (${plural(lines, 'line')}).`
      : mode === 'append'
        ? `Appended to ${path} (now ${plural(lines, 'line')}).`
        : `Replaced the content of ${path} (${plural(lines, 'line')}).`) + done,
  );
}

export type { WriteContext } from './write-context';
