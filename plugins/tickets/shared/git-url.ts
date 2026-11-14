/**
 * The git URL Settings → Projects clones from (req-304): checked before
 * anything runs, by the page (so *Add* stays off for a typo) and again by
 * main (the one place that starts git). An https or ssh URL, the scp-like
 * `git@host:owner/repo.git`, or a `file:` URL (a repository on this
 * machine). A URL that carries a password — or any user in front of an
 * https host, where it is a token — is refused: Drey never stores
 * credentials, git's credential manager and the ssh agent answer for them.
 */
export type GitUrlProblem = 'empty' | 'scheme' | 'credentials' | 'malformed';

export type GitUrlCheck =
  | { readonly ok: true; readonly url: string; /** The repository's name: the default subfolder of the checkout. */ readonly name: string }
  | { readonly ok: false; readonly problem: GitUrlProblem };

const SCHEMES = new Set(['https:', 'ssh:', 'file:']);
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:(?!\/\/)(.+)$/;

/** The last path segment without `.git`, safe as a folder name; null when nothing is left. */
export function repoNameOfPath(pathPart: string): string | null {
  let last = pathPart.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    // a stray % stays as it is
  }
  const name = last.replace(/\.git$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[-.]+$/g, '');
  return name === '' ? null : name;
}

function checkParsed(url: URL, text: string): GitUrlCheck {
  if (!SCHEMES.has(url.protocol)) {
    return { ok: false, problem: 'scheme' };
  }
  if (url.password !== '' || (url.protocol === 'https:' && url.username !== '')) {
    return { ok: false, problem: 'credentials' };
  }
  if (url.protocol !== 'file:' && url.hostname === '') {
    return { ok: false, problem: 'malformed' };
  }
  const name = repoNameOfPath(url.pathname);
  return name === null ? { ok: false, problem: 'malformed' } : { ok: true, url: text, name };
}

export function checkGitUrl(input: string): GitUrlCheck {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '') {
    return { ok: false, problem: 'empty' };
  }
  if (text.startsWith('-') || /\s/.test(text)) {
    return { ok: false, problem: 'malformed' };
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    try {
      return checkParsed(new URL(text), text);
    } catch {
      return { ok: false, problem: 'malformed' };
    }
  }
  const scp = SCP_LIKE.exec(text);
  if (scp === null) {
    return { ok: false, problem: /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) ? 'scheme' : 'malformed' };
  }
  const name = repoNameOfPath(scp[1]!);
  return name === null ? { ok: false, problem: 'malformed' } : { ok: true, url: text, name };
}
