/**
 * The plugin's unconfigured state (D-74): no registered vault carries a
 * tickets board yet, so Drey Service has not started and the engine client
 * has no endpoints. This is a state the plugin runs in, not a failure —
 * Settings → Tickets offers the setup, and everything that reaches the
 * engine before it exists answers with this error.
 */
export class UnconfiguredTicketsError extends Error {
  constructor() {
    super('No tickets vault is configured yet — set one up in Settings → Tickets.');
    this.name = 'UnconfiguredTicketsError';
  }
}

/** A registered vault the setup or the active-vault initialize names as the board's home. */
export interface TicketsVaultRef {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}
