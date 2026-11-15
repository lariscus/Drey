// i18n: catalog
/**
 * The big pool as one chip in the board's header (req-271, board 7e v2; the
 * Capacity band merged into the board, owner 2026-11-11): `4/5 · 1 queued`.
 * Its popover holds what the band's lower rows held — the slots per account
 * with their quota and upgrade mark, the head of the pool's
 * queue and a minimum overrun — with Pause all and a link to the Service
 * window. The persona rows of the band are the column heads' load now.
 */
import type { BoardLane } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { ChainStatus, RunInfo } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { I18n } from '../../../../shared/i18n/types';
import { h, type DeskDeps } from './desk-deps';
import { queueWordsOf } from '../work/queue-line';
import { sessionCapacityOf, slotChipsOf } from '../team/capacity-model';
import { clockIconNode, slotChipNode } from '../team/capacity-view';
import { isLiveRun } from '../team/team-model';

/** What the chip and the popover count. */
export interface PoolFigures {
  readonly live: number;
  readonly total: number;
  readonly queued: number;
  /** Runs beyond the big pool on a persona's `min:`, and whose minimum allows them. */
  readonly overrun: { readonly runs: number; readonly personas: readonly string[] } | null;
}

/** The pool's figures from the runs and the chain status; `lanes` names the personas whose minimum overruns. */
export function poolFiguresOf(runs: readonly RunInfo[], chain: ChainStatus | null, lanes: readonly BoardLane[]): PoolFigures {
  const live = runs.filter(isLiveRun);
  const total = sessionCapacityOf(chain);
  const over = total > 0 ? live.length - total : 0;
  const minimum = lanes.filter((lane) => lane.min > 0 && live.some((run) => run.persona === lane.persona)).map((lane) => lane.title);
  return { live: live.length, total, queued: chain?.queue?.length ?? 0, overrun: over > 0 && minimum.length > 0 ? { runs: over, personas: minimum } : null };
}

/** `4/5 · 1 queued` (the chip); `2 running` while the pool's size is unknown. */
export function poolChipText(figures: PoolFigures, i18n: I18n): string {
  const base = figures.total > 0 ? i18n.t('board.pool.chip', { live: figures.live, total: figures.total }) : i18n.t('board.pool.chip_running', { live: figures.live });
  return figures.queued > 0 ? i18n.t('board.pool.with_queued', { status: base, queued: figures.queued }) : base;
}

/** `4 of 5 sessions · 1 queued` (the popover's head). */
function headText(figures: PoolFigures, i18n: I18n): string {
  const base = figures.total > 0 ? i18n.t('capacity.status.sessions', { live: figures.live, total: figures.total }) : i18n.t('capacity.status.running', { n: figures.live });
  return figures.queued > 0 ? i18n.t('capacity.status.with_queued', { status: base, queued: figures.queued }) : base;
}

function popoverNode(deps: DeskDeps, figures: PoolFigures, close: () => void): HTMLElement {
  const i18n = deps.api.i18n;
  const chain = deps.chain();
  const now = new Date();
  const pop = h('div', 'pb-pool-pop');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', i18n.t('capacity.title'));
  const head = h('div', 'pb-pool-head');
  const pause = h('button', 'icon-btn pb-pool-pause');
  pause.type = 'button';
  pause.title = i18n.t('capacity.pause_all_title');
  pause.setAttribute('aria-label', i18n.t('capacity.pause_all'));
  pause.append(deps.api.ui.icon('pause', 14));
  pause.addEventListener('click', () => void deps.chainAction('chainMaster', { mode: chain?.master === 'halted' ? 'run' : 'halted' }));
  head.append(h('b', 'pb-pool-title', i18n.t('capacity.title')), h('span', 'pb-pool-sub', headText(figures, i18n)), h('span', 'pb-grow'), pause);
  pop.append(head);
  const chips = slotChipsOf(chain?.slots);
  if (chips.length > 0) {
    const slots = h('div', 'pb-pool-slots');
    slots.append(...chips.map((chip) => slotChipNode(chip, i18n, now)));
    pop.append(slots);
  }
  const first = chain?.queue?.[0];
  if (first !== undefined) {
    const queue = h('div', 'pb-pool-queue');
    queue.append(clockIconNode(14), h('span', 'pb-pool-queue-text', i18n.t('board.pool.queue_head', { ticket: first.ticket, words: queueWordsOf(first, i18n).full })));
    pop.append(queue);
  }
  if (figures.overrun !== null) {
    pop.append(h('div', 'pb-pool-overrun', i18n.t('board.pool.overrun', { n: figures.overrun.runs, names: figures.overrun.personas.join(', ') })));
  }
  const link = h('button', 'pb-pool-link', i18n.t('board.pool.open_service'));
  link.type = 'button';
  link.addEventListener('click', () => {
    close();
    void deps.invoke('serviceControl', { target: 'window', action: 'open' });
  });
  pop.append(link);
  return pop;
}

/**
 * The chip with its popover. The popover's open state lives in the board view (it survives repaints), and
 * the view closes it on a click outside `.pb-pool` or on Escape; `toggle` flips it.
 */
export function poolChipNode(deps: DeskDeps, lanes: readonly BoardLane[], open: boolean, toggle: (open: boolean) => void): HTMLElement {
  const i18n = deps.api.i18n;
  const figures = poolFiguresOf(deps.runs(), deps.chain(), lanes);
  const wrap = h('div', 'pb-pool');
  const chip = h('button', `pb-btn pb-pool-chip${open ? ' pb-pool-chip-open' : ''}`, poolChipText(figures, i18n));
  chip.type = 'button';
  chip.title = i18n.t('capacity.title');
  chip.setAttribute('aria-label', i18n.t('capacity.title'));
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.setAttribute('aria-expanded', String(open));
  chip.addEventListener('click', () => toggle(!open));
  wrap.append(chip);
  if (open) {
    wrap.append(popoverNode(deps, figures, () => toggle(false)));
  }
  return wrap;
}
