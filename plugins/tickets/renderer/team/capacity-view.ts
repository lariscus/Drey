// i18n: catalog
/**
 * The Capacity band (E13-8, board 7e; the Slots and Tranche-and-queue rows
 * milestone 218): a dock panel in the bottom dock - what each persona is
 * doing right now, today's cost against the budget, Pause all and "Open
 * Team", then one chip per slot (account) with its busy dots, quota and
 * reset, then the tranche and the queue. The same model as the Team tab
 * (`team-model.ts`); the band is the glance, the tab the detail.
 */
import { h, textButton, type DeskDeps } from '../desk-deps';
import {
  queueHeadOf,
  queuedIdsOf,
  resetTextOf,
  slotChipsOf,
  trancheOf,
  type SlotChipModel,
  type TrancheModel,
} from './capacity-model';
import { teamModelOf, usd, usdBudget, type PersonaCardModel } from './team-model';
import type { TeamStore } from './team-store';
import type { I18n } from '../../../../shared/i18n/types';
import { spanText } from '../../../../shared/tranche';

const TICK_MS = 15_000;

/** The tab identity the band belongs to (board 7e); the Crew tab (7f) shows none. */
const BAND_TABS: readonly string[] = ['board://all'];

/** The band shows only while the Board tab is the active one; in a note, a ticket or the Crew tab it would only be noise. */
export function bandShownFor(activePath: string | null): boolean {
  return activePath !== null && BAND_TABS.includes(activePath);
}

/** What one persona is doing, in a short line: idle, the ticket it works, why it stands. */
export function personaLineOf(card: PersonaCardModel, i18n: I18n): string {
  if (card.state === 'idle') {
    return i18n.t('capacity.persona.idle');
  }
  if (card.state === 'paused') {
    return i18n.t('capacity.persona.paused');
  }
  const run = card.runs.find((entry) => entry.stuck) ?? card.runs.find((entry) => entry.waiting) ?? card.runs[0];
  if (run === undefined) {
    return card.stateWord;
  }
  const params = { ticket: run.ticketId, more: card.runs.length - 1 };
  if (run.waiting && !run.stuck) {
    return i18n.t('capacity.persona.waits', params);
  }
  if (run.stuck && run.quietMinutes !== null) {
    return i18n.t('capacity.persona.stuck_for', { ...params, duration: i18n.formatDuration(run.quietMinutes * 60_000) });
  }
  return i18n.t(run.stuck ? 'capacity.persona.stuck' : 'capacity.persona.works', params);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One shape of a hand-drawn icon: a path, or a circle. */
type IconShape = { readonly d: string } | { readonly cx: number; readonly cy: number; readonly r: number };

/** An icon the base set has no name for, drawn from the board's own shapes (plain DOM, `currentColor` stroke). */
function iconNode(shapes: readonly IconShape[], size: number, strokeWidth: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of shapes) {
    const node = document.createElementNS(SVG_NS, 'd' in shape ? 'path' : 'circle');
    for (const [name, value] of Object.entries(shape)) {
      node.setAttribute(name, String(value));
    }
    svg.append(node);
  }
  return svg;
}

const REFRESH: readonly IconShape[] = [{ d: 'M20 12a8 8 0 1 1-2.5-5.8' }, { d: 'M20 4v5h-5' }];
const CHEVRON_UP: readonly IconShape[] = [{ d: 'M6 15l6-6 6 6' }];
const CLOCK: readonly IconShape[] = [{ cx: 12, cy: 12, r: 9 }, { d: 'M12 7v5l3 2' }];

/** A persona's avatar as the band draws it: initials on the persona colour, an orange dot while it is stuck. */
function avatarNode(card: PersonaCardModel, i18n: I18n): HTMLElement {
  const avatar = h('span', 'desk-cap-avatar', card.initials);
  avatar.style.setProperty('--persona-color', card.color);
  if (card.state === 'stuck') {
    const dot = h('span', 'desk-cap-stuckdot');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', i18n.t('capacity.persona.stuck_label'));
    avatar.append(dot);
  }
  return avatar;
}

/** Dots: one per session, filled while busy. */
function dotsNode(busy: readonly boolean[]): HTMLElement {
  const dots = h('span', 'desk-cap-slots');
  for (const filled of busy) {
    dots.append(h('span', `desk-cap-slot${filled ? ' desk-cap-slot-busy' : ''}`));
  }
  return dots;
}

/** Persona dots: one filled per live run (the persona's slot total needs an engine count, E13-19). */
function personaDots(card: PersonaCardModel): HTMLElement {
  const total = Math.max(1, card.runs.length);
  return dotsNode(Array.from({ length: total }, (_, i) => i < card.runs.length));
}

function noteWord(chip: SlotChipModel, i18n: I18n): string {
  switch (chip.note) {
    case 'needs-login':
      return i18n.t('capacity.slot.needs_login');
    case 'exhausted':
      return i18n.t('capacity.slot.exhausted');
    default:
      return i18n.t('capacity.slot.unknown');
  }
}

/** One slot's chip: name, dots, then the share with its bar (or the state word), q with the upgrade mark, the reset. */
export function slotChipNode(chip: SlotChipModel, i18n: I18n, now: Date): HTMLElement {
  const node = h('span', 'desk-slot');
  node.dataset['slot'] = chip.id;
  const reset = chip.resetsAt === null ? null : resetTextOf(chip.resetsAt, now, i18n.locale);
  if (reset !== null) {
    node.title = i18n.t('capacity.slot.resets', { when: reset });
  } else if (chip.note === 'unknown') {
    node.title = i18n.t('capacity.slot.quota_unknown');
  }
  node.append(h('span', 'desk-slot-name', chip.label), dotsNode(chip.dots));
  if (chip.bar === null) {
    node.append(h('span', `desk-slot-note${chip.note === 'unknown' ? '' : ' desk-slot-note-attention'}`, noteWord(chip, i18n)));
  } else {
    const quota = h('span', 'desk-slot-quota');
    const track = h('span', 'desk-slot-bar');
    const fill = h('span', `desk-slot-fill${chip.bar.estimated ? ' desk-slot-fill-estimated' : ''}`);
    fill.style.width = `${chip.bar.share}%`;
    track.append(fill);
    quota.append(track, h('span', 'desk-slot-share', i18n.t('capacity.slot.share', { share: i18n.formatNumber(chip.bar.share) })));
    node.append(quota);
  }
  if (chip.q !== null) {
    const q = h('span', 'desk-slot-q', i18n.t('capacity.slot.q', { q: i18n.formatNumber(chip.q, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
    if (chip.upgrade) {
      const mark = iconNode(CHEVRON_UP, 12, 2);
      mark.classList.add('desk-slot-upgrade');
      mark.removeAttribute('aria-hidden');
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', i18n.t('capacity.slot.upgrade'));
      q.append(mark);
    }
    node.append(q);
  }
  if (reset !== null) {
    const when = h('span', 'desk-slot-reset');
    when.append(iconNode(REFRESH, 12, 1.75), document.createTextNode(reset));
    node.append(when);
  }
  return node;
}

/** The tranche's one line and its progress bar (the row's left part). */
export function trancheNodes(tranche: TrancheModel, i18n: I18n): readonly HTMLElement[] {
  const t = i18n.t as (key: string, params?: Record<string, string | number>) => string;
  const params = {
    index: tranche.index,
    n: tranche.runs,
    total: tranche.size ?? 0,
    cost: usd(tranche.cost),
    budget: usdBudget(tranche.budget ?? 0),
    runs: tranche.runsLeft ?? 0,
    time: tranche.msLeft === null ? '' : spanText(tranche.msLeft, (key, p) => i18n.t(key, p)),
  };
  const shape = (tranche.size === null ? '' : 'r') + (tranche.budget === null ? '' : 'b') + (tranche.msLeft === null ? '' : 't');
  const text = h(
    'span',
    'desk-tranche-text',
    shape === 'rbt' ? t('capacity.tranche.line', params) : t('capacity.tranche.line_short', { ...params, shape }),
  );
  const bar = h('span', 'desk-tranche-bar');
  const fill = h('span', 'desk-tranche-fill');
  fill.style.width = `${Math.round(tranche.progress * 100)}%`;
  bar.append(fill);
  return [text, bar];
}

/** The queue (the row's right part): a clock, the ticket next in line, its place. */
export function queueNode(ticketId: string, position: number, i18n: I18n): HTMLElement {
  const queue = h('span', 'desk-queue');
  queue.append(
    iconNode(CLOCK, 14, 1.75),
    h('span', 'desk-queue-text', i18n.t('capacity.queue.line', { ticket: ticketId, position: i18n.t('capacity.queue.position', { n: position }) })),
  );
  return queue;
}

export function mountCapacity(deps: DeskDeps, store: TeamStore, host: HTMLElement, openTeam: () => void): () => void {
  const i18n = deps.api.i18n;
  const root = h('div', 'desk-capacity');
  host.append(root);
  let frame = 0;

  const personaRow = (model: ReturnType<typeof teamModelOf>): HTMLElement => {
    const row = h('div', 'desk-cap-persons');
    for (const card of model.personas) {
      const person = h('button', `desk-cap-person desk-cap-${card.state}`);
      person.type = 'button';
      person.dataset['persona'] = card.id;
      person.title = i18n.t('capacity.persona.title', { name: card.title, line: personaLineOf(card, i18n) });
      person.addEventListener('click', openTeam);
      const text = h('span', 'desk-cap-text');
      const nameLine = h('span', 'desk-cap-nameline');
      nameLine.append(h('span', 'desk-cap-name', card.title), personaDots(card));
      text.append(nameLine, h('span', 'desk-cap-line', personaLineOf(card, i18n)));
      person.append(avatarNode(card, i18n), text);
      row.append(person);
    }
    if (store.loaded() && model.personas.length === 0) {
      row.append(h('span', 'desk-cap-line', i18n.t('capacity.persona.none')));
    }
    row.append(h('span', 'desk-cap-sep'));
    if (model.todayCost !== null) {
      const budget = h('div', 'desk-cap-budget');
      const line = h('div', 'desk-cap-budget-row');
      const cost = usd(model.todayCost);
      line.append(
        h('span', 'desk-cap-budget-label', i18n.t('capacity.budget.label')),
        h(
          'span',
          'desk-cap-today',
          model.todayBudget === null
            ? i18n.t('capacity.budget.today', { cost })
            : i18n.t('capacity.budget.today_of', { cost, budget: usdBudget(model.todayBudget) }),
        ),
      );
      budget.append(line);
      if (model.todayBudget !== null && model.todayBudget > 0) {
        const bar = h('span', 'desk-bar');
        const fill = h('span', 'desk-bar-fill');
        fill.style.width = `${Math.min(100, Math.round((model.todayCost / model.todayBudget) * 100))}%`;
        bar.append(fill);
        budget.append(bar);
      }
      row.append(budget);
    }
    row.append(textButton(i18n.t('capacity.crew'), 'desk-btn desk-cap-crew', i18n.t('capacity.crew_title'), openTeam));
    return row;
  };

  const render = (): void => {
    frame = 0;
    root.hidden = !bandShownFor(deps.api.documents.active()?.path ?? null);
    if (root.hidden) {
      return;
    }
    const now = new Date();
    const runs = deps.runs();
    const chain = deps.chain();
    const model = teamModelOf(store.personas(), runs, chain, deps.titleOf, now.getTime());

    const slotRow = h('div', 'desk-cap-slotrow');
    slotRow.append(...slotChipsOf(chain?.slots).map((chip) => slotChipNode(chip, i18n, now)));

    const queueRow = h('div', 'desk-cap-queuerow');
    const tranche = trancheOf(chain, now);
    if (tranche !== null) {
      queueRow.append(...trancheNodes(tranche, i18n));
    }
    queueRow.append(h('span', 'desk-cap-queue-gap'));
    const head = queueHeadOf(queuedIdsOf(deps.snapshot(), runs));
    if (head !== null) {
      queueRow.append(queueNode(head.ticketId, head.position, i18n));
    }
    root.replaceChildren(personaRow(model), slotRow, queueRow);
  };

  const schedule = (): void => {
    if (frame === 0) {
      frame = window.requestAnimationFrame(render);
    }
  };
  const offStore = store.subscribe(schedule);
  const offDeps = deps.subscribe(schedule);
  const offDocs = deps.api.documents.onChange((event) => {
    if (event.type === 'active-changed' || event.type === 'docs-changed') {
      schedule();
    }
  });
  const tick = setInterval(schedule, TICK_MS);
  render();
  return () => {
    offStore();
    offDeps();
    offDocs();
    clearInterval(tick);
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
    }
    root.remove();
  };
}
