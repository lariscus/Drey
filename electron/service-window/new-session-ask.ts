import type { NewSessionAsk } from '../../shared/service-window/contract';

const PERMISSIONS: ReadonlySet<string> = new Set(['read-only', 'accept-edits', 'bypass']);
const CLASSES: ReadonlySet<string> = new Set(['A', 'B', 'C']);

/** The form's ask, checked field by field; null when it is not one. The engine checks the folder itself. */
export function newSessionAskOf(value: unknown): NewSessionAsk | null {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const { persona, directory, poolClass, permissionMode, firstLine } = raw;
  if (typeof persona !== 'string' || persona === '' || typeof directory !== 'string' || directory.trim() === '') {
    return null;
  }
  if (poolClass !== null && !CLASSES.has(String(poolClass))) {
    return null;
  }
  if (!PERMISSIONS.has(String(permissionMode)) || (firstLine !== undefined && (typeof firstLine !== 'string' || firstLine.length > 100_000))) {
    return null;
  }
  const line = typeof firstLine === 'string' && firstLine.trim() !== '' ? { firstLine } : {};
  return { persona, directory: directory.trim(), poolClass: poolClass as NewSessionAsk['poolClass'], permissionMode: permissionMode as NewSessionAsk['permissionMode'], ...line };
}
