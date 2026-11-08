/** The time the runner sees (ADR-0096): injected, so a spec moves it instead of waiting. */
export interface Clock {
  now(): Date;
}

export const SYSTEM_CLOCK: Clock = { now: () => new Date() };

/** A function clock (the older `now?: () => Date` seams) as a {@link Clock}. */
export function clockOf(now: (() => Date) | undefined): Clock {
  return now === undefined ? SYSTEM_CLOCK : { now };
}
