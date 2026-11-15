import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { PROJECTS_DIR } from '../../contracts/projects';
import type { BoardSnapshot, TicketCard } from '../../contracts/tickets';
import type { TicketDetail } from '../../ports/ticket-store';
import { DricketFileStore } from '../../store/dricket-file-store';
import { FileStoreReader } from '../../store/file-store-reader';
import { assembleBoardFromRecords, recordToBoardFile } from '../../store/store-board';
import { checkoutOf, createDricketStore, type StoreSettings } from '../../store/store-settings';
import type { ChainStoreConfig } from '../protocol';

/**
 * The chain orchestrator's door to a dricket store (E14-5b, ADR-0090): the board is assembled from
 * the checkout's files (the same `assembleBoardFromRecords` the engine's board uses; a ticket whose
 * lease ran out reads as unclaimed, so a dispatch IS the takeover); the one write the chain makes
 * itself is a comment through `dk comment` (a ledger card). Claims stay dk's: the chain does not stamp
 * `claimed-by`; the run's own lease claims.
 */

/** What the chain needs of a store (a spec replaces it; production is a {@link DricketFileStore}). */
export interface ChainStoreIo {
  readAll(): Promise<readonly TicketDetail[]>;
  show(id: string): Promise<TicketDetail>;
  comment(id: string, text: string, options: { readonly actor: string }): Promise<void>;
}

export function chainStoreSettings(config: ChainStoreConfig): StoreSettings {
  return {
    dkPath: config.dkPath,
    dkStore: config.dkStore,
    dkDataDir: config.dkDataDir,
    dkCheckout: config.dkCheckout,
    dkSyncSeconds: 0,
  };
}

/** The production store of a chain config; null when there is no checkout to read the files of. */
export function chainStoreIoOf(config: ChainStoreConfig): ChainStoreIo | null {
  const settings = chainStoreSettings(config);
  const checkout = checkoutOf(settings);
  if (checkout === null) {
    return null;
  }
  return new DricketFileStore(new FileStoreReader({ root: checkout }), createDricketStore(settings), checkout);
}

/** req-282: the project records of the meta vault (`tickets/_meta/projects/*.md`), vault-relative paths. */
async function projectFilesOf(metaVaultPath: string): Promise<{ path: string; text: string }[]> {
  const dir = path.join(metaVaultPath, ...PROJECTS_DIR.split('/'));
  const names = (await fsp.readdir(dir).catch((): string[] => [])).filter((name) => name.endsWith('.md'));
  const files = await Promise.all(names.map(async (name) => ({ path: `${PROJECTS_DIR}/${name}`, text: await fsp.readFile(path.join(dir, name), 'utf8').catch(() => null) })));
  return files.filter((file): file is { path: string; text: string } => file.text !== null);
}

export class StoreChainBoard {
  constructor(
    private readonly io: ChainStoreIo | null,
    private readonly log: (message: string) => void,
  ) {}

  /** The board of this pass: pipeline + repos from the meta vault, tickets from the store. */
  async board(metaVaultPath: string, defaultWorker: string): Promise<BoardSnapshot> {
    const read = (rel: string): Promise<string | null> => fsp.readFile(path.join(metaVaultPath, rel), 'utf8').catch(() => null);
    const [pipelineText, reposText, projectFiles] = await Promise.all([read('tickets/_meta/pipeline.md'), read('tickets/_meta/repos.md'), projectFilesOf(metaVaultPath)]);
    const input = { vaultId: null, vaultName: null, activeVaultName: null, isGitRepo: false, defaultWorker, pipelineText, reposText, projectFiles };
    if (this.io === null) {
      throw new Error('no ticket checkout configured (tickets.dk.checkout, or a local tickets.dk.store)');
    }
    return assembleBoardFromRecords({ ...input, records: await this.io.readAll() });
  }

  /** The card's text in the legacy shape the composer and the gate read (title, `## Description`, acceptance, chapters). */
  async cardText(card: TicketCard): Promise<string | null> {
    if (this.io === null) {
      return null;
    }
    try {
      return recordToBoardFile(await this.io.show(card.id), card.phase).text;
    } catch {
      return null;
    }
  }

  /** A comment through `dk comment` (status verbs, park notes); a failure is a log line. */
  async comment(id: string, text: string, actor: string): Promise<void> {
    if (this.io === null) {
      return;
    }
    try {
      await this.io.comment(id, text, { actor });
    } catch (error) {
      this.log(`the chain's comment on ${id} failed - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
