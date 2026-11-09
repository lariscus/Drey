/** Pure formatting helpers shared by the presenters (the window reads every string from the catalog). */
import type { I18n } from '../../../../../shared/i18n';

/** Joins the parts that are present with the window's dot separator. */
export function joinParts(parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' · ');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `08:12` or, with seconds, `08:12:03` — the local wall clock. Empty for a value that is no date. */
export function clock(iso: string, seconds = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const hm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return seconds ? `${hm}:${pad2(date.getSeconds())}` : hm;
}

/** `112k`, `4.1k`, `950` — compact, lower-case suffix as the boards draw it. */
export function compact(i18n: I18n, value: number): string {
  return i18n.formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 }).toLowerCase();
}

/** `$4.10`, `$15` — whole amounts without cents. */
export function money(i18n: I18n, amount: number): string {
  return i18n.formatNumber(amount, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  });
}

/** `e4b9…71c0`; a short reference stays whole. */
export function shortRef(ref: string): string {
  return ref.length <= 9 ? ref : `${ref.slice(0, 4)}…${ref.slice(-4)}`;
}

/** `Mon 09:00` — weekday and 24-hour time of an ISO instant. */
export function weekdayTime(i18n: I18n, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const weekday = new Intl.DateTimeFormat(i18n.locale, { weekday: 'short' }).format(date);
  return `${weekday} ${clock(iso)}`;
}

/** The first letter upper-cased: `ben` → `Ben`. */
export function capitalize(text: string): string {
  return text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** How long until `iso`, as `11 min` (none past it); empty for a value that is no date. */
export function spanUntil(i18n: I18n, iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  return Number.isNaN(then) ? '' : i18n.formatDuration(Math.max(0, then - nowMs));
}

/** How long ago `iso` was, as `4 min`; empty for a value that is no date. */
export function spanSince(i18n: I18n, iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  return Number.isNaN(then) ? '' : i18n.formatDuration(Math.max(0, nowMs - then));
}
