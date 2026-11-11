/**
 * Fetches the dricket CLI (`dk`) the installer ships (req-277, ADR-0090).
 *
 * Drey's tickets board runs on dricket; a fresh install has no `dk`, so the
 * pinned release is downloaded (the public GitHub release archive), checked
 * against its `checksums.txt` AND against the SHA-256 pinned in
 * `scripts/dk-version.json`, and `dk.exe` plus the licence text are unpacked
 * into `build/dk/` (gitignored). `electron-builder.yml` copies them into
 * `resources/dk/`; the tickets plugin finds the binary there
 * (`plugins/tickets/main/dk-path.ts`).
 *
 * Idempotent: a `build/dk/.version` stamp matching the pin, with `dk.exe`
 * present, skips the download. To update dk change `version` and the digest
 * together (the release's `checksums.txt` lists it) and
 * `BUNDLED_DK_VERSION` in `packages/tickets-engine/src/store/dk-process.ts`
 * (a spec compares the two). The bundle is Windows-only, like the installer.
 *
 * No dependencies: the pure halves are in `fetch-dk-lib.mjs`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveName, extractFile, releaseUrl, stampOf, verifyArchive } from './fetch-dk-lib.mjs';

const PLATFORM = 'windows_amd64';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(readFileSync(path.join(repoRoot, 'scripts', 'dk-version.json'), 'utf8'));
const VERSION = pin.version;
const SHA256 = pin.sha256[PLATFORM];
const target = path.join(repoRoot, 'build', 'dk');
const exe = path.join(target, 'dk.exe');
const stamp = path.join(target, '.version');
const wanted = stampOf(VERSION, SHA256);

if (process.platform !== 'win32') {
  console.log('dk is bundled for the Windows installer only; nothing to fetch on this platform.');
  process.exit(0);
}

if (existsSync(exe) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === wanted) {
  console.log(`dk ${VERSION} already present.`);
  process.exit(0);
}

const file = archiveName(VERSION, PLATFORM);
async function download(name) {
  const url = releaseUrl(pin.repo, VERSION, name);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText} (${url})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

console.log(`Downloading dk ${VERSION} …`);
const archive = await download(file);
const checksumsText = (await download('checksums.txt')).toString('utf8');
verifyArchive({ archive, file, pinned: SHA256, checksumsText });

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const binary = extractFile(archive, 'dk.exe');
writeFileSync(exe, binary);
writeFileSync(path.join(target, 'LICENSE'), extractFile(archive, 'LICENSE'));
writeFileSync(stamp, `${wanted}\n`);
console.log(`dk ${VERSION}: ${(binary.length / 1024 / 1024).toFixed(1)} MB -> ${path.relative(repoRoot, exe)}`);
