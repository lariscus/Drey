/**
 * Where a vault path really leads, and the vault's notes as the engine serves
 * them — shared by the Notes API (req-100) and Drey Service's vault MCP
 * (req-167). The rule of what is served is `core/note-path.ts`; this applies it
 * to the disk.
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { NoteEntry } from '../contracts/notes';
import { isNoteFileName, isServedChild, isServedPath } from '../core/note-path';

const isMissing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export const noteNameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, '');

/**
 * The grammar judged the words the client sent; this judges where they
 * lead. A link inside the vault could point outside it or into `.drafts/`,
 * and the platform may read a name differently (`DRAFTS~1` on Windows), so
 * the deepest part that exists is resolved and judged again.
 */
export async function staysServed(root: string, rel: string): Promise<boolean> {
  const realRoot = await fsp.realpath(root);
  const missing: string[] = [];
  let probe = path.join(root, rel);
  for (;;) {
    try {
      const real = path.relative(realRoot, await fsp.realpath(probe));
      if (real === '..' || real.startsWith(`..${path.sep}`) || path.isAbsolute(real)) {
        return false;
      }
      const segments = real === '' ? [] : real.split(path.sep);
      return isServedPath([...segments, ...missing].join('/'));
    } catch (error) {
      if (!isMissing(error) || probe === root) {
        throw error;
      }
      missing.unshift(path.basename(probe));
      probe = path.dirname(probe);
    }
  }
}

export async function noteEntryOf(root: string, rel: string): Promise<NoteEntry | null> {
  const stat = await fsp.stat(path.join(root, rel)).catch(() => null);
  return stat === null ? null : { path: rel, name: noteNameOf(rel), mtime: Math.round(stat.mtimeMs), size: stat.size };
}

/** Every served note, newest first. Links are not followed: a link in a listing could lead out of the vault. */
export async function allNotesNewestFirst(root: string): Promise<NoteEntry[]> {
  const notes: NoteEntry[] = [];
  const walk = async (folder: string): Promise<void> => {
    const entries = await fsp.readdir(path.join(root, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!isServedChild(folder, entry.name)) {
        continue;
      }
      const rel = folder === '' ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (entry.isFile() && isNoteFileName(entry.name)) {
        const note = await noteEntryOf(root, rel);
        if (note !== null) {
          notes.push(note);
        }
      }
    }
  };
  await walk('');
  return notes.sort((a, b) => b.mtime - a.mtime);
}
