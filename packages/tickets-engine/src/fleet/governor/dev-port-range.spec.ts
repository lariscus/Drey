import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_PORTS } from '../protocol-governor';
import { devPortRangeOf } from './dev-port-range';

describe('devPortRangeOf', () => {
  it('reads governor.devPorts out of service.json', () => {
    expect(devPortRangeOf(JSON.stringify({ slots: [], governor: { devPorts: { from: 5100, to: 5199 } } }))).toEqual({ from: 5100, to: 5199 });
  });

  it('falls back to the default range for a missing file, a missing key, broken JSON or a bad range', () => {
    expect(devPortRangeOf(null)).toEqual(DEFAULT_DEV_PORTS);
    expect(devPortRangeOf('{"slots":[]}')).toEqual(DEFAULT_DEV_PORTS);
    expect(devPortRangeOf('{broken')).toEqual(DEFAULT_DEV_PORTS);
    expect(devPortRangeOf(JSON.stringify({ governor: { devPorts: { from: 5200, to: 5100 } } }))).toEqual(DEFAULT_DEV_PORTS);
    expect(devPortRangeOf(JSON.stringify({ governor: { devPorts: { from: 80, to: 90 } } }))).toEqual(DEFAULT_DEV_PORTS);
  });
});
