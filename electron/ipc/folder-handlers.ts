import { ipcMain, shell } from 'electron';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { IPC_CHANNELS, PlainFolderEntry, PlainFolderListRequest } from '../../shared/ipc-api';

/** What the listing needs of the external-file gate: its files become readable. */
export interface ReadOnlyAdmission {
  admitReadOnly(absolutePaths: readonly string[]): void;
}

export interface FolderHandlerDeps {
  externalFiles: ReadOnlyAdmission;
}

/** The listing plus the absolute paths of its files (what the gate admits). */
export interface PlainFolderListing {
  readonly entries: PlainFolderEntry[];
  readonly files: string[];
}

/** True when `relative` (from `path.relative`) leaves its base. */
function escapes(relative: string): boolean {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/**
 * The real path of `root/rel` after the request's checks: `root` absolute,
 * `rel` relative and -- after realpath, so through a symlink too -- inside
 * the root. Rejects a path that does not exist.
 */
export async function resolveInside(request: PlainFolderListRequest): Promise<string> {
  const { root, rel } = request ?? ({} as PlainFolderListRequest);
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('The folder must be an absolute path.');
  }
  if (typeof rel !== 'string' || path.isAbsolute(rel)) {
    throw new Error('The sub-folder must be a relative path.');
  }
  const realRoot = await fsp.realpath(root);
  const target = await fsp.realpath(path.resolve(realRoot, rel));
  if (escapes(path.relative(realRoot, target))) {
    throw new Error('The path lies outside the folder.');
  }
  return target;
}

/** A dirent's listing type; a symlink counts as what it points at, a dangling one as nothing. */
async function entryType(dir: string, dirent: { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): Promise<PlainFolderEntry['type'] | null> {
  if (dirent.isDirectory()) {
    return 'directory';
  }
  if (dirent.isFile()) {
    return 'file';
  }
  if (!dirent.isSymbolicLink()) {
    return null;
  }
  const stat = await fsp.stat(path.join(dir, dirent.name)).catch(() => null);
  if (stat?.isDirectory()) {
    return 'directory';
  }
  return stat?.isFile() ? 'file' : null;
}

function byKindThenName(a: PlainFolderEntry, b: PlainFolderEntry): number {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * One level of a project's plain folder (req-285): `root` absolute, `rel` a
 * forward-slash sub-path ('' = the root). Directories first, then files,
 * each by name; dot names (`.git`) skipped. Reads only.
 */
export async function listPlainFolder(request: PlainFolderListRequest): Promise<PlainFolderListing> {
  const target = await resolveInside(request);
  const entries: PlainFolderEntry[] = [];
  for (const dirent of await fsp.readdir(target, { withFileTypes: true })) {
    if (dirent.name.startsWith('.')) {
      continue;
    }
    const type = await entryType(target, dirent);
    if (type !== null) {
      entries.push({ name: dirent.name, type });
    }
  }
  entries.sort(byKindThenName);
  // The renderer opens a file by the path it computes from `root` (not the
  // realpath), so the gate admits that spelling.
  const shown = path.resolve(request.root, request.rel);
  const files = entries.filter((e) => e.type === 'file').map((e) => path.join(shown, e.name));
  return { entries, files };
}

/** `folder:list` and `folder:reveal` -- thin wrappers over the checks above. */
export function registerFolderHandlers({ externalFiles }: FolderHandlerDeps): void {
  ipcMain.handle(
    IPC_CHANNELS.folderList,
    async (_e, request: PlainFolderListRequest): Promise<PlainFolderEntry[]> => {
      const { entries, files } = await listPlainFolder(request);
      externalFiles.admitReadOnly(files);
      return entries;
    },
  );
  ipcMain.handle(IPC_CHANNELS.folderReveal, async (_e, request: PlainFolderListRequest): Promise<void> => {
    shell.showItemInFolder(await resolveInside(request));
  });
}
