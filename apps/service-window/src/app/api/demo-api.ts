import type {
  ActionReply,
  ComponentAction,
  ComponentId,
  LogLine,
  NewSessionAsk,
  NewSessionOptionsReply,
  NewSessionReply,
  RunAction,
  ServiceSnapshot,
  ServiceWindowApi,
  ServiceWindowEvent,
  ServiceWindowTab,
  SessionRun,
  StreamEvent,
} from '../../../../../shared/service-window/contract';
import { DEMO_INSTRUCTION, demoLog, demoRuns, demoSessionOptions, demoSnapshot, demoStream } from './demo-data';

const OK: ActionReply = { ok: true };

/** The bridge stand-in for a plain browser and for specs: the boards' sample data, actions that succeed. */
export class DemoServiceWindowApi implements ServiceWindowApi {
  readonly calls: string[] = [];

  snapshot(): Promise<ServiceSnapshot> {
    return Promise.resolve(demoSnapshot());
  }

  runs(): Promise<readonly SessionRun[]> {
    return Promise.resolve(demoRuns());
  }

  stream(runId: string): Promise<readonly StreamEvent[]> {
    return Promise.resolve(runId === 'R-20261107T0833-c02e' ? demoStream() : []);
  }

  instruction(runId: string): Promise<string | null> {
    return Promise.resolve(runId === 'R-20261107T0833-c02e' ? DEMO_INSTRUCTION : null);
  }

  logTail(): Promise<readonly LogLine[]> {
    return Promise.resolve(demoLog());
  }

  component(id: ComponentId, action: ComponentAction): Promise<ActionReply> {
    this.calls.push(`component:${id}:${action}`);
    return Promise.resolve(OK);
  }

  run(runId: string, action: RunAction, text?: string): Promise<ActionReply> {
    this.calls.push(`run:${runId}:${action}${text === undefined ? '' : `:${text}`}`);
    return Promise.resolve(OK);
  }

  copyAttachCommand(runId: string): Promise<ActionReply> {
    this.calls.push(`copy:${runId}`);
    return Promise.resolve(OK);
  }

  openWorktree(runId: string): Promise<ActionReply> {
    this.calls.push(`worktree:${runId}`);
    return Promise.resolve(OK);
  }

  openDrey(): Promise<void> {
    this.calls.push('openDrey');
    return Promise.resolve();
  }

  sessionOptions(): Promise<NewSessionOptionsReply> {
    return Promise.resolve(demoSessionOptions());
  }

  sessionStart(ask: NewSessionAsk): Promise<NewSessionReply> {
    this.calls.push(`sessionStart:${ask.persona}:${ask.directory}`);
    return Promise.resolve({ ok: true, runId: 'S-ben-free' });
  }

  pickFolder(): Promise<string | null> {
    this.calls.push('pickFolder');
    return Promise.resolve('E:\\projects\\notes');
  }

  quitService(): Promise<ActionReply> {
    this.calls.push('quit');
    return Promise.resolve(OK);
  }

  windowControl(action: 'minimize' | 'maximize' | 'close'): void {
    this.calls.push(`window:${action}`);
  }

  onEvent(_listener: (event: ServiceWindowEvent) => void): () => void {
    return () => undefined;
  }

  onShowTab(_listener: (tab: ServiceWindowTab) => void): () => void {
    return () => undefined;
  }
}
