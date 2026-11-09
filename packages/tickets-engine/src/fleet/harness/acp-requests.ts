import type { PermissionDecision, QuestionAnswers, WaitQuestion } from '../protocol';
import type { RpcMessage } from './acp-client';
import type { NormalizedEvent } from './contract';
import { permissionText } from './event-text';
import type { AcpForms } from './acp-forms';
import { acpEmit, acpText, type AcpContext } from './acp-state';
import type { AcpUpdateFold } from './acp-update-fold';

type AcpOption = { readonly optionId?: string; readonly name?: string; readonly kind?: string };

interface PendingRequest {
  readonly rpcId: number | string;
  readonly kind: 'permission' | 'question';
  readonly options: readonly AcpOption[];
}

/** The ACP permission option a decision maps to (by `kind`, then by id). */
function optionFor(options: readonly AcpOption[], decision: PermissionDecision): string | null {
  const kind = decision === 'once' ? 'allow_once' : decision === 'always' ? 'allow_always' : 'reject_once';
  const byKind = options.find((o) => o.kind === kind)?.optionId;
  return byKind ?? options.find((o) => o.optionId === (decision === 'once' ? 'approve_once' : decision === 'always' ? 'approve_always' : 'reject'))?.optionId ?? null;
}

/** The selected option as ACP's outcome, or a cancel. */
function outcome(optionId: string | null | undefined): Record<string, unknown> {
  return { outcome: optionId === null || optionId === undefined ? { outcome: 'cancelled' } : { outcome: 'selected', optionId } };
}

/** The tool a permission asks for, in one line: opencode's `name` + its title (`shell echo hi`), else Kimi's title. */
function permissionAction(toolCall: { name?: string; title?: string }): { action: string; resources: readonly string[] } {
  const name = acpText(toolCall.name);
  const title = acpText(toolCall.title);
  if (name !== '' && title !== '' && title !== name) {
    return { action: name, resources: [title] };
  }
  return { action: title !== '' ? title : name !== '' ? name : 'tool', resources: [] };
}

/**
 * The agent's own requests held open for the owner (req-64): an approval
 * (`session/request_permission`), a question of Kimi's AskUserQuestion tool
 * (a permission request in disguise), or a question form
 * (`elicitation/create`, opencode — `AcpForms`), reported as the run's wait
 * and answered — or declined to make room for the owner's free text, which
 * then rides as the next turn.
 */
export class AcpRequests {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: AcpContext,
    private readonly fold: AcpUpdateFold,
    private readonly forms: AcpForms,
  ) {
    this.emit = acpEmit(ctx);
  }

  get open(): boolean {
    return this.pending.size > 0 || this.forms.open;
  }

  onRequest(message: RpcMessage): void {
    const rpcId = message.id!;
    if (message.method === 'elicitation/create') {
      this.fold.flushThought();
      return this.forms.onRequest(message);
    }
    if (message.method !== 'session/request_permission') {
      this.ctx.acp.reply(rpcId, { error: { code: -32601, message: `${message.method ?? 'request'} is not supported` } });
      return;
    }
    const params = message.params ?? {};
    const options = (Array.isArray(params['options']) ? params['options'] : []) as readonly AcpOption[];
    const toolCall = (params['toolCall'] ?? {}) as { toolCallId?: string; name?: string; title?: string; content?: ReadonlyArray<{ content?: { text?: string } }> };
    const title = acpText(toolCall.title);
    const body = acpText(toolCall.content?.[0]?.content?.text).trim();
    const key = String(rpcId);
    this.fold.flushThought();
    if (title === 'AskUserQuestion') {
      const question = this.question(acpText(toolCall.toolCallId), body, options);
      this.pending.set(key, { rpcId, kind: 'question', options });
      this.emit({ kind: 'usage', turn: 'idle', waiting: { kind: 'question', text: question.question, requestId: key, questions: [question] } });
      return;
    }
    this.pending.set(key, { rpcId, kind: 'permission', options });
    const text = permissionText({ ...permissionAction(toolCall), message: body.replace(/^Requesting approval to\s*/i, '') });
    this.emit({ kind: 'usage', turn: 'idle', waiting: { kind: 'permission', text, requestId: key } });
  }

  answerPermission(requestId: string, decision: PermissionDecision): boolean {
    const request = this.pending.get(requestId);
    if (request === undefined || request.kind !== 'permission') {
      return false;
    }
    this.pending.delete(requestId);
    this.ctx.acp.reply(request.rpcId, { result: outcome(optionFor(request.options, decision)) });
    this.settled();
    return true;
  }

  /** A choice by its label; anything else declines the question and rides as the next turn. */
  answerQuestion(formId: string, answers: QuestionAnswers): boolean {
    if (this.forms.answer(formId, answers)) {
      return true;
    }
    const request = this.pending.get(formId);
    if (request === undefined || request.kind !== 'question') {
      return false;
    }
    const given = answers['q0'];
    const said = (Array.isArray(given) ? given[0] : given) ?? '';
    const choice = request.options.find((o) => o.kind !== 'reject_once' && acpText(o.name).toLowerCase() === said.toLowerCase());
    this.pending.delete(formId);
    if (choice?.optionId !== undefined) {
      this.ctx.acp.reply(request.rpcId, { result: outcome(choice.optionId) });
    } else {
      this.ctx.acp.reply(request.rpcId, { result: outcome(request.options.find((o) => o.kind === 'reject_once')?.optionId) });
      if (said.trim() !== '') {
        this.ctx.state.followUp = said.trim();
      }
    }
    this.settled();
    return true;
  }

  /** A held request stands while the owner types: decline it, the text rides as the next turn. */
  declineFor(text: string): void {
    if (this.forms.open) {
      return this.forms.takeText(text);
    }
    const first = [...this.pending.entries()][0];
    if (first === undefined) {
      return;
    }
    const [key, request] = first;
    this.pending.delete(key);
    this.ctx.acp.reply(request.rpcId, { result: outcome(request.options.find((o) => o.kind === 'reject_once')?.optionId) });
    this.ctx.state.followUp = text;
    this.settled();
  }

  private settled(): void {
    this.emit({ kind: 'usage', turn: 'busy', waiting: null });
  }

  private question(toolCallId: string, body: string, options: readonly AcpOption[]): WaitQuestion {
    const args = this.fold.argsOf(toolCallId);
    const asked = (Array.isArray(args?.['questions']) ? args['questions'] : []) as ReadonlyArray<{ header?: string; options?: ReadonlyArray<{ label?: string; description?: string }> }>;
    const described = new Map((asked[0]?.options ?? []).map((o) => [acpText(o.label), o.description]));
    const header = acpText(asked[0]?.header);
    return {
      key: 'q0',
      ...(header !== '' ? { header } : {}),
      question: body !== '' ? body : 'The worker asks you',
      options: options
        .filter((o) => o.kind !== 'reject_once' && acpText(o.name) !== '')
        .map((o) => {
          const description = described.get(acpText(o.name));
          return { label: acpText(o.name), ...(description !== undefined ? { description } : {}) };
        }),
      multiple: false,
    };
  }
}
