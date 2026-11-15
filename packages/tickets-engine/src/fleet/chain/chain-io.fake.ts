import { newTicketFileText } from '../../core/ticket/ticket-files';
import type { TicketDetail } from '../../ports/ticket-store';
import { detailFromContent } from '../../store/dricket-ticket-store';
import { toDricketId } from '../../store/ids';
import type { ChainStoreIo } from './store-chain-board';

/** What a seeded ticket carries beyond the defaults (repo `drey`, rank 5000, one acceptance check, unclaimed). */
export interface SeedOptions {
  /** The claim holder (`owner:`); absent = free. */
  readonly owner?: string;
  /** `repos:`; default `['drey']`, `[]` names none. */
  readonly repos?: readonly string[];
  /** `depends:` as display ids (the legacy `blocked-by:`). */
  readonly depends?: readonly string[];
  readonly rank?: number;
  /** False drops the acceptance check (a scout ticket has none). */
  readonly acceptance?: boolean;
  /** `x-persona:` — the ticket's persona pin. */
  readonly persona?: string;
  /** `x-form:` — `scout` for an exploration. */
  readonly form?: string;
  /** `x-chain:` — the delta entries (`assign plan you`, `insert manual(you) after plan`). */
  readonly chain?: readonly string[];
  /** Further `x-` keys (`{ size: 'S' }` → `x-size: S`). */
  readonly extensions?: Readonly<Record<string, string>>;
}

/** One `dk comment` the chain made. */
export interface IoComment {
  readonly id: string;
  readonly text: string;
  readonly actor: string;
}

const NOW = new Date('2026-10-18T10:00:00Z');

/** The body Drey's own ticket template writes, with one executable acceptance check (or none). */
function bodyOf(id: string, stage: string, acceptance: boolean): string {
  const legacy = newTicketFileText({ id, title: `Ticket ${id}`, repo: 'drey', priority: 'normal', rank: 5000, firstPhase: stage, now: NOW, actor: 'owner@box', description: 'It should work.' });
  const body = legacy.slice(legacy.indexOf('\n---\n', 4) + 5);
  return body.replace('Executable checks as backticked checkbox lines; the machine gate runs them.\n', acceptance ? '- [ ] `npm run verify:unit` — exits 0\n' : '');
}

function dricketOf(id: string): string {
  const mapped = toDricketId(id);
  if (mapped === null) {
    throw new Error(`"${id}" is not a display id (expected T-0001)`);
  }
  return mapped;
}

/** A dricket document of a ticket in `stage`, its body the one Drey's ticket template writes. */
export function ticketDocument(id: string, stage: string, rev: number, options: SeedOptions = {}): string {
  const owner = options.owner ?? '';
  const extensions = [
    ...(options.persona !== undefined ? [`x-persona: ${options.persona}`] : []),
    ...(options.form !== undefined ? [`x-form: ${options.form}`] : []),
    ...(options.chain !== undefined ? [`x-chain: ${options.chain.join(';')}`] : []),
    ...Object.entries(options.extensions ?? {}).map(([key, value]) => `x-${key}: ${value}`),
  ];
  return [
    '---',
    `id: ${dricketOf(id)}`,
    'created_at: 2026-10-18T10:00:00Z',
    'created_by: owner',
    'schema_version: 1',
    `title: Ticket ${id}`,
    `stage: ${stage}`,
    `owner: ${owner}`,
    'kind: agent',
    'size: M',
    `claimed_at: ${owner === '' ? '' : '2026-10-18T11:00:00Z'}`,
    `lease_until: ${owner === '' ? '' : '2026-10-19T11:00:00Z'}`,
    'epoch: 0',
    `rev: ${rev}`,
    'extensions: 0',
    'priority: normal',
    'labels: ',
    `depends: ${(options.depends ?? []).map(dricketOf).join(', ')}`,
    'parent: ',
    'touches: ',
    'branch: ',
    `repos: ${(options.repos ?? ['drey']).join(', ')}`,
    `x-rank: ${options.rank ?? 5000}`,
    ...extensions,
    '---',
    bodyOf(id, stage, options.acceptance ?? true),
  ].join('\n');
}

/**
 * The chain's store door for the specs (E14-5b, req-176): dricket documents
 * in memory, built from Drey's legacy ticket template; every comment is recorded.
 * What `dk` itself validates is `chain-store-dk.spec.ts`'s business.
 */
export class FakeChainIo implements ChainStoreIo {
  readonly docs = new Map<string, string>();
  readonly comments: IoComment[] = [];

  /** Seeds (or replaces) a ticket in `stage`. */
  seed(id: string, stage: string, options: SeedOptions = {}): void {
    this.docs.set(id, ticketDocument(id, stage, 0, options));
  }

  /** An external move (the owner on the board, another machine): the stage line changes, the rev rises. */
  move(id: string, stage: string): void {
    const text = this.docOf(id);
    const rev = (detailFromContent(text).rev ?? 0) + 1;
    this.docs.set(id, text.replace(/^stage: .*$/m, `stage: ${stage}`).replace(/^rev: .*$/m, `rev: ${rev}`));
  }

  stageOf(id: string): string {
    return detailFromContent(this.docOf(id)).stage;
  }

  /** The ticket's document as the store holds it now. */
  textOf(id: string): string {
    return this.docOf(id);
  }

  commentsOn(id: string): readonly IoComment[] {
    return this.comments.filter((c) => c.id === id);
  }

  readAll(): Promise<readonly TicketDetail[]> {
    return Promise.resolve([...this.docs.values()].map((text) => detailFromContent(text)));
  }

  show(id: string): Promise<TicketDetail> {
    const text = this.docs.get(id);
    return text === undefined ? Promise.reject(new Error(`no ${id}`)) : Promise.resolve(detailFromContent(text));
  }

  comment(id: string, text: string, options: { readonly actor: string }): Promise<void> {
    this.comments.push({ id, text, actor: options.actor });
    return Promise.resolve();
  }

  private docOf(id: string): string {
    const text = this.docs.get(id);
    if (text === undefined) {
      throw new Error(`no ${id} in the fake store`);
    }
    return text;
  }
}
