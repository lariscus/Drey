// i18n: catalog
/**
 * What a block of the Persona page gets from the page: the persona and the
 * data read beside it, the draft and the two ways to change it. A block
 * draws; the page owns the state, the load and the Save.
 */
import type { ChatModelsReply } from '../../../../packages/tickets-engine/src/contracts/chat-models';
import type { ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol-slots';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { PersonaView } from '../../shared/remote-protocol';
import type { DeskDeps } from '../desk-deps';
import type { VaultChoice } from './persona-allowed-model';
import type { Translate } from './persona-dom';
import type { PersonaDraft, personaPathsOf } from './persona-model';
import type { PersonaPreviewState } from './persona-preview-state';
import type { PersonaSkillsState } from './persona-skills-state';

/** What the page reads beside the record; each part may be missing (an engine without a runner, no vault). */
export interface PageExtras {
  readonly table: ModelsReply | null;
  readonly slots: readonly SlotView[];
  readonly vaults: readonly VaultChoice[];
  /** Mission Control's persona's Model block (req-293): the assistant's connection; null for the others or when the engine could not answer. */
  readonly chatModels: ChatModelsReply | null;
}

export interface BlockContext {
  readonly deps: DeskDeps;
  readonly api: DreyPluginApi;
  readonly t: Translate;
  readonly persona: PersonaView;
  readonly extras: PageExtras;
  readonly paths: ReturnType<typeof personaPathsOf>;
  /** The persona's skills as the engine lists them; the Skills block's switch, removal and upload act through it (req-237). */
  readonly skills: PersonaSkillsState;
  /** The brief a run would start with, counted by the engine (req-238). */
  readonly preview: PersonaPreviewState;
  draft(): PersonaDraft;
  /** Changes the draft without a repaint (typing); Save and Discard follow. */
  edit(next: Partial<PersonaDraft>): void;
  /** Changes the draft and rebuilds the blocks (a switch, a row added or moved). */
  change(next: Partial<PersonaDraft>): void;
}
