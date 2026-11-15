import type { FileSystem } from '../ports/file-system';

/** The chain file of a runner from before req-173: one for the whole machine, at the fleet root. */
export const PRE_VAULT_CHAIN_FILE = 'chain.json';

/** Where that file goes once its state moved into its vault's file: kept, read only by the key migration. */
export const LEGACY_CHAIN_FILE = 'chain.legacy.json';

/** The runtime pointer to the vault the chain served last (`{ "vault": { … } }`). */
export const CHAIN_POINTER_FILE = 'chain-vault.json';

/** 32-bit FNV-1a of the text, hex — a stable short key without a crypto import. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The paths of the chain's runtime state (req-173, R13; ADR-0077 later
 * change): one `chain.json` per tickets vault, under
 * `<fleet root>/chains/<vault key>/chain.json`, so two vaults never share a
 * master, an Autopilot or a breaker. The key is the vault folder's name
 * plus a hash of its normalized path (`drey-tickets-1a2b3c4d`) — readable
 * in the folder, unique per path.
 */
export class ChainStatePaths {
  constructor(
    private readonly root: string,
    private readonly fs: Pick<FileSystem, 'join'>,
  ) {}

  /** The vault's key: the folder name (lower case, safe characters) and the path's hash. */
  static keyOf(vaultPath: string): string {
    const normalized = vaultPath.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
    const name = (normalized.split('/').pop() ?? '').replaceAll(/[^a-z0-9-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'vault';
    return `${name.slice(0, 40)}-${fnv1a(normalized)}`;
  }

  fileFor(vaultPath: string): string {
    return this.fs.join(this.root, 'chains', ChainStatePaths.keyOf(vaultPath), 'chain.json');
  }

  pointer(): string {
    return this.fs.join(this.root, CHAIN_POINTER_FILE);
  }

  preVault(): string {
    return this.fs.join(this.root, PRE_VAULT_CHAIN_FILE);
  }

  legacy(): string {
    return this.fs.join(this.root, LEGACY_CHAIN_FILE);
  }
}
