// i18n: catalog
/**
 * What the Skills block holds between a load and a close, apart from its
 * DOM (R11, req-237): the persona's skill listing as the engine last
 * answered it, the failure of the last call, and the one call running.
 * Every call returns the engine's new listing, so a switch, a removal and an
 * upload are one round trip each and the rows always show what the engine
 * holds; a failure leaves the listing as it was. Listeners (the block, the
 * Instructions head's token figure) hear every change.
 */
import type { SkillListData, SkillUploadCommand } from '../../../../packages/tickets-engine/src/contracts/skills';
import type { PersonaSkillsSeam, SkillsFailure } from './persona-seams';

export class PersonaSkillsState {
  private listing: SkillListData | null = null;
  private lastFailure: SkillsFailure | null = null;
  private running = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly seam: PersonaSkillsSeam,
    private readonly persona: string,
  ) {}

  /** The listing the engine last gave; null until the first read succeeded. */
  get list(): SkillListData | null {
    return this.listing;
  }

  get failure(): SkillsFailure | null {
    return this.lastFailure;
  }

  /** A call is running: the block keeps its controls still meanwhile. */
  get busy(): boolean {
    return this.running;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(): Promise<void> {
    return this.run(() => this.seam.list(this.persona));
  }

  toggle(skill: string, on: boolean): Promise<void> {
    return this.run(() => this.seam.toggle(this.persona, skill, on));
  }

  remove(name: string): Promise<void> {
    return this.run(() => this.seam.remove(this.persona, name));
  }

  /** Uploads into the persona's own folder. */
  upload(command: Omit<SkillUploadCommand, 'scope' | 'persona'>): Promise<void> {
    return this.run(() => this.seam.upload({ ...command, scope: 'own', persona: this.persona }));
  }

  /** Puts a failure in the block's line without a call (a pick the page refused before sending). */
  fail(failure: SkillsFailure): void {
    this.lastFailure = failure;
    this.emit();
  }

  private async run(call: () => Promise<{ readonly ok: true; readonly list: SkillListData } | SkillsFailure>): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastFailure = null;
    this.emit();
    try {
      const reply = await call();
      if (reply.ok) {
        this.listing = reply.list;
      } else {
        this.lastFailure = reply;
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
