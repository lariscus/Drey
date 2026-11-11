/**
 * The pure halves of `fetch-dk.mjs` (req-277): names, URLs, the release's
 * `checksums.txt`, the digest checks and the extraction of one file from the
 * release archive. No network, no disk -- `fetch-dk-lib.spec.mjs` runs them.
 */
import { createHash } from 'node:crypto';
import { zipEntries } from './zip-entries.mjs';

/** The release archive of a platform, e.g. `dricket_0.6.2_windows_amd64.zip`. */
export function archiveName(version, platform) {
  return `dricket_${version}_${platform}.zip`;
}

/** A file of the GitHub release `v<version>` of `repo` (`owner/name`). */
export function releaseUrl(repo, version, file) {
  return `https://github.com/${repo}/releases/download/v${version}/${file}`;
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** `checksums.txt` (`<sha256>  <file>` per line, `*` before binary names) -> Map file -> lower-case digest. */
export function parseChecksums(text) {
  const digests = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line);
    if (m !== null) {
      digests.set(m[2], m[1].toLowerCase());
    }
  }
  return digests;
}

/**
 * Throws unless the archive is the pinned one: the release's `checksums.txt`
 * must list `file` with the pinned digest (a re-tagged release fails here)
 * and the archive's own SHA-256 must be that digest.
 */
export function verifyArchive({ archive, file, pinned, checksumsText }) {
  const listed = parseChecksums(checksumsText).get(file);
  if (listed === undefined) {
    throw new Error(`checksums.txt does not list ${file}`);
  }
  if (listed !== pinned.toLowerCase()) {
    throw new Error(`checksums.txt lists ${file} as ${listed}, the pin says ${pinned}`);
  }
  const digest = sha256Hex(archive);
  if (digest !== listed) {
    throw new Error(`checksum mismatch for ${file}: expected ${listed}, got ${digest}`);
  }
}

/** The content of the archive's top-level file `name`; throws when it is missing. */
export function extractFile(archive, name) {
  for (const entry of zipEntries(archive)) {
    if (entry.name === name) {
      return entry.data;
    }
  }
  throw new Error(`${name} is not in the archive`);
}

/** The stamp that says which release a `build/dk/` folder holds: version plus the archive digest. */
export function stampOf(version, sha256) {
  return `${version} ${sha256}`;
}
