/**
 * The crew's chat prompts (req-279): real files in
 * `packages/tickets-engine/prompts/crew/`, shipped beside the compiled
 * engine like the pipeline step prompts — one obvious place to edit
 * every prompt text the crew's chats speak. The loader drops exactly
 * the one trailing newline the files carry, so the texts the bridge
 * sends are byte-identical to the code constants they replaced (the
 * prompt cache prefix and the brief digests depend on stable bytes).
 * A missing or empty file throws at composition, naming the file: an
 * installation without them is broken, not a degraded mode.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { SHIPPED_PROMPTS_DIR } from '../core/default-prompts';

/** The four chat prompts: Mission Control's turns, shape, flow and the improvement aggregator. */
export interface CrewPrompts {
  readonly mission: string;
  readonly shape: string;
  readonly flow: string;
  readonly aggregator: string;
}

const CREW_FILES: readonly (keyof CrewPrompts)[] = ['mission', 'shape', 'flow', 'aggregator'];

/** Reads one crew prompt file: CRLF folded, the one trailing newline dropped. */
async function readCrewPrompt(dir: string, name: keyof CrewPrompts): Promise<string> {
  const rel = path.join('crew', `${name}.md`);
  const text = await fsp.readFile(path.join(dir, rel), 'utf8').catch(() => null);
  if (text === null) {
    throw new Error(`the crew prompt ${rel} is missing from ${dir}`);
  }
  const stripped = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (stripped === '') {
    throw new Error(`the crew prompt ${rel} in ${dir} is empty`);
  }
  return stripped;
}

/** Every crew prompt, from the shipped prompts dir by default. */
export async function loadCrewPrompts(dir: string = SHIPPED_PROMPTS_DIR): Promise<CrewPrompts> {
  const prompts: Record<keyof CrewPrompts, string> = { mission: '', shape: '', flow: '', aggregator: '' };
  for (const name of CREW_FILES) {
    prompts[name] = await readCrewPrompt(dir, name);
  }
  return prompts;
}
