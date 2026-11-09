/**
 * The vault MCP's HTTP face in Drey Service (req-167, ADR-0094): `POST /mcp`
 * on a loopback port of its own, the official MCP SDK's Streamable HTTP
 * transport, stateless and answering in plain JSON — the same shape as Drey's
 * own endpoint (ADR-0021). Every request carries a worker's bearer token; an
 * unknown or revoked one is a 401 before any tool runs. The loopback guard
 * (`Host` and `Origin` local) keeps a web page on this machine out.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { isLocalHost, isLocalOrigin } from '../../../../../shared/loopback-request';
import type { McpToolDef, McpToolResult } from '../../../../../shared/vault-tools';
import type { TokenSession } from './run-tokens';
import { VAULT_MCP_NAME } from './vault-call-auditor';

/** What the endpoint asks for each request. */
export interface VaultMcpHandler {
  resolve(token: string): TokenSession | null;
  list(): Promise<McpToolDef[]>;
  call(session: TokenSession, name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolResult>;
}

/** The endpoint as the component drives it. */
export interface McpEndpoint {
  /** Listens on 127.0.0.1; resolves with the port. */
  listen(): Promise<number>;
  close(): Promise<void>;
}

const bearerOf = (header: string | undefined): string => (header !== undefined && /^Bearer /i.test(header) ? header.slice(7).trim() : '');

function refuse(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message } }));
}

export class VaultMcpHttp implements McpEndpoint {
  private server: http.Server | null = null;
  private port: number | null = null;

  constructor(
    private readonly handler: VaultMcpHandler,
    private readonly version: string,
  ) {}

  listen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => void this.onRequest(req, res));
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        resolve(this.port);
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (server !== null) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!isLocalHost(req.headers.host, this.port) || !isLocalOrigin(req.headers.origin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden.');
      return;
    }
    if ((req.url ?? '/').split('?')[0] !== '/mcp' || req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('POST JSON-RPC to /mcp.');
      return;
    }
    const session = this.handler.resolve(bearerOf(req.headers.authorization));
    if (session === null) {
      refuse(res, 401, 'unknown or expired token — the vault MCP serves the workers Drey Service started');
      return;
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = this.serverFor(session);
    res.on('close', () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        refuse(res, 500, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /** One MCP server per request (stateless), bound to the caller's session. */
  private serverFor(session: TokenSession): Server {
    const server = new Server({ name: VAULT_MCP_NAME, version: this.version }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await this.handler.list() }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await this.handler.call(session, request.params.name, request.params.arguments ?? {});
      return { content: result.content, ...(result.isError === true ? { isError: true } : {}) };
    });
    return server;
  }
}
