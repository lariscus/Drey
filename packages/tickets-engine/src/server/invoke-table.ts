/** One invoke method: the channel carries a single object payload. */
export type InvokeMethod = (payload: unknown) => Promise<unknown>;

/**
 * The invoke channel's method table: the service instances behind an
 * explicit allowlist (ADR-0088). A name registered later wins.
 */
export class InvokeTable {
  private readonly methods = new Map<string, InvokeMethod>();

  /** Registers the named methods an object carries; a name it lacks is skipped. */
  register(target: object, names: readonly string[]): void {
    for (const name of names) {
      const fn = (target as Record<string, (input?: unknown) => unknown>)[name];
      if (typeof fn === 'function') {
        this.methods.set(name, (payload) => Promise.resolve(fn.call(target, payload)));
      }
    }
  }

  set(name: string, method: InvokeMethod): void {
    this.methods.set(name, method);
  }

  has(name: string): boolean {
    return this.methods.has(name);
  }

  call(name: string, payload?: unknown): Promise<unknown> {
    const method = this.methods.get(name);
    return method === undefined ? Promise.reject(new Error(`no such method: ${name}`)) : method(payload);
  }
}
