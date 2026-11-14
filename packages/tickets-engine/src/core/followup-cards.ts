/**
 * A run's follow-up proposals as Mission Control cards (req-299): the pure
 * half of the filing. The session is titled `Follow-ups from T-0012`, opens
 * with one mission line that names the run (the idempotency key — a session
 * that already says `Run R-… of T-…` is left alone), then carries one
 * pending `createTicket` card per proposal. This writes text only; a ticket
 * exists once the owner confirms a card (`ChatService.decide`).
 */
import type { ChatCommand } from '../contracts/chat';
import type { ProjectRecord } from '../contracts/projects';
import type { PriorityConfig } from '../contracts/tickets';
import { withCommandProject } from './chat-projects';
import { appendMission, appendProposal, newSessionText } from './chat-session';
import type { FollowupDraft } from './followups';

/** The session title a ticket's follow-ups are filed under. */
export function followupsTitle(ticket: string): string {
  return `Follow-ups from ${ticket}`;
}

/** The mission line that opens a run's cards; `runLinePrefix` is what a later look for the run searches. */
export function runLinePrefix(runId: string, ticket: string): string {
  return `Run ${runId} of ${ticket}`;
}

/** What a card takes from the source ticket and the board. */
export interface FollowupContext {
  readonly ticket: string;
  readonly runId: string;
  /** The source ticket's title, when the board still lists it. */
  readonly sourceTitle: string | null;
  /** The board's capture phase — the first of the pipeline. */
  readonly phase: string;
  readonly priorities: PriorityConfig;
  /** The source ticket's primary repo; null = none. */
  readonly repo: string | null;
  /** The source ticket's `project:`; null = none named. */
  readonly project: string | null;
  readonly projects: readonly Pick<ProjectRecord, 'id' | 'name'>[];
}

/** The card's command: capture phase, a priority of the board's vocabulary, the source's repo and project, the provenance line. */
export function followupCommand(draft: FollowupDraft, context: FollowupContext): ChatCommand {
  const priority = draft.priority !== null && context.priorities.order.includes(draft.priority) ? draft.priority : context.priorities.default;
  const origin = `Proposed by the worker of ${context.ticket} (run ${context.runId}).`;
  const command: ChatCommand = {
    kind: 'createTicket',
    title: draft.title,
    description: draft.why === '' ? origin : `${draft.why}\n\n${origin}`,
    priority,
    phase: context.phase,
    ...(context.repo === null ? {} : { repo: context.repo }),
  };
  return withCommandProject(command, context.projects, context.project);
}

/** The summary line a createTicket card shows (the chat service's wording). */
function summaryOf(command: Extract<ChatCommand, { kind: 'createTicket' }>): string {
  return `Create ticket "${command.title}" in ${command.phase}`;
}

/** The session file's whole text for these drafts; `now` stamps every line. */
export function followupSessionText(drafts: readonly FollowupDraft[], context: FollowupContext, now: Date): string {
  const count = drafts.length;
  const named = context.sourceTitle === null ? '' : ` (${context.sourceTitle})`;
  let text = newSessionText(followupsTitle(context.ticket), now);
  text = appendMission(
    text,
    now,
    `${runLinePrefix(context.runId, context.ticket)}${named} proposes ${String(count)} follow-up ${count === 1 ? 'ticket' : 'tickets'}. ` +
      'Nothing is created until you confirm a card.',
    null,
  );
  for (const draft of drafts) {
    const command = followupCommand(draft, context);
    if (command.kind === 'createTicket') {
      text = appendProposal(text, now, summaryOf(command), command).text;
    }
  }
  return text;
}
