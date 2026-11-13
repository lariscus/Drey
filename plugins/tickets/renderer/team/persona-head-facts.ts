// i18n: catalog
/**
 * The head's facts after the name and role (board 7k v4, req-295): a state
 * dot and word, ` · $2.67 today` when the cost is known, and for an agent a
 * Pause / Resume icon button — what the Crew detail's Setup pane carried.
 * Mission Control's persona has the dot and the word only. The facts follow
 * the engine's events without a repaint of the page (`sync`).
 */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { iconButton } from './persona-dom';
import { usd, type PersonaCardModel } from './team-model';

export interface HeadFacts {
  readonly element: HTMLElement;
  /** Paints the card's state; undefined (not in the crew list yet) keeps what is shown. */
  sync(card: PersonaCardModel | undefined): void;
}

/** `running · $2.67 today`; the state alone where no cost is known or the persona has none to show. */
export function factsTextOf(ctx: BlockContext, card: PersonaCardModel): string {
  const { t } = ctx;
  if (ctx.persona.kind === 'mission' || card.dailyCost === null) {
    return card.stateWord;
  }
  return t('persona.head.state', { state: card.stateWord, cost: t('status.cost.today', { cost: usd(card.dailyCost) }) });
}

export function headFacts(ctx: BlockContext, pause: (paused: boolean) => void): HeadFacts {
  const { t } = ctx;
  const mission = ctx.persona.kind === 'mission';
  const element = h('span', 'persona-facts');
  const dot = h('span', 'persona-state-dot');
  dot.setAttribute('aria-hidden', 'true');
  const text = h('span', 'persona-muted persona-facts-text');
  element.append(dot, text);
  let button: HTMLButtonElement | null = null;
  let paused = false;
  if (!mission) {
    const name = ctx.draft().title;
    button = iconButton(ctx.api, 'pause', t('persona.head.pause', { name }), () => pause(!paused));
    button.classList.add('persona-pause');
    element.append(button);
  }
  return {
    element,
    sync: (card) => {
      if (card === undefined) {
        return;
      }
      text.textContent = factsTextOf(ctx, card);
      element.dataset['state'] = card.state;
      if (button !== null) {
        paused = card.paused;
        const label = t(paused ? 'persona.head.resume' : 'persona.head.pause', { name: ctx.draft().title });
        button.title = label;
        button.setAttribute('aria-label', label);
        button.replaceChildren(ctx.api.ui.icon(paused ? 'play' : 'pause', 14));
      }
    },
  };
}
