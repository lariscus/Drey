import type { FileSystem } from '../ports/file-system';
import type { OpencodeAccounts } from './service-config-file';

/**
 * The accounts opencode is signed in to (req-317): the top-level key names
 * of its `auth.json` (`zai-coding-plan`, `github-copilot`, ...). The file
 * holds the keys and tokens of those accounts — only the names leave this
 * class: no value is returned, kept or logged. A missing, unreadable or
 * foreign file has no accounts.
 */
export class OpencodeAuthAccounts implements OpencodeAccounts {
  constructor(
    private readonly fs: FileSystem,
    private readonly authFile: string,
  ) {}

  async names(): Promise<readonly string[]> {
    const text = await this.fs.readTextOrNull(this.authFile);
    if (text === null) {
      return [];
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
    } catch {
      return [];
    }
  }
}
