import type { ChatChangePayload } from '../contracts/remote-protocol';
import type { PathsChange } from './drey-port';
import type { Engine } from './engine-types';
import type { EngineParts } from './engine-parts';
import type { FileConfigStore } from './file-config';
import type { InvokeServer } from './invoke-server';
import type { InvokeTable } from './invoke-table';
import type { RemoteStatus } from './service';

export interface RunningEngineDeps {
  readonly invokeUrl: string;
  readonly token: string;
  readonly config: FileConfigStore;
  readonly parts: EngineParts;
  readonly table: InvokeTable;
  readonly server: InvokeServer;
}

/**
 * The engine once it listens: the invoke channel, the live events, the
 * paths channel, and the orderly stop. Nothing is composed here — the parts
 * come ready from `engine.ts`.
 */
export class RunningEngine implements Engine {
  readonly invokeUrl: string;
  readonly token: string;
  readonly config: FileConfigStore;
  readonly ready: Promise<void>;
  private closed = false;

  constructor(private readonly deps: RunningEngineDeps) {
    this.invokeUrl = deps.invokeUrl;
    this.token = deps.token;
    this.config = deps.config;
    this.ready = deps.parts.verify.startupWork;
  }

  invoke(method: string, payload?: unknown): Promise<unknown> {
    return this.deps.table.call(method, payload);
  }

  onEvent(listener: (what: 'board' | 'fleet' | 'remote' | 'chat', payload?: ChatChangePayload) => void): () => void {
    return this.deps.parts.board.hub.subscribe((what, payload) => listener(what, payload));
  }

  onPaths(listener: (change: PathsChange) => void): () => void {
    return this.deps.parts.board.hub.subscribePaths(listener);
  }

  emitPaths(change: PathsChange): void {
    this.deps.parts.board.hub.emitPaths(change);
  }

  dreyClients(): number {
    return this.deps.parts.board.presence.connected;
  }

  remoteStatus(): RemoteStatus {
    return this.deps.parts.remote.remoteService.status();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const { board, verify, remote, learning } = this.deps.parts;
    board.presence.dispose();
    board.fleet.dispose();
    learning.stopSettling();
    learning.improvements.dispose();
    verify.verify.dispose();
    board.board.dispose();
    await remote.remoteService.stop();
    await verify.startupWork;
    await board.board.idle();
    await board.git.idle();
    await this.deps.server.close();
  }
}
