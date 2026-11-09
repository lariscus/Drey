/**
 * The Local model row of board 8a (req-165): is the local OpenAI-compatible
 * endpoint answering? The endpoint is Drey's own LLM setting
 * (`app-config.json` → `llm`) when it is a local one on this machine,
 * otherwise LM Studio's default. Any HTTP answer counts as reachable — a
 * model listing is never assumed (CLAUDE.md); only a refused connection or a
 * timeout is not. `lastSeen` lives as long as this window process.
 */
import { LM_STUDIO_DEFAULT_BASE_URL } from '../../shared/config/schema';
import { i18n } from '../../shared/i18n';
import type { LocalModelFacts } from '../../shared/service-window/contract';
import type { FetchFn } from './json-http';

export interface ModelTarget {
  readonly url: string;
  readonly name: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Where to knock, from Drey's `llm` setting. */
export function localModelTarget(llm: unknown): ModelTarget {
  const config = (typeof llm === 'object' && llm !== null ? llm : {}) as { provider?: unknown; baseUrl?: unknown };
  const local = config.provider === 'lmstudio' || config.provider === 'openai-compat';
  if (local && typeof config.baseUrl === 'string') {
    try {
      const url = new URL(config.baseUrl);
      if (LOOPBACK.has(url.hostname)) {
        return { url: config.baseUrl.replace(/\/+$/, ''), name: config.provider === 'lmstudio' ? i18n.t('service_tray.lm_studio') : url.host };
      }
    } catch {
      // a broken URL falls back to LM Studio's default
    }
  }
  return { url: LM_STUDIO_DEFAULT_BASE_URL, name: i18n.t('service_tray.lm_studio') };
}

export class LocalModelProbe {
  private reachable: boolean | null = null;
  private lastSeen: string | null = null;
  private name: string | null = null;
  private lastProbe = 0;

  constructor(
    private readonly readLlm: () => Promise<unknown>,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
    private readonly everyMs = 15_000,
  ) {}

  /** The facts now; probes again when the last probe is older than the span. */
  async facts(): Promise<LocalModelFacts> {
    if (this.now() - this.lastProbe >= this.everyMs) {
      this.lastProbe = this.now();
      await this.probe();
    }
    return { reachable: this.reachable, name: this.name, lastSeen: this.lastSeen };
  }

  private async probe(): Promise<void> {
    const target = localModelTarget(await this.readLlm().catch(() => null));
    this.name = target.name;
    try {
      await this.fetchFn(`${target.url}/models`, { signal: AbortSignal.timeout(2_000) });
      this.reachable = true;
      this.lastSeen = new Date(this.now()).toISOString();
    } catch {
      this.reachable = false;
    }
  }
}
