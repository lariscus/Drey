/**
 * What `git clone` said (req-304), read into something the page can name:
 * the progress lines git prints on stderr (`Receiving objects:  45% (45/100)`,
 * separated by carriage returns) and the failure kind of its last words.
 * Pure; the process is `repo-clone.ts`.
 */

export type CloneFailureCode = 'bad_url' | 'credentials' | 'exists' | 'auth' | 'offline' | 'not_found' | 'no_git' | 'cancelled' | 'busy' | 'git';

export interface CloneProgress {
  /** git's own phase name: `Receiving objects`, `Resolving deltas`… */
  readonly phase: string;
  readonly percent: number;
}

const PROGRESS = /^(?:remote: )?([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/;

/** The progress a line of git's stderr reports, or null for any other line. */
export function progressOfLine(line: string): CloneProgress | null {
  const match = PROGRESS.exec(line.trim());
  return match === null ? null : { phase: match[1]!, percent: Math.min(100, Number(match[2])) };
}

/** Why a clone failed, from git's message — authentication first: a refused login also says "unable to access". */
export function classifyCloneFailure(message: string): CloneFailureCode {
  if (/Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|Permission denied \((?:publickey|password)|Host key verification failed|HTTP Basic: Access denied|returned error: (?:401|403)|Invalid username or token/i.test(message)) {
    return 'auth';
  }
  if (/already exists and is not an empty directory/i.test(message)) {
    return 'exists';
  }
  if (/Repository not found|does not appear to be a git repository|returned error: 404|not found\b/i.test(message)) {
    return 'not_found';
  }
  if (/Could not resolve host|Failed to connect|Connection (?:timed out|refused|reset)|Network is unreachable|Could not connect|unable to access|Temporary failure in name resolution|Could not resolve hostname/i.test(message)) {
    return 'offline';
  }
  return 'git';
}

/** The failure text to show: git's lines without its own prefixes, the progress and the "Cloning into" line. */
export function cleanCloneMessage(stderr: string): string {
  const lines = stderr
    .split(/\r?\n|\r/)
    .map((line) => line.replace(/^(fatal|error): /, '').trim())
    .filter((line) => line !== '' && !PROGRESS.test(line) && !line.startsWith('Cloning into') && !line.startsWith('hint: '));
  return lines.slice(-6).join('\n');
}
