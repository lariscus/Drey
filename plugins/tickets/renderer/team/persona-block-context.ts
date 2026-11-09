// i18n: catalog
/**
 * What a block of the Persona page gets from the page: the persona and the
 * data read beside it, the draft and the two ways to change it. A block
 * draws; the page owns the state, the load and the Save.
 */
import type { ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol-slots';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { PersonaView } from '../../shared/remote-protocol';
import type { DeskDeps } from '../desk-deps';
import type { VaultChoice } from './persona-allowed-model';
import type { Translate } from './persona-dom';
import type { PersonaDraft, personaPathsOf } from './persona-model';
import type { PersonaSkillsSeam, PromptPreviewSeam, SkillInfo } from './persona-seams';

/** What the page reads beside the record; each part may be missing (an engine without a runner, no vault). */
export interface PageExtras {
  readonly table: ModelsReply | null;
  readonly slots: readonly SlotView[];
  readonly vaults: readonly VaultChoice[];
  readonly skills: readonly SkillInfo[];
}

export interface BlockContext {
  readonly deps: DeskDeps;
  readonly api: DreyPluginApi;
  readonly t: Translate;
  readonly persona: PersonaView;
  readonly extras: PageExtras;
  readonly paths: ReturnType<typeof personaPathsOf>;
  readonly skillsSeam: PersonaSkillsSeam;
  readonly previewSeam: PromptPreviewSeam;
  /** The skills the record named when the page loaded (the Skills block keeps their rows). */
  readonly loadedSkills: readonly string[];
  draft(): PersonaDraft;
  /** Changes the draft without a repaint (typing); Save and Discard follow. */
  edit(next: Partial<PersonaDraft>): void;
  /** Changes the draft and rebuilds the blocks (a switch, a row added or moved). */
  change(next: Partial<PersonaDraft>): void;
}
