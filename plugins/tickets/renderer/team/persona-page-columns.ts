// i18n: catalog
/**
 * The Persona page's two columns (board 7k v3 `DeskPersonaV3`, the tabs of
 * v4), composed from the blocks. An agent: Profile, Model, Work, Allowed to,
 * Skills, Proposals | tabs Instructions · Memory · 1:1, Instructions being
 * the editor filling the column (req-288). Mission Control's persona: Profile,
 * Model, Skills | the same tabs. The page owns
 * the state and the repaint; this only assembles.
 */
import type { ImprovementProposal } from '../../../../packages/tickets-engine/src/core/persona/improvements';
import { h } from '../board/desk-deps';
import { allowedBlock } from './persona-allowed-block';
import type { BlockContext } from './persona-block-context';
import { classModelBlock } from './persona-class-block';
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
    const proposals = proposalsBlock(ctx, { proposal: parts.proposal, memory: reads.memory, journal: reads.journal, promptDirty: parts.promptDirty, decide: parts.decide, openTab: parts.selectTab });
    left.append(profileBlock(ctx), classModelBlock(ctx), workBlock(ctx), allowedBlock(ctx), parts.skills.element, ...(proposals === null ? [] : [proposals]));
  }
  right.append(tabStrip(ctx, { active: tab, memory: reads.memory, select: parts.selectTab, trailing: tab === 'instructions' ? parts.instructions.controls : [] }));
  right.append(tab !== 'instructions' ? tabPane(ctx.deps, ctx.persona, tab) : parts.instructions.element);
  const element = h('div', 'persona-cols');
  element.append(left, right);
  return { element, left, right };
}
