/**
 * The unconfigured state's way out (D-74): Settings → Tickets names a
 * folder — an empty one becomes a git repository (ADR-0076: the tickets
 * repository is its own repo), an existing repository is taken as it is —
 * the folder registers as a vault, Drey Service starts for it (hosting it
 * before its board exists, the engine's fresh path), and the board
 * initializes in it: pipeline, repos, the human persona, the store beside
 * the vault. One `board-changed` later the settings page and the Work
 * panel live.
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { TicketsVaultRef } from '../engine/unconfigured-error';

export interface SetupDeps {
  readonly listVaults: () => Promise<readonly { id: string; name: string; path: string; exists: boolean }[]>;
  /** Registers an existing folder as a vault (SDK 1.33). */
  readonly register: (folder: string) => Promise<{ id: string; name: string; path: string }>;
  /** Whether the vault already carries a board (`tickets/_meta/pipeline.md`). */
  readonly hasBoard: (vaultId: string) => Promise<boolean>;
  /** Starts (or adopts) Drey Service for the named vault. */
  readonly startEngine: (startVault: TicketsVaultRef) => Promise<void>;
  /** The engine's fresh path: pipeline, repos, the human persona, the store. */
  readonly initialize: (vaultId: string) => Promise<{ ok: boolean; warning?: string; error?: string }>;
  /** `git init` in a folder the picker just created. */
  readonly gitInit: (folder: string) => Promise<void>;
  /** The folder's entry names, null when it cannot be read (the emptiness and `.git` checks). */
  readonly entries: (folder: string) => Promise<readonly string[] | null>;
  readonly log: (message: string) => void;
}

export type SetupResult = { readonly ok: true; readonly note?: string } | { readonly ok: false; readonly error: string };

const sameFolder = (a: string, b: string): boolean => {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return left === right || (process.platform === 'win32' && left.toLowerCase() === right.toLowerCase());
};

/** Runs the setup for a folder the owner picked; every refusal says what to pick instead. */
export async function setupTicketsVault(deps: SetupDeps, folder: unknown): Promise<SetupResult> {
  if (typeof folder !== 'string' || folder.trim() === '') {
    return { ok: false, error: 'No folder was chosen.' };
  }
  const root = path.resolve(folder.trim());
  const listing = await deps.entries(root).catch(() => null);
  if (listing === null) {
    return { ok: false, error: `"${root}" does not exist — pick the folder in the dialog.` };
  }
  if (!listing.includes('.git')) {
    if (listing.length > 0) {
      return {
        ok: false,
        error: `"${path.basename(root)}" is neither empty nor a git repository — pick an empty folder or an existing repository.`,
      };
    }
    await deps.gitInit(root);
    deps.log(`tickets repository created at ${root}`);
  }
  const known = (await deps.listVaults()).find((vault) => sameFolder(vault.path, root));
  const vault = known ?? (await deps.register(root));
  const startVault: TicketsVaultRef = { id: vault.id, name: vault.name, path: vault.path };
  try {
    await deps.startEngine(startVault);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (await deps.hasBoard(startVault.id)) {
    return { ok: true, note: 'The tickets board already exists — nothing to initialize.' };
  }
  const board = await deps.initialize(startVault.id);
  return board.ok
    ? { ok: true, ...(board.warning === undefined ? {} : { note: board.warning }) }
    : { ok: false, error: board.error ?? 'the board could not be initialized' };
}

/** The folder's entry names, or null when it cannot be read (missing drive, vanished folder). */
export async function folderEntries(folder: string): Promise<readonly string[] | null> {
  try {
    return await fsp.readdir(folder);
  } catch {
    return null;
  }
}
