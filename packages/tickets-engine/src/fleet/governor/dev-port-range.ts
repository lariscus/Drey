import { DEFAULT_DEV_PORTS, type PortRange } from '../protocol-governor';

const PORT_MIN = 1024;
const PORT_MAX = 65535;

const isPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= PORT_MIN && value <= PORT_MAX;

/**
 * The dev-server ports out of `service.json` (req-180): `"governor":
 * {"devPorts": {"from": 4300, "to": 4399}}`; anything missing or malformed
 * is the default range. Pure: the caller reads the file.
 */
export function devPortRangeOf(serviceJson: string | null): PortRange {
  try {
    const parsed = JSON.parse(serviceJson ?? '{}') as { governor?: { devPorts?: { from?: unknown; to?: unknown } } };
    const range = parsed.governor?.devPorts;
    return isPort(range?.from) && isPort(range?.to) && range.from <= range.to ? { from: range.from, to: range.to } : DEFAULT_DEV_PORTS;
  } catch {
    return DEFAULT_DEV_PORTS;
  }
}
