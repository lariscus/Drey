/**
 * What a skill may hold (req-172): the bounds the engine checks an upload
 * against and the Persona page checks a pick against before it sends one.
 * A module of its own because the page's bundle may read it, and the
 * validator beside it (`skill-bundle.ts`) pulls in the YAML parser.
 */

export const MAX_SKILL_FILES = 200;
export const MAX_SKILL_BYTES = 8 * 1024 * 1024;
/** A `SKILL.md` is a prompt part: past this it is refused, not truncated. */
export const MAX_SKILL_TEXT_BYTES = 256 * 1024;
