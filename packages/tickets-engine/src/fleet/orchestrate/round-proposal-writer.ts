import { nextImprovementId, parseImprovements, renderImprovements } from '../../core/improvements';
import { PERSONAS_DIR } from '../../core/persona';
import type { ClosingProposal } from '../closing-round-prompt';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import { messageOf } from './live-run';

/**
 * A closing round's proposal (R11, req-169): a prompt or model change the
 * worker suggests lands as an OPEN proposal in the persona's
 * `improvements.md` — the card the owner accepts or dismisses in the 1:1.
 * The round proposes, it never adopts. A failure is a log line.
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
      const abs = this.fs.join(vaultPath, PERSONAS_DIR, persona, 'improvements.md');
      const existing = (await this.fs.readTextOrNull(abs)) ?? '';
      const file = parseImprovements(existing);
      const id = nextImprovementId(existing);
      const proposals = [
        ...file.proposals,
        { id, state: 'open' as const, target: proposal.target, title: proposal.title, evidence: [evidence], content: proposal.content, lesson: null, at: this.clock.now().toISOString(), decidedAt: null },
      ];
      await this.fs.mkdirp(this.fs.dirname(abs));
      await this.fs.writeText(abs, renderImprovements(persona, { lastAggregation: file.lastAggregation, proposals }));
      return id;
    } catch (error) {
      this.log(`persona ${persona}: closing-round proposal failed — ${messageOf(error)}`);
      return null;
    }
  }
}
