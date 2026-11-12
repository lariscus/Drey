import { MAX_IMPROVEMENT_CONTENT, nextImprovementId, parseImprovements, renderImprovements } from '../../core/improvements';
import { PERSONAS_DIR } from '../../core/persona';
import { applyPromptEdits } from '../../core/prompt-edits';
import type { ClosingProposal } from '../closing-round-prompt';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import { messageOf } from './live-run';

/**
 * A closing round's proposal (R11, req-169): a prompt or model change the
 * worker suggests lands as an OPEN proposal in the persona's
 * `improvements.md` — the card the owner accepts or dismisses in the 1:1.
 * The round proposes, it never adopts. A prompt.md proposal's edits
 * (req-280) are applied to the persona's current prompt.md here, and the
 * proposal stores the resulting text; edits that do not apply write
 * nothing. A failure is a log line.
 */
export class RoundProposalWriter {
  constructor(
    private readonly clock: Clock,
    private readonly fs: FileSystem,
    private readonly log: (message: string) => void,
  ) {}

  /** The minted proposal id; null when nothing was written. */
  async add(vaultPath: string, persona: string, proposal: ClosingProposal, evidence: string): Promise<string | null> {
    try {
      const content = await this.contentOf(vaultPath, persona, proposal);
      if (content === null) {
        return null;
      }
      const abs = this.fs.join(vaultPath, PERSONAS_DIR, persona, 'improvements.md');
      const existing = (await this.fs.readTextOrNull(abs)) ?? '';
      const file = parseImprovements(existing);
      const id = nextImprovementId(existing);
      const proposals = [
        ...file.proposals,
        { id, state: 'open' as const, target: proposal.target, title: proposal.title, evidence: [evidence], content, lesson: null, at: this.clock.now().toISOString(), decidedAt: null },
      ];
      await this.fs.mkdirp(this.fs.dirname(abs));
      await this.fs.writeText(abs, renderImprovements(persona, { lastAggregation: file.lastAggregation, proposals }));
      return id;
    } catch (error) {
      this.log(`persona ${persona}: closing-round proposal failed — ${messageOf(error)}`);
      return null;
    }
  }

  /** The proposal's stored text: the model id, or prompt.md with the edits applied; null (logged) when the edits do not apply. */
  private async contentOf(vaultPath: string, persona: string, proposal: ClosingProposal): Promise<string | null> {
    if (proposal.target !== 'prompt.md') {
      return proposal.content;
    }
    const current = await this.fs.readTextOrNull(this.fs.join(vaultPath, PERSONAS_DIR, persona, 'prompt.md'));
    if (current === null || current.trim() === '' || proposal.edits === undefined) {
      this.log(`persona ${persona}: closing-round prompt proposal dropped — the persona has no prompt.md to edit`);
      return null;
    }
    const applied = applyPromptEdits(current, proposal.edits);
    if (!applied.ok) {
      this.log(`persona ${persona}: closing-round prompt proposal dropped — ${applied.error}`);
      return null;
    }
    if (applied.text.length > MAX_IMPROVEMENT_CONTENT) {
      this.log(`persona ${persona}: closing-round prompt proposal dropped — the edited prompt.md exceeds ${MAX_IMPROVEMENT_CONTENT} characters`);
      return null;
    }
    return applied.text;
  }
}
