/**
 * Which persona and tab the Crew tab shows when it is asked to: the
 * Persona page's links (Memory, Journal, Talk to … 1:1) open the Crew tab
 * on that persona's tab. The request waits here until a mounted Crew tab
 * takes it, or is handed to the one that is already mounted.
 */
export interface CrewFocus {
  readonly persona: string;
  readonly tab: 'Memory' | '1:1';
}

let pending: CrewFocus | null = null;
const listeners = new Set<(focus: CrewFocus) => void>();

/** Asks the Crew tab to show this persona's tab: now if one is mounted, else when it mounts. */
export function focusCrew(focus: CrewFocus): void {
  pending = focus;
  for (const listener of [...listeners]) {
    listener(focus);
  }
}

/** The waiting request, once; a mounted Crew tab that handled it through its listener has already taken it. */
export function takeCrewFocus(): CrewFocus | null {
  const focus = pending;
  pending = null;
  return focus;
}

export function onCrewFocus(listener: (focus: CrewFocus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forgets the waiting request and every listener: a spec that mounts the Crew tab many times starts clean. */
export function resetCrewFocus(): void {
  pending = null;
  listeners.clear();
}
