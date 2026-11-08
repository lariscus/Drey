import { MAX_ATTACHMENT_BYTES } from '../orchestrate/attachment-store';
import type { RunSupervisor } from '../orchestrate/run-supervisor';
import type { SupervisorSet } from '../orchestrate/supervisor-set';
import { questionAnswersOf, type RunRequest } from '../protocol';
import type { RouteContext, RouteGroup } from './route-context';

type Outcome = { readonly ok: boolean };

/** What a route does with the run's supervisor and the body; null = a bad request it answered itself. */
type RunAction = (supervisor: RunSupervisor, runId: string, body: Record<string, unknown>, ctx: RouteContext) => Promise<Outcome | null>;

const answerBadRequest = (ctx: RouteContext, error: string): null => {
  ctx.respond(400, { ok: false, error });
  return null;
};

/** The routes that act on one run by its id (body `runId`). */
const ACTIONS: Readonly<Record<string, RunAction>> = {
  '/stop': (s, id, body) => s.stop(id, typeof body['reason'] === 'string' ? body['reason'] : null),
  '/resume': (s, id) => s.resume(id),
  '/takeover': (s, id) => s.takeover(id),
  '/interrupt': (s, id) => s.interrupt(id),
  '/softpause': (s, id) => s.pauseAfterAction(id),
  '/release': (s, id) => s.release(id),
  '/send': (s, id, body) => s.send(id, String(body['text'] ?? '')),
  '/permission': (s, id, body, ctx) => {
    const decision = body['decision'];
    return decision === 'once' || decision === 'always' || decision === 'reject' ? s.answerPermission(id, decision) : Promise.resolve(answerBadRequest(ctx, 'decision must be once, always or reject'));
  },
  '/answer': (s, id, body, ctx) => {
    const answers = questionAnswersOf(body['answers']);
    return answers !== null ? s.answerQuestion(id, answers) : Promise.resolve(answerBadRequest(ctx, 'answers must map question keys to a string or a list of strings'));
  },
};

/** The runs, acted on: a start (routed by provider), and every action on a run (routed by its id). */
export class RunWriteRoutes implements RouteGroup {
  constructor(private readonly supervisors: SupervisorSet) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'POST') {
      return false;
    }
    if (ctx.pathname === '/start') {
      const request = (await ctx.body()) as RunRequest;
      const outcome = await this.supervisors.forProvider(request.provider).start(request);
      ctx.respond(outcome.ok ? 200 : 422, outcome);
      return true;
    }
    if (ctx.pathname === '/attach') {
      return this.attach(ctx);
    }
    const action = ACTIONS[ctx.pathname];
    if (action === undefined) {
      return false;
    }
    const body = (await ctx.body()) as Record<string, unknown>;
    const runId = String(body['runId'] ?? '');
    const supervisor = this.supervisors.ofRun(runId);
    if (supervisor === null) {
      ctx.respond(404, { ok: false, error: `unknown run "${String(body['runId'])}"` });
      return true;
    }
    const outcome = await action(supervisor, runId, body, ctx);
    if (outcome !== null) {
      ctx.respond(outcome.ok ? 200 : 422, outcome);
    }
    return true;
  }

  /** base64 of up to MAX_ATTACHMENT_BYTES, plus the JSON around it. */
  private async attach(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body(Math.ceil(MAX_ATTACHMENT_BYTES * 1.4) + 4096)) as { runId?: unknown; name?: unknown; data?: unknown };
    const runId = String(body.runId ?? '');
    const supervisor = this.supervisors.ofRun(runId);
    if (supervisor === null || typeof body.name !== 'string' || typeof body.data !== 'string') {
      ctx.respond(404, { ok: false, error: 'unknown run or bad attachment' });
      return true;
    }
    const outcome = await supervisor.attachFile(runId, body.name, body.data);
    ctx.respond(outcome.ok ? 200 : 422, outcome);
    return true;
  }
}
