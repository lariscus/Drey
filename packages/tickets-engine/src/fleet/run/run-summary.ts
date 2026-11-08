import type { RunInfo } from '../protocol';

/** 331122 -> `331k`, 3_400_000 -> `3.4M`: the short token counts of a status line. */
function tokenWords(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  return n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);
}

/**
 * What the run used, for the ticket's release note: tokens always (input
 * counts cache reads, named when the provider reported any), cost only when
 * the provider reports one — a flat coding plan reports 0, which says
 * nothing and is left out.
 */
export function usageSummary(info: Pick<RunInfo, 'tokensIn' | 'tokensOut' | 'cacheReadTokens' | 'costUsd'>): string {
  if (info.tokensIn === 0 && info.tokensOut === 0) {
    return '';
  }
  const cached = (info.cacheReadTokens ?? 0) > 0 ? ` (${tokenWords(info.cacheReadTokens ?? 0)} cached)` : '';
  const cost = info.costUsd !== null && info.costUsd > 0 ? ` · $${info.costUsd.toFixed(2)}` : '';
  return ` — ${tokenWords(info.tokensIn)} in${cached} / ${tokenWords(info.tokensOut)} out${cost}`;
}

/**
 * A gate failure's one line — what a status comment and a park reason may
 * carry (T-0048): the first non-empty line, whitespace-flattened, capped at
 * 300 chars. The multi-line block lives in `RunInfo.gateFailure` and the
 * retry instruction, never in a one-line note.
 */
export function shortGateLine(text: string): string {
  const first =
    text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .find((line) => line !== '') ?? '';
  return first.length > 300 ? `${first.slice(0, 299)}…` : first;
}

/** The first line of a failed run's reason: the short gate line, else the last error's first line. */
export function failureLine(info: Pick<RunInfo, 'gateFailure' | 'lastError'>): string {
  return info.gateFailure !== null ? shortGateLine(info.gateFailure) : (((info.lastError ?? '').split('\n')[0] ?? '').trim() || 'the run failed');
}
