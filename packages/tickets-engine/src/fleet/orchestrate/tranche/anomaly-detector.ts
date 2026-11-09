import type { EarlyStop, EarlyStopConfig } from '../../protocol';
import { changeOf, gated, median, redTickets } from './figures';
import type { RunFact } from './tranche-record';

/** What the rules look at: the tranche's facts since the last release, the newest last. */
export interface AnomalyInput {
  readonly facts: readonly RunFact[];
  /** The runs the tranche has left; null without a run limit. */
  readonly runsLeft: number | null;
}

const NONE: Pick<EarlyStop, 'ticket' | 'value' | 'median' | 'tickets'> = { ticket: null, value: null, median: null, tickets: [] };

/**
 * The early-stop rules (req-179): a falling gate rate (red gates over the
 * last K), the same ticket red again, a change far larger than the
 * tranche's median, a run far dearer than the median. Asked after every
 * settled run with the newest fact last; the first rule that fires wins.
 * Each threshold is config; null switches its rule off.
 */
export class AnomalyDetector {
  check(input: AnomalyInput, config: EarlyStopConfig): EarlyStop | null {
    return this.gateRate(input, config) ?? this.sameTicket(input, config) ?? this.outlier(input, config, 'change_growth') ?? this.outlier(input, config, 'cost_outlier');
  }

  private gateRate(input: AnomalyInput, config: EarlyStopConfig): EarlyStop | null {
    const newest = input.facts.at(-1);
    if (config.redGates === null || newest?.gate !== 'red') {
      return null;
    }
    const window = gated(input.facts).slice(-config.gateWindow);
    const red = window.filter((fact) => fact.gate === 'red').length;
    return red >= config.redGates ? { rule: 'gate_rate', red, window: window.length, runsLeft: input.runsLeft, ...NONE, tickets: redTickets(window, input.facts) } : null;
  }

  private sameTicket(input: AnomalyInput, config: EarlyStopConfig): EarlyStop | null {
    const newest = input.facts.at(-1);
    if (config.sameTicketRed === null || newest === undefined || newest.gate !== 'red') {
      return null;
    }
    const red = input.facts.filter((fact) => fact.ticket === newest.ticket && fact.gate === 'red').length;
    if (red < config.sameTicketRed) {
      return null;
    }
    const rows = redTickets(input.facts).filter((row) => row.ticket === newest.ticket);
    return { rule: 'same_ticket', red, window: gated(input.facts).length, runsLeft: input.runsLeft, ...NONE, ticket: newest.ticket, tickets: rows };
  }

  /** The newest run's figure against the median of the runs before it. */
  private outlier(input: AnomalyInput, config: EarlyStopConfig, rule: 'change_growth' | 'cost_outlier'): EarlyStop | null {
    const factor = rule === 'change_growth' ? config.changeFactor : config.costFactor;
    const figure = (fact: RunFact): number | null => (rule === 'change_growth' ? changeOf(fact) : fact.costUsd);
    const newest = input.facts.at(-1);
    const value = newest === undefined ? null : figure(newest);
    if (factor === null || newest === undefined || value === null) {
      return null;
    }
    const earlier = input.facts.slice(0, -1).map(figure).filter((v): v is number => v !== null);
    const mid = earlier.length >= config.minRuns ? median(earlier) : null;
    if (mid === null || mid <= 0 || value <= factor * mid) {
      return null;
    }
    return { rule, red: 0, window: gated(input.facts).length, runsLeft: input.runsLeft, ...NONE, ticket: newest.ticket, value, median: mid };
  }
}
