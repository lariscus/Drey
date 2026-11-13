import type { FileSystem } from '../ports/file-system';

/** What the locator reads of the file system. */
export type BinaryFiles = Pick<FileSystem, 'exists' | 'join'>;

/**
 * Whether a harness's command is installed (req-286): the folders of
 * `PATH`, and on Windows each `PATHEXT` ending (`opencode.cmd`, `claude.exe`)
 * — the way the shell would resolve it, without starting anything. A harness
 * whose command is on no folder is *not installed*; the probe spawns nothing.
 */
export class BinaryLocator {
  constructor(
    private readonly files: BinaryFiles,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly windows: boolean,
  ) {}

  /** The command's path, or null when no folder of `PATH` holds it. */
  async find(command: string): Promise<string | null> {
    const folders = (this.env['PATH'] ?? this.env['Path'] ?? '').split(this.windows ? ';' : ':').filter((folder) => folder.trim() !== '');
    const endings = this.windows ? ['', ...(this.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())] : [''];
    for (const folder of folders) {
      for (const ending of endings) {
        const candidate = this.files.join(folder.trim(), `${command}${ending}`);
        if (await this.files.exists(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }
}
