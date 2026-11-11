/** The live-run map (ADR-0075 run control; written from M84, validated now). */
export interface TicketRun {
  readonly pid: number;
  readonly 'started-at': string;
  readonly stream: string;
}
