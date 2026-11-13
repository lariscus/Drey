// i18n: catalog
/**
 * The Persona page's two columns (board 7k v4), composed from the blocks.
 * An agent: Profile, Work, Allowed to | tabs Instructions (editor, Skills,
 * Proposals) · Memory · 1:1. Mission Control's persona: Profile, Model,
 * Skills | the same tabs, Instructions being the editor alone. The page owns
 * the state and the repaint; this only assembles.
 */
import type { ImprovementProposal } from '../../../../packages/tickets-engine/src/core/improvements';
import { h } from '../desk-deps';
import { allowedBlock } from './persona-allowed-block';
import type { BlockContext } from './persona-block-context';
import { modelBlock } from './persona-model-block';
import type { PersonaReads } from './persona-page-load';
import type { InstructionsBlock } from './persona-instructions-block';
import { profileBlock } from './persona-profile-block';
import { proposalsBlock } from './persona-proposals-block';
import type { SkillsBlock } from './persona-skills-block';
import { tabPane, tabStrip, type PersonaTab } from './persona-tabs';
import { workBlock } from './persona-work-block';

export interface ColumnParts {
  readonly ctx: BlockContext;
  readonly reads: PersonaReads;
  readonly instructions: InstructionsBlock;
  readonly skills: SkillsBlock;
  readonly proposal: ImprovementProposal | null;
  readonly promptDirty: boolean;
  readonly tab: PersonaTab;
  readonly selectTab: (tab: PersonaTab) => void;
  readonly decide: (proposal: ImprovementProposal, decision: 'accepted' | 'dismissed') => void;
}

export interface Columns {
  readonly element: HTMLElement;
  readonly left: HTMLElement;
  readonly right: HTMLElement;
}

export function columnsOf(parts: ColumnParts): Columns {
  const { ctx, reads, tab } = parts;
  const mission = ctx.persona.kind === 'mission';
  const left = h('div', 'persona-left');
  const right = h('div', 'persona-right');
  if (mission) {
    left.append(profileBlock(ctx), modelBlock(ctx), parts.skills.element);
  } else {
    left.append(profileBlock(ctx), workBlock(ctx), allowedBlock(ctx));
  }
  right.append(tabStrip(ctx, { active: tab, memory: reads.memory, select: parts.selectTab, trailing: tab === 'instructions' ? parts.instructions.controls : [] }));
  if (tab !== 'instructions') {
    right.append(tabPane(ctx.deps, ctx.persona, tab));
  } else if (mission) {
    right.append(parts.instructions.element);
  } else {
    right.append(
      parts.instructions.element,
      parts.skills.element,
      proposalsBlock(ctx, { proposal: parts.proposal, memory: reads.memory, journal: reads.journal, promptDirty: parts.promptDirty, decide: parts.decide, openTab: parts.selectTab }),
    );
  }
  const element = h('div', 'persona-cols');
  element.append(left, right);
  return { element, left, right };
}
