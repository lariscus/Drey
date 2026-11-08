/**
 * The files the runner's core reads and writes (ADR-0096): run records and
 * streams, the chain's state, the worker's ticket copy, persona memory,
 * prompts, attachments. Paths are joined through the port too, so the core
 * imports no Node module. The Node adapter is `NodeFileSystem`; a spec may
 * pass its own.
 */
export interface FileSystem {
  /** The file's text; rejects when it cannot be read. */
  readText(path: string): Promise<string>;
  /** The file's text, or null when it is missing or unreadable. */
  readTextOrNull(path: string): Promise<string | null>;
  writeText(path: string, text: string, options?: { readonly mode?: number }): Promise<void>;
  /** Temp file + rename: a torn file never stands in its place. */
  writeAtomic(path: string, text: string): Promise<void>;
  appendText(path: string, text: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Creates the folder and its parents. */
  mkdirp(path: string): Promise<void>;
  /** Removes a file; a missing one is no error. */
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** The names in a folder; empty when it is missing. */
  list(path: string): Promise<string[]>;
  join(...parts: string[]): string;
  dirname(path: string): string;
  resolve(base: string, relative: string): string;
}
