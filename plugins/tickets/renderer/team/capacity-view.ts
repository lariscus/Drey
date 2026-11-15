// i18n: catalog
/**
 * The Capacity band (E13-8, board 7e; the Slots and queue rows
 * milestone 218): a dock panel in the bottom dock - what each persona is
 * doing right now, today's cost against the budget, Pause all and "Open
 * Team", then one chip per slot (account) with its busy dots, quota and
 * reset, then the queue. The same model as the Team tab
 * (`team-model.ts`); the band is the glance, the tab the detail.
 */
import { h } from '../board/desk-deps';
import { resetTextOf, type SlotChipModel } from './capacity-model';
import type { I18n } from '../../../../shared/i18n/types';

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

/** Dots: one per session, filled while busy. */
function dotsNode(busy: readonly boolean[]): HTMLElement {
  const dots = h('span', 'desk-cap-slots');
  for (const filled of busy) {
    dots.append(h('span', `desk-cap-slot${filled ? ' desk-cap-slot-busy' : ''}`));
  }
  return dots;
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

/** The clock the pool popover's queue line starts with (the board's own shape; the base icon set has none). */
export function clockIconNode(size: number): SVGSVGElement {
  return iconNode(CLOCK, size, 1.75);
}
