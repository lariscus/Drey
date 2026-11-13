// i18n: catalog
/**
 * Settings → Skills library: what the page holds and how it talks to the
 * engine (req-289). The library (`skillLibrary`), the filter and search, the
 * open Add from GitHub row, the row that asks before a removal, and the one
 * line that says what went wrong or what a fetch skipped. Every call goes
 * through `run`, which turns the engine's code into the catalog's sentence.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { MessageKey } from '../../../../shared/i18n/types';
import type { SkillLibraryData, SkillLibraryReply, SkillSourceReply } from '../../../../packages/tickets-engine/src/contracts/skill-library';
import { SKILL_ERROR_CODES, type SkillErrorCode, type SkillUploadCommand } from '../../../../packages/tickets-engine/src/contracts/skills';
import { personaPictures, type PictureNote } from '../team/persona-pictures';
import { uploadPlanOf, type PickedFile } from '../team/skill-upload-model';
import type { LibraryFilter } from './skills-library-model';

type Failure = { readonly ok: false; readonly code?: string; readonly error: string };
type Answer = SkillLibraryReply | SkillSourceReply | { readonly ok: true; readonly name: string } | Failure | null | undefined;

const isCode = (code: unknown): code is SkillErrorCode => typeof code === 'string' && (SKILL_ERROR_CODES as readonly string[]).includes(code);

export class SkillsLibraryState {
  library: SkillLibraryData | null = null;
  filter: LibraryFilter = 'all';
  query = '';
  /** The Add from GitHub row is open. */
  adding = false;
  /** A call runs: the buttons wait. */
  busy = false;
  /** The refusal or what a fetch skipped; '' = nothing to say. */
  note = '';
  /** The row that asks before it goes: `source:<id>` or `skill:<key>`; null = none. */
  confirming: string | null = null;
  private looked = false;

  constructor(
    readonly api: DreyPluginApi,
    readonly changed: () => void,
  ) {}

  readonly t = (key: MessageKey, params?: Parameters<DreyPluginApi['i18n']['t']>[1]): string => this.api.i18n.t(key, params);

  /** The page's reads; the first one also looks for newer refs of the sources (the owner opened the page). */
  async load(): Promise<void> {
    const check = !this.looked;
    this.looked = true;
    // the Used by circles draw the personas' pictures: the persona list says which have one
    const [list, answer] = await Promise.all([
      (this.api.backend.invoke('personas') as Promise<unknown>).catch(() => null),
      (this.api.backend.invoke('skillLibrary', { check }) as Promise<SkillLibraryReply | null>).catch(() => null),
    ]);
    if (Array.isArray(list)) {
      personaPictures.note(list as PictureNote[]);
    }
    const reply = answer ?? null;
    if (reply?.ok === true) {
      this.library = reply.library;
    } else if (this.library === null) {
      this.note = reply === null ? this.t('tickets.settings.skills.offline') : this.failureText(reply);
    }
    this.changed();
  }

  fetchSource(command: { readonly repo: string; readonly path: string; readonly ref: string }): Promise<boolean> {
    return this.run('skillSourceFetch', command);
  }

  updateSource(source: string, to: string): Promise<boolean> {
    return this.run('skillSourceUpdate', { source, to });
  }

  removeSource(source: string): Promise<boolean> {
    return this.run('skillSourceRemove', { source });
  }

  deleteSkill(name: string, persona: string | null): Promise<boolean> {
    return this.run('skillDelete', persona === null ? { name } : { name, persona });
  }

  /** Upload skill…: a picked file, zip or folder into the shared pool (the persona page's pick, milestone 232). */
  async upload(kind: 'file' | 'folder', files: readonly PickedFile[]): Promise<boolean> {
    const plan = await uploadPlanOf(kind, files);
    if (!plan.ok) {
      this.note = this.t(`skills.error.${plan.code}`);
      this.changed();
      return false;
    }
    const command: SkillUploadCommand = { ...plan.command, scope: 'shared' };
    return this.run('skillUpload', command);
  }

  private async run(method: string, payload: unknown): Promise<boolean> {
    this.busy = true;
    this.note = '';
    this.changed();
    let answer: Answer;
    try {
      answer = (await this.api.backend.invoke(method, payload)) as Answer;
    } catch (failure) {
      answer = { ok: false, error: failure instanceof Error ? failure.message : String(failure) };
    }
    this.busy = false;
    if (answer === null || answer === undefined) {
      this.note = this.t('tickets.settings.skills.offline');
    } else if (!answer.ok) {
      this.note = this.failureText(answer);
    } else if ('library' in answer) {
      this.library = answer.library;
      this.note = this.skippedText(answer);
    } else {
      await this.load();
    }
    const accepted = answer?.ok === true;
    this.confirming = null;
    this.changed();
    return accepted;
  }

  private skippedText(answer: SkillLibraryReply | SkillSourceReply): string {
    if (!answer.ok || !('skipped' in answer)) {
      return '';
    }
    const skipped = answer.skipped.length === 0 ? '' : this.t('tickets.settings.skills.skipped', { count: answer.skipped.length, folders: answer.skipped.map((skip) => skip.folder).join(', ') });
    return [skipped, answer.warning ?? ''].filter((line) => line !== '').join(' ');
  }

  private failureText(failure: Failure): string {
    return isCode(failure.code) ? this.t(`skills.error.${failure.code}`) : failure.error;
  }
}
