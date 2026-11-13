import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { PersonaCard, PersonaCardAction } from '../../../../../shared/persona-cards';
import { McI18nPipe } from '../../i18n/i18n.pipe';
import { touchFaceSignal } from '../../phone/phone';
import { McPersonaCards } from './persona-cards-model';

/**
 * The persona board's four Needs-you cards in the chat (req-273, board
 * MCCardsV2, desktop and phone variants): no persona for a position, a run's
 * question, sent back twice, a merge conflict. They draw the one
 * `PersonaCard` model the desktop Assistant draws; the logic is in
 * `McPersonaCards`.
 */
@Component({
  selector: 'mc-persona-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe],
  templateUrl: './persona-cards.html',
  styleUrl: './persona-cards.css',
})
export class PersonaCardsView {
  protected readonly model = inject(McPersonaCards);
  protected readonly phone = touchFaceSignal();

  protected act(card: PersonaCard, action: PersonaCardAction): void {
    void this.model.act(card, action);
  }

  protected assign(card: PersonaCard, persona: string): void {
    void this.model.assign(card, persona);
  }
}
