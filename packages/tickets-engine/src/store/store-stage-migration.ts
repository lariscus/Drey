import type { StoreStageMigrationOffer, StoreStageMigrationResult } from '../contracts/tickets';
import { PHASE_PIN_KEY } from '../core/lifecycle-stages';
import type { PutOptions, TicketDetail } from '../ports/ticket-store';
import { setDocumentField } from './document-fields';
import { MOVE_TARGET_STAGE, planStageMigration, type StageMigrationPlan, type StageMove } from './stage-migration-plan';
import { parseStoreStages, renderStageTable, withStageTable, type StoreStageSet } from './store-stages';

/** What the migration reads and writes of the store (production: {@link StoreBoardSource} and a {@link StoreConfigWriter}). */
export interface StageMigrationStore {
  /** `dricket.toml` and the ref it was read from; null when no ref holds one. */
  configText(): Promise<{ readonly ref: string; readonly text: string } | null>;
  records(): Promise<readonly TicketDetail[]>;
  show(id: string): Promise<TicketDetail>;
  /** `dk put --claim --if-version`; `ok: false` = the ticket changed meanwhile (exit 12). */
  write(id: string, text: string, options: PutOptions): Promise<{ readonly ok: boolean }>;
}

export interface StageConfigCommitter {
  refusal(): Promise<string | null>;
  commit(text: string, message: string): Promise<string>;
}

/** The ref a local store's config sits on; any other (dk's private ref, `origin/main`) is a remote store's. */
const LOCAL_CONFIG_REF = 'main';

const STEP_ONE_MESSAGE = 'dricket: add the lifecycle stages active and running, claim = ["running"] (Drey stage migration, step 1 of 2)';
const STEP_TWO_MESSAGE = 'dricket: remove the old phase stages (Drey stage migration, step 2 of 2)';

interface Situation {
  readonly ref: string;
  readonly text: string;
  readonly stages: StoreStageSet | null;
  readonly plan: StageMigrationPlan;
}

/**
 * The store's move to the lifecycle stages (req-265, concept §12 steps 1–2). {@link offer} is what the
 * board shows; {@link run} is what the owner's Migrate click does. Every run re-plans from the store as
 * it is, so the migration is idempotent and resumes where an interrupted one stopped.
 */
export class StoreStageMigration {
  constructor(
    private readonly store: StageMigrationStore,
    private readonly config: StageConfigCommitter,
    private readonly actor: string,
    private readonly log: (message: string) => void,
  ) {}

  /** What the board offers; null when the store needs nothing (or is not one the migration is for). */
  async offer(): Promise<StoreStageMigrationOffer | null> {
    const now = await this.situation();
    if (now === null || now.plan.kind === 'none') {
      return null;
    }
    const plan = now.plan;
    const reason = await this.configRefusal(now, plan);
    // The next config to paste by hand: the bridge set while the old stages still hold tickets, then the end set.
    const target = plan.add ?? plan.remove;
    return {
      mode: reason === null ? 'local' : 'manual',
      legacy: plan.legacy,
      moves: plan.moves.length,
      configCommits: (plan.add === null ? 0 : 1) + (plan.remove === null ? 0 : 1),
      toml: target === null ? '' : renderStageTable(target),
      reason,
      waitFor: plan.claimed.length === 0 ? null : `${plan.claimed[0]!.id} is claimed by ${plan.claimed[0]!.owner}`,
    };
  }

  /** The migration: step 1 (config), the moves, step 3 (config) — each only when still needed. */
  async run(): Promise<StoreStageMigrationResult> {
    const before = await this.situation();
    if (before === null || before.plan.kind === 'none') {
      return { ok: true, configCommits: 0, moved: [] };
    }
    const plan = before.plan;
    if (plan.claimed.length > 0) {
      const first = plan.claimed[0]!;
      return { ok: false, error: `${first.id} is claimed by ${first.owner} - the migration waits until no ticket is claimed` };
    }
    let commits = 0;
    if (plan.add !== null) {
      const refusal = await this.configRefusal(before, plan);
      if (refusal !== null) {
        return { ok: false, error: `dricket.toml is not Drey's to write here: ${refusal}` };
      }
      await this.config.commit(withStageTable(before.text, plan.add), STEP_ONE_MESSAGE);
      commits += 1;
      this.log('stage migration: step 1 committed (active and running added)');
    }
    const moved: string[] = [];
    for (const move of plan.moves) {
      const error = await this.move(move);
      if (error !== null) {
        return { ok: false, error, moved };
      }
      moved.push(move.id);
    }
    return this.finish(commits, moved);
  }

  /** Step 3: drop the old stages once no ticket stands in one (re-planned: a ticket may have arrived meanwhile). */
  private async finish(commits: number, moved: readonly string[]): Promise<StoreStageMigrationResult> {
    const now = await this.situation();
    if (now === null || now.plan.kind === 'none' || now.plan.remove === null) {
      return { ok: true, configCommits: commits, moved };
    }
    if (now.plan.moves.length > 0) {
      return { ok: false, error: `${now.plan.moves[0]!.id} still stands in ${now.plan.moves[0]!.from} - run Migrate again`, moved };
    }
    const refusal = await this.configRefusal(now, now.plan);
    if (refusal !== null) {
      return { ok: false, error: `dricket.toml is not Drey's to write here: ${refusal}`, moved };
    }
    await this.config.commit(withStageTable(now.text, now.plan.remove), STEP_TWO_MESSAGE);
    this.log(`stage migration: step 2 committed (${now.plan.legacy.join(', ')} removed)`);
    return { ok: true, configCommits: commits + 1, moved };
  }

  /** One ticket to `active` with its column pinned; null when written, else why not. */
  private async move(move: StageMove): Promise<string | null> {
    const record = await this.store.show(move.id);
    if (record.rev === null) {
      return `${move.id} has no rev: the store did not report one`;
    }
    const staged = setDocumentField(record.text, 'stage', MOVE_TARGET_STAGE);
    const text = staged === null ? null : setDocumentField(staged, PHASE_PIN_KEY, move.pin);
    if (text === null) {
      return `${move.id} is not a ticket document`;
    }
    const outcome = await this.store.write(move.id, text, { expectedRev: record.rev, actor: this.actor });
    if (!outcome.ok) {
      return `${move.id} changed meanwhile - run Migrate again`;
    }
    this.log(`stage migration: ${move.id} ${move.from} -> ${MOVE_TARGET_STAGE} (pinned to ${move.pin})`);
    return null;
  }

  private async situation(): Promise<Situation | null> {
    const config = await this.store.configText();
    if (config === null) {
      return null;
    }
    const stages = parseStoreStages(config.text);
    const records = await this.store.records();
    return { ref: config.ref, text: config.text, stages, plan: planStageMigration(stages, records) };
  }

  /** Null when the config commits this plan needs can be made here. */
  private async configRefusal(now: Situation, plan: Extract<StageMigrationPlan, { kind: 'needed' }>): Promise<string | null> {
    if (plan.add === null && plan.remove === null) {
      return null;
    }
    if (now.ref !== LOCAL_CONFIG_REF) {
      return `the store's config is read from ${now.ref}: a remote store's dricket.toml is edited there`;
    }
    return this.config.refusal();
  }
}
