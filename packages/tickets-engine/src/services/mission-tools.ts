/**
 * The read-only tools of Pia's turns (req-315): persona files, one ticket's
 * file, and the owner's notes through the shared vault tool set (ADR-0071 —
 * the one implementation, `write: 'off'`, every registered vault in scope).
 * The chat service owns this seam; the bridge only carries it. A refusal is
 * the tool's own `Error:` text — a model that reads a wrong path corrects
 * itself, the owner is never asked.
 */
import { READ_TOOLS, VaultTools, type VaultCallOptions } from '../../../../shared/vault-tools';
import { PERSONAS_DIR } from '../core/persona/persona';
import type { ChatToolSeam, ChatToolSpec } from '../contracts/chat';
import type { EngineHost } from './host';
import { HostToolVault } from './host-tool-vault';

/** One tool result's ceiling in characters — a longer file reads as its head plus a cut line. */
const RESULT_CAP = 20_000;
/** The two tool names beside the vault reads. */
export const PERSONA_READ = 'persona_read';
export const TICKET_READ = 'ticket_read';

/** `tickets/_meta/personas/<id>/persona.md | prompt.md | memory.md` — the only paths persona_read opens. */
const PERSONA_FILE_PATTERN = new RegExp(`^${PERSONAS_DIR}/[a-z0-9][a-z0-9-]{0,63}/(persona|prompt|memory)\\.md$`);

/** The persona and ticket tools' descriptions (prompt text — `specs/classifier-spec.md` quotes them). */
const PERSONA_READ_SPEC: ChatToolSpec = {
  name: PERSONA_READ,
  description:
    'Read one file of one persona in the tickets repository: "persona.md" (the record — title, role, class, budget and the rest), ' +
    '"prompt.md" (the persona\'s instructions) or "memory.md". `path` is "tickets/_meta/personas/<id>/<file>". ' +
    'Read a persona\'s prompt.md before you propose a patchPersona with a "prompt", and when the owner asks what a persona\'s instructions say.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The file, tickets-repository-relative, e.g. "tickets/_meta/personas/ben/prompt.md".' } },
    required: ['path'],
  },
};

const TICKET_READ_SPEC: ChatToolSpec = {
  name: TICKET_READ,
  description:
    'Read one ticket\'s whole file, wherever it sits — open, done or archived (the digest lists open tickets only). ' +
    'The file carries the description, the plan, the chain and the log. `id` is the ticket id, e.g. "T-0042".',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'The ticket id, e.g. "T-0042".' } },
    required: ['id'],
  },
};

/** The vault reads: the shared set's own descriptions, read-only, every registered vault in scope. */
const PIA_VAULT_OPTIONS: VaultCallOptions = { write: 'off', exclude: ['tasks_list'], protectAppFolders: true };

/** What the tools need: the host (the vaults and their files) and the tickets vault's id. */
export interface MissionToolsDeps {
  readonly host: Pick<EngineHost, 'listVaults' | 'read' | 'listMarkdownFiles'>;
  /** The tickets repository's vault id, read fresh per call (the snapshot's); null = no board, persona and ticket reads refuse. */
  readonly vaultId: () => Promise<string | null>;
  /** One ticket's file wherever it sits (the board port's `readAnyTicket`); absent = ticket_read refuses. */
  readonly readTicket?: (id: string) => Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string }>;
}

export class MissionTools implements ChatToolSeam {
  private readonly vault: HostToolVault;
  private readonly tools: VaultTools;

  constructor(private readonly deps: MissionToolsDeps) {
    this.vault = new HostToolVault(deps.host);
    this.tools = new VaultTools({
      vault: this.vault,
      getSearchProvider: () => null,
      getTaskProvider: () => null,
      getConfig: () => ({ mcp: { yolo: false } }),
      confirmWrite: () => Promise.resolve(false),
      approve: () => Promise.resolve(false),
      rename: () => Promise.reject(new Error('Pia does not move notes')),
      announce: () => undefined,
      announceRefresh: () => undefined,
    });
  }

  get specs(): readonly ChatToolSpec[] {
    return [PERSONA_READ_SPEC, TICKET_READ_SPEC, ...READ_TOOLS.map((def) => ({ name: def.name, description: def.description, parameters: def.inputSchema }))];
  }

  async call(name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
    if (name === PERSONA_READ) {
      return this.personaRead(args);
    }
    if (name === TICKET_READ) {
      return this.ticketRead(args);
    }
    // The registry is read per call: a vault registered mid-turn joins on the next one.
    await this.vault.refresh();
    const result = await this.tools.call(name, { ...args }, PIA_VAULT_OPTIONS);
    return cap(result.content.map((block) => block.text).join('\n'));
  }

  private async personaRead(args: Readonly<Record<string, unknown>>): Promise<string> {
    const path = typeof args['path'] === 'string' ? args['path'].trim() : '';
    if (!PERSONA_FILE_PATTERN.test(path)) {
      return `Error: persona_read reads a persona's persona.md, prompt.md or memory.md — a path like "${PERSONAS_DIR}/<id>/prompt.md".`;
    }
    const vault = await this.deps.vaultId();
    if (vault === null) {
      return 'Error: no tickets repository is set up.';
    }
    try {
      return cap(await this.deps.host.read(vault, path));
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async ticketRead(args: Readonly<Record<string, unknown>>): Promise<string> {
    const id = typeof args['id'] === 'string' ? args['id'].trim().toUpperCase() : '';
    if (!/^T-\d{4,}$/.test(id) || this.deps.readTicket === undefined) {
      return 'Error: ticket_read needs a ticket id like "T-0042".';
    }
    const reply = await this.deps.readTicket(id).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
    return reply.ok ? cap(reply.text) : `Error: ${reply.error}`;
  }
}

/** The result text, its head when it runs past the cap. */
function cap(text: string): string {
  return text.length <= RESULT_CAP ? text : `${text.slice(0, RESULT_CAP)}\n… (cut)`;
}
