import type { RunnerProcess, SpawnFn } from '../ports/process-spawner';

/**
 * A scripted worker process for the contract suite: what the adapter
 * writes is recorded and handed to an `onInput` script (an ACP agent, the
 * stream-json CLI); closing its input ends it with 0, the tree-kill with
 * null — as a real CLI does.
 */
export class ContractProcess implements RunnerProcess {
  readonly pid = 4242;
  readonly writes: string[] = [];
  private stdout: (chunk: string) => void = () => undefined;
  private readonly exits: Array<(code: number | null) => void> = [];
  private exited = false;

  constructor(private readonly onInput: (text: string, proc: ContractProcess) => void = () => undefined) {}

  spawnFn(): SpawnFn {
    return () => this;
  }

  write(text: string): void {
    this.writes.push(text);
    this.onInput(text, this);
  }

  endInput(): void {
    queueMicrotask(() => this.exit(0));
  }

  async killTree(): Promise<void> {
    this.exit(null);
  }

  onStdout(cb: (chunk: string) => void): void {
    this.stdout = cb;
  }

  onStderr(): void {}

  onExit(cb: (code: number | null) => void): void {
    this.exits.push(cb);
  }

  /** One line on the process's stdout. */
  say(line: unknown): void {
    this.stdout(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`);
  }

  exit(code: number | null): void {
    if (!this.exited) {
      this.exited = true;
      [...this.exits].forEach((cb) => cb(code));
    }
  }
}
