/**
 * An expired or refused login (Spike 4): Claude Code ends a headless run at
 * once with `authentication_failed` when its token refresh failed; Kimi and
 * the remote quota endpoints answer 401. Such a failure is a slot state
 * (`needs login`), never something to retry.
 */
const LOGIN_FAILURE =
  /authentication_failed|\b401\b|unauthori[sz]ed|invalid (api[ _-]?key|x-api-key|bearer token)|not logged in|please run \/login|(oauth )?token (has )?expired|login (has )?expired/i;

export function isLoginFailure(text: string | null | undefined): boolean {
  return typeof text === 'string' && LOGIN_FAILURE.test(text);
}
