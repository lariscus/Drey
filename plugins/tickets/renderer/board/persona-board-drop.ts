// i18n: catalog
/**
 * What a persona board view keeps per tab and how a dropped card becomes one
 * call (req-271): `dropOf` decides — a persona board move (`personaBoardMove`)
 * or the ordinary `transition` (Inbox ↔ Prioritized, Done).
 */
import type { DeskDeps } from './desk-deps';
import { dropOf } from './persona-board-model';

/** What the view keeps per Board tab. */
export interface PersonaBoardState {
  unfolded: boolean;
  poolOpen: boolean;
  readonly more: Set<string>;
}

export interface PersonaBoardContext {
  readonly deps: DeskDeps;
  readonly state: PersonaBoardState;
  readonly repaint: () => void;
}

/** Sends the drop of ticket `id` on column `target`. */
export async function dropCard(ctx: PersonaBoardContext, id: string, target: string): Promise<void> {
  const { deps } = ctx;
  const snap = deps.snapshot();
  const card = snap?.columns.flatMap((column) => column.tickets).find((candidate) => candidate.id === id) ?? null;
  if (snap === null || card === null) {
    return;
  }
  const configured = snap.columns.filter((column) => !column.unknown);
  const drop = dropOf(card, target, configured.length > 0 ? configured[configured.length - 1]!.phase.id : null);
  const i18n = deps.api.i18n;
  if (drop.kind === 'move') {
    await deps.mutate(i18n.t('board.busy.move', { id }), () => deps.invoke('personaBoardMove', drop.payload));
  } else if (drop.kind === 'transition') {
    await deps.mutate(i18n.t('board.busy.move', { id }), () => deps.invoke('transition', { id: drop.id, from: drop.from, to: drop.to }));
  }
}

