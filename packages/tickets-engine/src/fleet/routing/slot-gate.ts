import type { RunRequest, SlotView } from '../protocol';
import { slotEnv } from './slot';
import type { SlotRegistry } from './slot-registry';
import type { SlotReservations } from './slot-reservations';

/** What the gate needs of the registry. */
export type SlotDirectory = Pick<SlotRegistry, 'list' | 'find' | 'views' | 'announce'>;

/** Why a slot cannot take a run now; null when it can. */
function blocker(view: SlotView): string | null {
  if (view.state === 'needs-login') {
    return `${view.label} needs a login (${view.reason ?? 'refused'})`;
  }
  if (view.state === 'exhausted') {
    return `${view.label}: ${view.reason ?? 'quota spent'}`;
  }
  return view.total !== null && view.busy >= view.total ? `${view.label}: ${view.busy} of ${view.total} sessions busy` : null;
}

/**
 * The slot a run starts on (req-177) — the engine half of the profile rule:
 * a repository's profile (`profile:` in `_meta/repos.md`, default
 * `private`) is served only by a slot of that profile, never by the other,
 * not even as a fallback. Among the slots that can take the run the
 * preferred one wins (where the resumed session lives), else the first in
 * `service.json`'s order. Choosing by surplus is req-178, not here.
 */
export class SlotGate {
  constructor(
    private readonly registry: SlotDirectory,
    private readonly reservations: SlotReservations,
  ) {}

  bind(request: RunRequest, runId: string, prefer: string | null): { readonly id: string; readonly label: string } | { readonly refused: string } {
    const profile = request.profile ?? 'private';
    const ofProvider = this.registry.views().filter((view) => view.provider === request.provider);
    const candidates = ofProvider.filter((view) => view.profile === profile);
    if (candidates.length === 0) {
      const other = profile === 'work' ? 'private' : 'work';
      return {
        refused: `no ${profile} slot serves ${request.provider}: the repository is ${profile} and never runs on a ${other} slot — add a ${profile} slot for ${request.provider} to service.json`,
      };
    }
    const free = candidates.filter((view) => blocker(view) === null);
    const chosen = free.find((view) => view.id === prefer) ?? free[0];
    if (chosen === undefined) {
      return { refused: `no ${profile} ${request.provider} slot is free — ${candidates.map((view) => blocker(view)).join('; ')}` };
    }
    this.reservations.reserve(chosen.id, runId);
    this.registry.announce();
    return { id: chosen.id, label: chosen.label };
  }

  release(runId: string): void {
    if (this.reservations.release(runId) !== null) {
      this.registry.announce();
    }
  }

  envOf(slotId: string): Readonly<Record<string, string>> | undefined {
    const slot = this.registry.find(slotId);
    return slot === null ? undefined : slotEnv(slot);
  }
}
