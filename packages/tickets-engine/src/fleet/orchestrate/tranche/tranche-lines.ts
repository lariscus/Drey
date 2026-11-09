import type { CheckpointReport, EarlyStop, TrancheStatus } from '../../protocol';

const usd = (value: number): string => `$${value.toFixed(2)}`;

/** `tranche 2` or `tranche 2 of 3` (the day's budget holds three). */
const name = (status: Pick<TrancheStatus, 'index' | 'of'>): string => `tranche ${status.index}${status.of === null ? '' : ` of ${status.of}`}`;

const limitsOf = (status: TrancheStatus): string[] => [
  ...(status.total !== null ? [`${status.total} runs`] : []),
  ...(status.budget !== null ? [usd(status.budget)] : []),
  ...(status.endsAt !== null ? [`until ${status.endsAt}`] : []),
];

/** The runner log's line when a tranche is released. */
export function releasedLine(status: TrancheStatus): string {
  return `${name(status)} released · up to ${limitsOf(status).join(' or ')}`;
}

/** The line after each start: `tranche 4 of 10 runs · checkpoint in 6 runs`. */
export function startedLine(status: TrancheStatus): string {
  if (status.total === null) {
    return `${name(status)} · ${status.done} runs · ${usd(status.spent)}${status.budget === null ? '' : ` of ${usd(status.budget)}`}`;
  }
  const left = Math.max(0, status.total - status.done);
  return `tranche ${status.done} of ${status.total} runs · ${left === 0 ? 'checkpoint now' : `checkpoint in ${left} run${left === 1 ? '' : 's'}`}`;
}

/** The checkpoint at a tranche's end: `checkpoint: tranche 1 of 3 done — …`. */
export function checkpointLine(status: TrancheStatus, report: CheckpointReport): string {
  const gates = report.gates.total === 0 ? 'no gates' : `${report.gates.green} of ${report.gates.total} green`;
  const by = report.endedBy === null ? '' : ` (${report.endedBy === 'runs' ? 'runs released' : report.endedBy === 'budget' ? 'budget spent' : 'time span over'})`;
  return `checkpoint: ${name(status)} done${by} — ${report.runs} runs · ${usd(report.spent)} · ${report.minutes} min · ${gates} — the autopilot pauses until the next tranche is released`;
}

/** Why a tranche stopped early, as words for the log. */
export function earlyStopReason(stop: EarlyStop): string {
  switch (stop.rule) {
    case 'gate_rate':
      return `${stop.red} of the last ${stop.window} gates were red`;
    case 'same_ticket':
      return `${stop.ticket ?? 'a ticket'} was red ${stop.red} times`;
    case 'change_growth':
      return `${stop.ticket ?? 'a run'} changed ${stop.value ?? 0} lines, the tranche's median is ${stop.median ?? 0}`;
    case 'cost_outlier':
      return `${stop.ticket ?? 'a run'} cost ${usd(stop.value ?? 0)}, the tranche's median is ${usd(stop.median ?? 0)}`;
  }
}

/** `stopped early: 3 of the last 6 gates were red — the tranche had 6 runs left …`. */
export function earlyStopLine(stop: EarlyStop): string {
  const left = stop.runsLeft === null ? '' : ` — the tranche had ${stop.runsLeft} runs left`;
  return `stopped early: ${earlyStopReason(stop)}${left} — nothing new starts until the owner releases it`;
}
