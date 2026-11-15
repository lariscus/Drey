import type { Clock } from '../ports/clock';
import type { EventSink } from '../ports/event-sink';
import type { FileSystem } from '../ports/file-system';
import type { NormalizedEvent } from '../harness/contract';

/** What a stream line is written for: a run's folder. */
interface StreamOwner {
  readonly dir: string;
  readonly info: { readonly id: string };
}

/**
 * `runs/<id>/stream.jsonl`: the run's file-backed transcript anyone can
 * tail (Drey's watch view, a plain terminal). Every line is one
 * normalized event; the runner's own lines are notes.
 */
export class RunStreams {
  constructor(
    private readonly clock: Clock,
    private readonly fs: FileSystem,
    private readonly sink: EventSink,
  ) {}

  async open(run: StreamOwner, events: readonly NormalizedEvent[]): Promise<void> {
    await this.fs.writeText(this.fs.join(run.dir, 'stream.jsonl'), events.map((e) => `${JSON.stringify(e)}\n`).join(''));
    events.forEach((event) => this.sink.publish({ kind: 'line', runId: run.info.id, event }));
  }

  async append(run: StreamOwner, event: NormalizedEvent): Promise<void> {
    await this.fs.appendText(this.fs.join(run.dir, 'stream.jsonl'), `${JSON.stringify(event)}\n`);
    this.sink.publish({ kind: 'line', runId: run.info.id, event });
  }

  /** A note stamped now; `detail: 'runner'` marks the runner's own line (drawn as a system note, never a tool call). */
  async say(run: StreamOwner, text: string, detail?: 'runner'): Promise<void> {
    await this.append(run, { ts: this.clock.now().toISOString(), kind: 'note', ...(detail === undefined ? {} : { detail }), text });
  }
}
