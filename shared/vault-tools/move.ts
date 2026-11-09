/**
 * `vault_move` and `vault_delete` (ADR-0071): the changes a diff cannot
 * show — asked as an action where the write rule says so (a delete every
 * time), carried out through the host's rename (links kept, ADR-0059) or
 * delete, then announced.
 */
import { cleanPath } from './scope';
import { fail, ok, plural, type McpToolResult } from './types';
import { raceSignal, refuseProtected, refuseUngranted, WRITES_OFF, type WriteContext } from './write-context';

export async function vaultMove(
  ctx: WriteContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  if (ctx.rule === 'off') {
    return fail(WRITES_OFF);
  }
  const located = ctx.scope.locate(args['from'], args['vault']);
  if ('error' in located) {
    return fail(located.error.replace('"path"', '"from"'));
  }
  const { vault, path: from } = located;
  const ungranted = refuseUngranted(ctx, vault);
  if (ungranted !== null) {
    return ungranted;
  }
  const to = cleanPath(args['to']);
  if (to === '') {
    return fail('Error: vault_move needs `to` — the full new path, including the file name.');
  }
  if (to === from) {
    return fail('Error: `from` and `to` are the same path — nothing to move.');
  }
  if (ctx.scope.isProtected(from) || ctx.scope.isProtected(to)) {
    return refuseProtected(ctx.scope.isProtected(from) ? from : to);
  }
  if (ctx.rule === 'confirm') {
    const approved = await raceSignal(
      ctx.deps.approve({ tool: 'vault_move', args: { from, to, vault: vault.name } }),
      ctx.signal,
    );
    if (!approved) {
      return fail(
        'Error: the user declined the move — nothing was changed. Do not try again unless they ask.',
      );
    }
  }
  const { openDocs } = ctx.deps;
  // Notes with unsaved changes get their links rewritten in the buffer,
  // not in the file: the next save would undo a rewrite on disk (ADR-0059).
  const unsaved = ((await openDocs?.dirty()) ?? [])
    .filter((doc) => doc.vaultId === vault.id && doc.path.toLowerCase().endsWith('.md'))
    .map((doc) => ({ path: doc.path, content: doc.content }));
  let result;
  try {
    result = await ctx.deps.rename({
      fromRel: from,
      toRel: to,
      fromVaultId: vault.id,
      toVaultId: vault.id,
      buffers: unsaved,
    });
  } catch (err) {
    return fail(
      `Error: could not move ${from} — ${err instanceof Error ? err.message : String(err)}. Check both paths with vault_list.`,
    );
  }
  if (openDocs !== undefined) {
    await openDocs.moved(vault.id, from, result.path);
    for (const asset of result.assets) {
      if (asset.kind === 'move') {
        await openDocs.moved(vault.id, asset.from, asset.to);
      }
    }
    for (const buffer of result.buffers) {
      await openDocs.apply(vault.id, buffer.path, buffer.content, {
        save: false,
        origin: ctx.origin,
      });
    }
  }
  ctx.deps.announceRefresh(vault.id);
  if (result.written.length > 0) {
    // The notes whose links were rewritten: open tabs of them reload.
    ctx.deps.announce({ vaultId: vault.id, changedPaths: result.written, deletedPaths: [] });
  }
  const linked = result.written.length + result.buffers.length;
  return ok(
    [
      `Moved ${from} → ${result.path}.`,
      ...(linked > 0 ? [`Links updated in ${plural(linked, 'note')}.`] : []),
      ...(result.assets.length > 0 ? [`${plural(result.assets.length, 'attachment')} moved with it.`] : []),
      ...(result.failed.length > 0 ? [`Could not update: ${result.failed.join('; ')}.`] : []),
    ].join(' '),
  );
}

export async function vaultDelete(
  ctx: WriteContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  if (ctx.rule === 'off') {
    return fail(WRITES_OFF);
  }
  const located = ctx.scope.locate(args['path'], args['vault']);
  if ('error' in located) {
    return fail(located.error);
  }
  const { vault, path } = located;
  const ungranted = refuseUngranted(ctx, vault);
  if (ungranted !== null) {
    return ungranted;
  }
  if (ctx.scope.isProtected(path)) {
    return refuseProtected(path);
  }
  try {
    // Files only: a folder cannot be read, and deleting one is not offered.
    await ctx.deps.vault.readFile(path, vault.id);
  } catch {
    return fail(
      `Error: there is no file "${path}" in ${vault.name}. vault_delete removes single files — check the path with vault_list.`,
    );
  }
  // Asked every time, whatever the write rule: a diff cannot show it.
  const approved = await raceSignal(
    ctx.deps.approve({ tool: 'vault_delete', args: { path, vault: vault.name } }),
    ctx.signal,
  );
  if (!approved) {
    return fail(
      'Error: the user declined the deletion — nothing was changed. Do not try again unless they ask.',
    );
  }
  const { trashed } = await ctx.deps.vault.deleteEntry(path, vault.id);
  // Its tab goes with it, as after a delete in the Files panel.
  await ctx.deps.openDocs?.closed(vault.id, path);
  ctx.deps.announce({ vaultId: vault.id, changedPaths: [], deletedPaths: [path] });
  return ok(trashed ? `Moved ${path} to the recycle bin.` : `Deleted ${path}.`);
}
