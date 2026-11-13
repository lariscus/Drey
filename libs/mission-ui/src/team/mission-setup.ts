import { computed, signal } from '@angular/core';
import type { PersonaPatch } from '../api/dto';
import type { McI18n } from '../i18n/i18n.service';
import type { PersonaFacts, TeamDetailVm } from './detail';

/** One skill row of the mission persona's Setup: the switch and, once the list is loaded, its mono line. */
export interface MissionSkillRow {
  readonly name: string;
  readonly on: boolean;
  /** `own · 280 tokens`; null while only the carried names are known. */
  readonly line: string | null;
}

/** What the persona detail hands the block: the vm, the catalog and the open persona's facts. */
export interface MissionSetupDeps {
  readonly vm: TeamDetailVm;
  readonly i18n: McI18n;
  readonly persona: () => PersonaFacts | null;
  readonly readOnly: () => boolean;
}

/**
 * The Setup of Mission Control's persona (Pia; req-281, req-293, req-296;
 * boards PadTeamV2 and MPhonePia): her model (the assistant's by default,
 * one of its endpoint's models, or a typed id), the skills she carries and
 * her instructions in the Markdown editor. Every change is one PATCH; the
 * local mirrors flip at once and fold back when the desk refuses.
 */
export class MissionSetup {
  constructor(private readonly deps: MissionSetupDeps) {}

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  // --- the model ---------------------------------------------------------------------

  /** The pinned model as the last pick left it; undefined = the desk's value stands. */
  private readonly modelLocal = signal<string | null | undefined>(undefined);
  readonly sheetOpen = signal(false);
  readonly otherOpen = signal(false);
  readonly otherDraft = signal('');

  readonly chatModels = computed(() => this.deps.vm.chatModels?.() ?? null);

  /** The pinned model id; '' = the same model as the assistant. */
  readonly pinned = computed(() => {
    const local = this.modelLocal();
    return (local !== undefined ? local : this.deps.persona()?.chatModel)?.trim() ?? '';
  });

  /** The row's title and its mono line (`LM Studio · qwen3-coder-30b`). */
  readonly modelRow = computed(() => {
    const models = this.chatModels();
    const pinned = this.pinned();
    const inEffect = pinned !== '' ? pinned : (models?.assistantModel ?? '');
    const provider = models?.providerLabel ?? '';
    const line =
      provider !== '' && inEffect !== ''
        ? this.deps.i18n.t('crew.pia.model_line', { provider, model: inEffect })
        : inEffect || provider;
    return { title: pinned !== '' ? pinned : this.deps.i18n.t('crew.pia.same'), line: line === '' ? null : line };
  });

  /** The sheet's model rows: the endpoint's list, the pinned id first when the list does not hold it. */
  readonly modelChoices = computed(() => {
    const list = this.chatModels()?.models ?? [];
    const pinned = this.pinned();
    return pinned !== '' && !list.includes(pinned) ? [pinned, ...list] : list;
  });

  openSheet(): void {
    if (!this.deps.readOnly()) {
      this.error.set(null);
      this.otherOpen.set(false);
      this.otherDraft.set('');
      this.sheetOpen.set(true);
    }
  }

  closeSheet(): void {
    this.sheetOpen.set(false);
  }

  /** A model pick: null = *Same as the assistant*; one PATCH, the sheet folds. */
  async pick(model: string | null): Promise<void> {
    if (this.deps.readOnly() || this.busy()) {
      return;
    }
    this.sheetOpen.set(false);
    const before = this.modelLocal();
    this.modelLocal.set(model);
    await this.patch({ chatModel: model }, () => this.modelLocal.set(before));
  }

  onOtherInput(event: Event): void {
    this.otherDraft.set((event.target as HTMLInputElement).value);
  }

  /** The typed id of *Other model…* — the id stays hand-enterable whatever the endpoint lists. */
  async useOther(): Promise<void> {
    const id = this.otherDraft().trim();
    if (id !== '') {
      await this.pick(id);
    }
  }

  // --- the skills --------------------------------------------------------------------

  private readonly skillsLocal = signal<readonly string[] | null>(null);

  /** The names switched on: the last switch, else what she carries, else what the loaded list marks. */
  private readonly onNames = computed<readonly string[]>(() => {
    const local = this.skillsLocal();
    if (local !== null) {
      return local;
    }
    const carried = this.deps.persona()?.skills;
    if (carried !== undefined) {
      return carried;
    }
    return (this.deps.vm.personaSkills?.() ?? []).filter((row) => row.on).map((row) => row.name);
  });

  readonly skills = computed<readonly MissionSkillRow[]>(() => {
    const on = this.onNames();
    const loaded = this.deps.vm.personaSkills?.() ?? null;
    if (loaded === null) {
      return on.map((name) => ({ name, on: true, line: null }));
    }
    const t = this.deps.i18n;
    return loaded.map((row) => ({
      name: row.name,
      on: on.includes(row.name),
      line: t.t(row.origin === 'shared' ? 'crew.pia.skill_shared' : 'crew.pia.skill_own', { count: row.tokens }),
    }));
  });

  /** A switch: the list flips at once, the new list PATCHes in one commit. */
  async toggleSkill(name: string): Promise<void> {
    if (this.deps.readOnly() || this.busy()) {
      return;
    }
    const before = this.skillsLocal();
    const current = this.onNames();
    const next = current.includes(name) ? current.filter((skill) => skill !== name) : [...current, name];
    this.skillsLocal.set(next);
    await this.patch({ skills: next }, () => this.skillsLocal.set(before));
  }

  // --- the instructions --------------------------------------------------------------

  /** The text the owner has typed; null = nothing changed yet. */
  private readonly draft = signal<string | null>(null);
  /** What the last Save wrote, until the desk's own read catches up. */
  private readonly saved = signal<string | null>(null);

  /** The prompt as the desk holds it; null while it loads or when it could not be read. */
  readonly base = computed(() => this.saved() ?? this.deps.vm.instructions?.() ?? null);

  readonly text = computed(() => this.draft() ?? this.base() ?? '');

  readonly dirty = computed(() => this.draft() !== null && this.draft() !== this.base());

  readonly editable = computed(() => !this.deps.readOnly() && this.base() !== null);

  /** Save needs a changed, non-empty text and no change in flight. */
  readonly canSave = computed(() => this.dirty() && this.text().trim() !== '' && !this.busy());

  onText(next: string): void {
    // The editor echoes a text it was given; only a real edit is a draft.
    if (next !== this.text()) {
      this.draft.set(next);
    }
  }

  discard(): void {
    this.draft.set(null);
    this.error.set(null);
  }

  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    const prompt = this.text();
    const ok = await this.patch({ prompt }, () => undefined);
    if (ok) {
      this.saved.set(prompt);
      this.draft.set(null);
    }
  }

  // --- shared -------------------------------------------------------------------------

  /** A fresh detail opens with every local mirror and draft cleared. */
  reset(): void {
    this.busy.set(false);
    this.error.set(null);
    this.modelLocal.set(undefined);
    this.sheetOpen.set(false);
    this.otherOpen.set(false);
    this.otherDraft.set('');
    this.skillsLocal.set(null);
    this.draft.set(null);
    this.saved.set(null);
  }

  /** One PATCH with the shared busy/error handling; a refusal runs `revert`. */
  private async patch(patch: PersonaPatch, revert: () => void): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const reply = await this.deps.vm.patchPersona?.(patch);
      if (reply === undefined || reply.ok) {
        return true;
      }
      this.error.set(reply.error ?? this.deps.i18n.t('crew.pia.failed'));
    } catch {
      this.error.set(this.deps.i18n.t('crew.pia.failed'));
    } finally {
      this.busy.set(false);
    }
    revert();
    return false;
  }
}
