/**
 * The crew as Pia reads it on a mission turn (req-306): the `## Crew` block below the board
 * digest — every persona by id and title, the agents with what they do, and the human persona
 * named by the owner's own name. Pia answers in the owner's words ("Henrik", "me", "I"), and
 * the chain grammar speaks ids, so she needs the mapping between the two: the owner is the
 * persona `you`.
 *
 * The owner's name is the `you` persona's title (Settings → Tickets → Team, "Your name") while
 * the owner has set one, else the git user's name; a board that knows neither leaves the name out
 * and the block still maps "me" / "I" to `you`. Pure but for the one name lookup.
 */
import { HUMAN_PERSONA_ID, isAgentPersona, isHumanPersona, isMissionPersona, type Persona } from '../core/persona';

/** The default title of the human persona — no name the owner chose. */
const DEFAULT_HUMAN_TITLE = 'You';

/** The owner's name: the human persona's own title, else the git user, else null. */
export function ownerNameOf(personas: readonly Persona[], gitUser: string | null): string | null {
  const title = personas.find((persona) => isHumanPersona(persona))?.title.trim() ?? '';
  if (title !== '' && title !== DEFAULT_HUMAN_TITLE) {
    return title;
  }
  const git = gitUser?.trim() ?? '';
  return git === '' ? null : git;
}

function humanLine(persona: Persona, owner: string | null): string {
  const names = owner === null ? '"me", "I", "my"' : `"${owner}", "me", "I", "my"`;
  const who = owner === null ? 'the owner' : `the owner, ${owner}`;
  return `- ${persona.id} (${owner ?? persona.title}): ${who} — works a position by hand. ${names} in the owner's words mean "${persona.id}".`;
}

function lineOf(persona: Persona, owner: string | null): string {
  if (isHumanPersona(persona)) {
    return humanLine(persona, owner);
  }
  if (isMissionPersona(persona)) {
    return `- ${persona.id} (${persona.title}): Mission Control — you, who answer here.`;
  }
  return `- ${persona.id} (${persona.title}): ${persona.summary === '' ? persona.role : persona.summary}`;
}

/** The `## Crew` block; null when the board has no persona at all. */
export function missionCrewBlockOf(personas: readonly Persona[], gitUser: string | null): string | null {
  if (personas.length === 0) {
    return null;
  }
  const owner = ownerNameOf(personas, gitUser);
  const agents = personas.filter((persona) => isAgentPersona(persona));
  const others = personas.filter((persona) => !isAgentPersona(persona));
  const human = others.some((persona) => isHumanPersona(persona)) ? [] : [`- ${HUMAN_PERSONA_ID} (${owner ?? DEFAULT_HUMAN_TITLE}): the owner — works a position by hand.`];
  return `## Crew\n\n${[...agents, ...others].map((persona) => lineOf(persona, owner)).concat(human).join('\n')}`;
}

/** What the chat service asks of the block; {@link MissionCrewBlock} fits. */
export interface MissionCrewSource {
  text(): Promise<string | null>;
}

/** The crew read on every turn (a rename, a new persona applies on the next message) and the git user as the owner's fallback name. */
export class MissionCrewBlock implements MissionCrewSource {
  constructor(
    private readonly personas: () => Promise<readonly Persona[]>,
    private readonly gitUser: () => Promise<string | null>,
  ) {}

  async text(): Promise<string | null> {
    const personas = await this.personas().catch(() => []);
    // The git user is only asked when the persona holds no name of the owner's own.
    const named = ownerNameOf(personas, null) !== null;
    return missionCrewBlockOf(personas, named ? null : await this.gitUser().catch(() => null));
  }
}
