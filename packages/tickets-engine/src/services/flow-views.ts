/**
 * The flow editor's and the plan cards' views of a chain (req-266): pure
 * folds from the persona list plus the crew to what the surfaces render.
 * No IO — `BoardService` hands in the chain, the cursor and the personas.
 */
import type { ChainEntry } from '../contracts/chain';
import type { FlowPersona, FlowStepView } from '../contracts/flow';
import type { PartFlowStep } from '../contracts/plan-approval';
import type { BoardSnapshot, TicketCard } from '../contracts/tickets';
import { chainCursor, chainLifeOf, chainSteps, lockedCount } from '../core/chain-list';
import { isHumanPersona, type Persona } from '../core/persona';
import { deriveWorkerModel } from './persona-loader';

function modelOf(persona: Persona | undefined): string | null {
  return persona === undefined || isHumanPersona(persona) ? null : (deriveWorkerModel(persona).model ?? null);
}

/** How many leading positions of a ticket's chain are locked where it stands now. */
export function lockedOfCard(snap: BoardSnapshot, card: TicketCard, entries: readonly ChainEntry[]): number {
  const cursor = chainCursor(entries, card.meta.at, chainLifeOf(card.phase, snap.pipeline.map((p) => p.id)));
  return lockedCount(cursor, entries.length);
}

/** The positions from the current one on (past ones are not shown), each with who takes it. */
export function flowStepViews(entries: readonly ChainEntry[], locked: number, personas: readonly Persona[], readOnly: boolean): FlowStepView[] {
  return chainSteps(entries, locked === 0 ? null : locked)
    .filter((step) => step.state !== 'past')
    .map((step): FlowStepView => {
      const persona = personas.find((p) => p.id === step.persona);
      return {
        index: step.position - 1,
        position: step.position,
        persona: step.persona,
        title: persona?.title ?? step.persona,
        mode: step.mode,
        state: step.state === 'current' ? 'current' : 'future',
        notify: step.notify,
        model: modelOf(persona),
        owner: isHumanPersona(persona),
        missing: persona === undefined,
        locked: step.state === 'current' || readOnly,
      };
    });
}

/** A plan part's chain as its card row. */
export function partFlowSteps(entries: readonly ChainEntry[], personas: readonly Persona[]): PartFlowStep[] {
  return entries.map((entry, index) => ({
    position: index + 1,
    persona: entry.persona,
    title: personas.find((p) => p.id === entry.persona)?.title ?? entry.persona,
    notify: entry.notify,
  }));
}

/** The crew as the persona picker lists it. */
export function flowPersonasOf(personas: readonly Persona[]): FlowPersona[] {
  return personas.map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    color: p.color,
    model: modelOf(p) ?? '',
  }));
}

/** The text Paul reads before he drafts a flow: the standard flow, the flow now, the crew. */
export function flowDraftText(input: {
  readonly ticket: string;
  readonly title: string;
  readonly plan: string;
  readonly standard: readonly string[];
  readonly steps: readonly FlowStepView[];
  readonly saved: readonly string[];
  readonly personas: readonly FlowPersona[];
}): string {
  const crew = input.personas.map((p) => `- ${p.id} (${p.title}${p.kind === 'human' ? ', the owner' : ''})`).join('\n');
  const now = input.steps
    .map((s) => `${s.position}. ${s.persona}${s.mode === null ? '' : `:${s.mode}`}${s.notify ? ' (tell me)' : ''}${s.state === 'current' ? ' (current, locked)' : ''}`)
    .join('\n');
  const standard = input.standard.length === 0 ? '(none)' : input.standard.join('; ');
  return `Ticket ${input.ticket}: ${input.title}${input.plan}\n\nStandard flow: ${standard}\nThe chain now, from the current position:\n${now}\nSaved chain: ${input.saved.join('; ')}\n\nPersonas:\n${crew}`;
}
