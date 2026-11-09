// i18n: catalog
/**
 * What the Instructions block holds of the engine's prompt preview (R11,
 * req-238), apart from its DOM: the last brief the engine assembled, the
 * failure of the last ask, and the request it answered. `ensure` asks again
 * only when the step or the model differs from the last ask (the page calls
 * it after every edit) or when told to (the skills changed); an answer that
 * arrives after a newer ask is dropped.
 */
import type { PromptPreview, PromptPreviewSeam, SkillsFailure } from './persona-seams';

export type PreviewRequest = { readonly step?: string; readonly model?: string };

export class PersonaPreviewState {
  private latest: PromptPreview | null = null;
  private lastFailure: SkillsFailure | null = null;
  private asked = '';
  private sequence = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly seam: PromptPreviewSeam,
    private readonly persona: string,
    private readonly request: () => PreviewRequest,
  ) {}

  get preview(): PromptPreview | null {
    return this.latest;
  }

  get failure(): SkillsFailure | null {
    return this.lastFailure;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reads the brief again when what it is for changed, or always with `force`. */
  async ensure(force = false): Promise<void> {
    const request = this.request();
    const key = JSON.stringify(request);
    if (!force && key === this.asked) {
      return;
    }
    this.asked = key;
    const ticket = ++this.sequence;
    const reply = await this.seam.preview(this.persona, request);
    if (ticket !== this.sequence) {
      return;
    }
    if (reply.ok) {
      this.latest = reply.preview;
      this.lastFailure = null;
    } else {
      this.lastFailure = reply;
    }
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
