// i18n: catalog
/**
 * The live board migration's steps 3–5 as a line at the top of the Tickets
 * panel (req-268), after the store's own migration (req-265's line): one step
 * at a time, never run on its own. `Review…` unfolds what the step writes;
 * `Migrate` runs it — steps 3 and 4 through `migrateBoard`, step 5 through
 * req-261's `personaRemove`, one commit per persona, confirmed by its title.
 */
import type { BoardMigrationOffer } from '../../../packages/tickets-engine/src/contracts/board-migration';
import type { I18n } from '../../../shared/i18n/types';

export interface BoardMigrationBarDeps {
  readonly i18n: I18n;
  readonly offer: BoardMigrationOffer;
  /** Whether the details are unfolded (kept by the panel across repaints). */
  readonly open: boolean;
  readonly toggle: (open: boolean) => void;
  readonly invoke: (method: string, payload: unknown) => Promise<unknown>;
  /** Runs the calls under the panel's busy line and error surface. */
  readonly mutate: (label: string, run: () => Promise<unknown>) => void;
}

/** The step's number in the concept's count (3, 4 or 5). */
function numberOf(offer: BoardMigrationOffer): number {
  return offer.step === 'pipeline' ? 3 : offer.step === 'crew' ? 4 : 5;
}

/** The line's text. */
export function boardMigrationText(offer: BoardMigrationOffer, i18n: I18n): string {
  const step = numberOf(offer);
  switch (offer.step) {
    case 'pipeline':
      return i18n.t('work.board_migration.pipeline', { step });
    case 'crew':
      return i18n.t('work.board_migration.crew', { step });
    case 'defaults':
      return i18n.t('work.board_migration.defaults', { step, names: offer.personas.map((p) => p.id).join(', ') });
  }
}

/** What the step writes, one line each — what the owner confirms. */
export function boardMigrationDetails(offer: BoardMigrationOffer, i18n: I18n): readonly string[] {
  if (offer.step === 'pipeline') {
    return [
      ...(offer.removed.length > 0 ? [i18n.t('work.board_migration.removes', { columns: offer.removed.join(', ') })] : []),
      ...(offer.flow !== null ? [i18n.t('work.board_migration.flow', { flow: offer.flow })] : []),
      ...(offer.moved !== null ? [i18n.t('work.board_migration.moves', { keys: offer.moved.keys.join(', '), persona: offer.moved.persona })] : []),
      ...(offer.tokenBudget !== null ? [i18n.t('work.board_migration.budget', { budget: i18n.formatNumber(offer.tokenBudget) })] : []),
      ...(offer.dropped.length > 0 ? [i18n.t('work.board_migration.dropped', { keys: offer.dropped.join(', ') })] : []),
      i18n.t('work.board_migration.one_commit'),
    ];
  }
  if (offer.step === 'crew') {
    return [
      ...(offer.order !== null ? [i18n.t('work.board_migration.order', { order: offer.order.join(', ') })] : []),
      ...offer.leaving.map((entry) => i18n.t('work.board_migration.leaving', { action: entry.action, persona: entry.persona })),
      i18n.t('work.board_migration.one_commit'),
    ];
  }
  return offer.personas.flatMap((persona) => [
    i18n.t('work.board_migration.delete', { id: persona.id, title: persona.title }),
    ...(persona.promptDiffers && offer.comparedWith !== null ? [i18n.t('work.board_migration.prompt_differs', { id: persona.id, persona: offer.comparedWith })] : []),
  ]);
}

/** Runs the offered step. */
function run(deps: BoardMigrationBarDeps): void {
  const { offer, i18n } = deps;
  if (offer.step === 'defaults') {
    deps.mutate(i18n.t('work.board_migration.busy'), async () => {
      for (const persona of offer.personas) {
        const reply = (await deps.invoke('personaRemove', { persona: persona.id, confirm: persona.title })) as { ok?: boolean; error?: string };
        if (reply.ok !== true) {
          return reply;
        }
      }
      return { ok: true };
    });
    return;
  }
  deps.mutate(i18n.t('work.board_migration.busy'), () => deps.invoke('migrateBoard', { step: offer.step }));
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

/** The line, and while unfolded the step's details with Migrate and Cancel. */
export function boardMigrationBar(deps: BoardMigrationBarDeps): HTMLElement {
  const { i18n } = deps;
  const box = document.createElement('div');
  box.className = 'tickets-warn tickets-store-migration tickets-board-migration';
  const text = document.createElement('span');
  text.className = 'tickets-warn-text';
  text.textContent = boardMigrationText(deps.offer, i18n);
  box.append(text);
  if (!deps.open) {
    const review = button(i18n.t('work.board_migration.review'), 'tickets-store-migration-btn', () => deps.toggle(true));
    review.setAttribute('aria-expanded', 'false');
    box.append(review);
    return box;
  }
  const list = document.createElement('ul');
  list.className = 'tickets-board-migration-list';
  for (const line of boardMigrationDetails(deps.offer, i18n)) {
    const item = document.createElement('li');
    item.textContent = line;
    list.append(item);
  }
  const actions = document.createElement('div');
  actions.className = 'tickets-board-migration-actions';
  actions.append(
    button(i18n.t('work.store_migration.migrate'), 'tickets-store-migration-btn tickets-board-migration-run', () => {
      deps.toggle(false);
      run(deps);
    }),
    button(i18n.t('board.cancel'), 'tickets-store-migration-btn', () => deps.toggle(false)),
  );
  box.append(list, actions);
  return box;
}
