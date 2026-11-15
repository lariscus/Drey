import { PERSONAS_DIR } from '../../core/persona/persona';
import { withRoundProposal } from '../../core/pipeline/round-proposal';
import type { ClosingProposal } from './closing-round-prompt';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import { messageOf } from './live-run';

/**
 * A closing round's proposal (R11, req-169): a prompt or model change the
 * worker suggests lands as an OPEN proposal in the persona's
 * `improvements.md` — the card the owner accepts or dismisses in the 1:1.
 * The round proposes, it never adopts. A prompt.md proposal's edits
 * (req-280) are applied to the persona's current prompt.md
 * (`withRoundProposal`); edits that do not apply write nothing. The
 * standalone runner's plain write — in Drey Service the engine writes and
 * commits it (req-225). A failure is a log line.
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
      const folder = this.fs.join(vaultPath, PERSONAS_DIR, persona);
      const abs = this.fs.join(folder, 'improvements.md');
      const prompt = proposal.target === 'prompt.md' ? await this.fs.readTextOrNull(this.fs.join(folder, 'prompt.md')) : null;
      const written = withRoundProposal(await this.fs.readTextOrNull(abs), prompt, { persona, ...proposal, evidence, at: this.clock.now().toISOString() });
      if (!written.ok) {
        this.log(`persona ${persona}: closing-round proposal dropped — ${written.error}`);
        return null;
      }
      await this.fs.mkdirp(folder);
      await this.fs.writeText(abs, written.text);
      return written.id;
    } catch (error) {
      this.log(`persona ${persona}: closing-round proposal failed — ${messageOf(error)}`);
      return null;
    }
  }
}
