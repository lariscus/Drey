import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import { allowanceStateOf, allowanceTitle } from './allowance';

describe('a Running row against the ticket allowance (req-186)', () => {
  it('stays grey below 70 %, orange from 70 %, red once it is used up', () => {
    expect(allowanceStateOf(1.7, 2.5)).toBeNull();
    expect(allowanceStateOf(1.75, 2.5)).toEqual({ level: 'near', share: 70 });
    expect(allowanceStateOf(2.05, 2.5)).toEqual({ level: 'near', share: 82 });
    expect(allowanceStateOf(2.5, 2.5)).toEqual({ level: 'over', share: 100 });
    expect(allowanceStateOf(2.61, 2.5)?.level).toBe('over');
  });

  it('has nothing to say without a cost or an allowance', () => {
    expect(allowanceStateOf(null, 2.5)).toBeNull();
    expect(allowanceStateOf(2, null)).toBeNull();
    expect(allowanceStateOf(2, 0)).toBeNull();
  });

  it('words the share as the board does', () => {
    expect(allowanceTitle({ level: 'near', share: 82 }, 2.5, i18n)).toBe('82 % of the $2.50 allowance for this ticket');
  });
});
