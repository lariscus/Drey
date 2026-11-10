// i18n: catalog
/**
 * The deletion ask's state (req-261), apart from its DOM: what was typed, whether
 * a deletion is on its way, and the refusal the engine gave. The Delete button
 * is enabled only while the text is the persona's title exactly — case and
 * whitespace included; the engine checks the same thing again, so this is the
 * owner's guard, not the data's.
 */
import type { I18n } from '../../../../shared/i18n/types';
import { failureOf, refusalText } from './persona-delete-text';

export interface DeleteAskDeps {
  readonly i18n: I18n;
  /** The persona's title: the text the owner must type. */
  readonly name: string;
  /** Sends the removal with the typed text; resolves to the engine's reply, rejects on a transport failure. */
  remove(confirm: string): Promise<unknown>;
}

export class PersonaDeleteAsk {
  private text = '';
  private working = false;
  private refusal = '';
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: DeleteAskDeps) {}

  get name(): string {
    return this.deps.name;
  }

  get typed(): string {
    return this.text;
  }

  get busy(): boolean {
    return this.working;
  }

  /** The refusal the last attempt got, in words; '' = none. */
  get refused(): string {
    return this.refusal;
  }

  canDelete(): boolean {
    return !this.working && this.deps.name !== '' && this.text === this.deps.name;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Typing clears an earlier refusal: the ask is fresh again. */
  type(text: string): void {
    this.text = text;
    this.refusal = '';
    this.notify();
  }

  /** True when the persona is gone; false when the guard held or the engine refused (the reason is in `refused`). */
  async submit(): Promise<boolean> {
    if (!this.canDelete()) {
      return false;
    }
    this.working = true;
    this.refusal = '';
    this.notify();
    try {
      const failure = failureOf(await this.deps.remove(this.text));
      if (failure === null) {
        return true;
      }
      this.refusal = refusalText(this.deps.i18n, this.deps.name, failure);
      return false;
    } catch (error) {
      this.refusal = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.working = false;
      this.notify();
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
