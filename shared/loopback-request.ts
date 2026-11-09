/**
 * The loopback guard of a local MCP endpoint (ADR-0021): binding to
 * 127.0.0.1 does not keep a web page out — a browser on this machine can
 * reach it too. So every request must carry a local `Host`, and an `Origin`
 * (which only a browser sends) must be local as well. Shared by Drey's own
 * MCP server and Drey Service's vault MCP (req-167).
 */

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Whether a `Host` header names this machine on the endpoint's port. */
export function isLocalHost(host: string | undefined, port: number | null): boolean {
  if (host === undefined) {
    return false;
  }
  const cut = host.lastIndexOf(':');
  const name = cut > 0 && !host.endsWith(']') ? host.slice(0, cut) : host;
  const hostPort = cut > 0 && !host.endsWith(']') ? host.slice(cut + 1) : '';
  return LOCAL_HOSTNAMES.has(name.toLowerCase()) && (hostPort === '' || hostPort === String(port));
}

/** Whether an `Origin` header is absent (not a browser) or a local page. */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).host.replace(/:\d+$/, '').toLowerCase());
  } catch {
    return false;
  }
}
