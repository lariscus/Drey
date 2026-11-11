/**
 * The store's stage migration as a Needs-you line at the top of the Tickets panel (req-265): the
 * store still uses the old phase stages. `Migrate` runs the migration on the owner's click (never on
 * its own); a store whose config is not Drey's to write (`manual`) offers the next `[stages]` table to
 * copy into `dricket.toml`, and `Migrate` moves the tickets once that edit is in.
 */
import type { DreyPluginApi } from '../../../shared/plugin-api/renderer';
import type { StoreStageMigrationOffer } from '../shared/tickets';

export interface StoreMigrationBarModel {
  readonly text: string;
  readonly detail: string;
  /** Null when Migrate has nothing to do here (a `manual` store before the owner's edit). */
  readonly migrate: { readonly enabled: boolean; readonly title: string } | null;
  /** The `[stages]` table to copy (`manual`); null for `local`. */
  readonly copy: string | null;
}

/** What the line says and offers; pure over the snapshot's offer. */
export function storeMigrationModel(t: DreyPluginApi['i18n']['t'], offer: StoreStageMigrationOffer): StoreMigrationBarModel {
  const detail = t('work.store_migration.detail', { commits: offer.configCommits, moves: offer.moves });
  const canMigrate = offer.mode === 'local' || offer.moves > 0;
  return {
    text: t('work.store_migration', { stages: offer.legacy.join(', ') }),
    detail: offer.reason === null ? detail : `${detail}\n${offer.reason}`,
    migrate: canMigrate ? { enabled: offer.waitFor === null, title: offer.waitFor ?? detail } : null,
    copy: offer.mode === 'manual' ? offer.toml : null,
  };
}

export interface StoreMigrationBarDeps {
  readonly api: DreyPluginApi;
  readonly offer: StoreStageMigrationOffer;
  readonly migrate: () => void;
}

/** The line: text (detail in its tooltip), Copy stages for a `manual` store, Migrate. */
export function storeMigrationBar(deps: StoreMigrationBarDeps): HTMLElement {
  const t = deps.api.i18n.t;
  const model = storeMigrationModel(t, deps.offer);
  const bar = document.createElement('div');
  bar.className = 'tickets-warn tickets-store-migration';
  const text = document.createElement('span');
  text.className = 'tickets-warn-text';
  text.textContent = model.text;
  text.title = model.detail;
  bar.append(text);
  if (model.copy !== null) {
    const toml = model.copy;
    const copy = button(t('work.store_migration.copy'), t('work.store_migration.copy.title'));
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(toml).then(
        () => void deps.api.ui.showMessage(t('work.store_migration.copied'), 'Tickets'),
        () => void deps.api.ui.showMessage(toml, 'Tickets'),
      );
    });
    bar.append(copy);
  }
  if (model.migrate !== null) {
    const migrate = button(t('work.store_migration.migrate'), model.migrate.title);
    migrate.disabled = !model.migrate.enabled;
    migrate.addEventListener('click', deps.migrate);
    bar.append(migrate);
  }
  return bar;
}

function button(label: string, title: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'tickets-store-migration-btn';
  node.textContent = label;
  node.title = title;
  return node;
}
