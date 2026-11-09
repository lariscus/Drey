import type { QuestionAnswers } from '../protocol';
import type { RpcMessage } from './acp-client';
import { elicitationContent, elicitedForm, type ElicitedForm } from './acp-elicitation';
import { acpEmit, type AcpContext } from './acp-state';
import type { NormalizedEvent } from './contract';
import { formText } from './question-forms';

interface PendingForm {
  readonly rpcId: number | string;
  readonly form: ElicitedForm;
}

/**
 * The question forms an agent holds open for the owner (req-182): an
 * `elicitation/create` of mode `form` (opencode's `question` tool) is the
 * run's question wait; the owner's answers go back as `accept`, or the
 * owner's free text while it stands answers it in the form's own words —
 * a form without a free-text field is declined and the text rides as the
 * next turn.
 */
export class AcpForms {
  private readonly pending = new Map<string, PendingForm>();
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(private readonly ctx: AcpContext) {
    this.emit = acpEmit(ctx);
  }

  get open(): boolean {
    return this.pending.size > 0;
  }

  /** An `elicitation/create`: a form becomes the run's question; any other mode is declined. */
  onRequest(message: RpcMessage): void {
    const rpcId = message.id!;
    const params = message.params ?? {};
    const form = elicitedForm(params);
    if (params['mode'] !== 'form' || form.questions.length === 0) {
      this.ctx.acp.reply(rpcId, { result: { action: 'decline' } });
      return;
    }
    const key = String(rpcId);
    this.pending.set(key, { rpcId, form });
    this.emit({ kind: 'usage', turn: 'idle', waiting: { kind: 'question', text: formText(form.questions), requestId: key, questions: form.questions } });
  }

  answer(formId: string, answers: QuestionAnswers): boolean {
    const pending = this.pending.get(formId);
    if (pending === undefined) {
      return false;
    }
    this.pending.delete(formId);
    this.ctx.acp.reply(pending.rpcId, { result: { action: 'accept', content: elicitationContent(pending.form, answers) } });
    this.settled();
    return true;
  }

  /** The owner typed while a form stands: the text answers its first question, or the form is declined and the text rides next. */
  takeText(text: string): void {
    const first = [...this.pending.entries()][0];
    if (first === undefined) {
      return;
    }
    const [key, pending] = first;
    const head = pending.form.questions[0]!;
    if (pending.form.customKeys.has(head.key) || pending.form.questions.length === 1) {
      this.answer(key, { [head.key]: text });
      return;
    }
    this.pending.delete(key);
    this.ctx.acp.reply(pending.rpcId, { result: { action: 'decline' } });
    this.ctx.state.followUp = text;
    this.settled();
  }

  private settled(): void {
    this.emit({ kind: 'usage', turn: 'busy', waiting: null });
  }
}
