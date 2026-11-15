/**
 * The verification report contract (E4, ADR-0088 later change): the shapes
 * the `## Verification` section carries and the proof card renders. The
 * ticket-file format — the section's writer and reader — is
 * `core/verification.ts`; the full specification is
 * `specs/ticket-schema.md`. Machine writes are strict (the exact shapes
 * below); the reader forgives — an absent or partially unreadable section
 * simply means "not verified yet", never a guess.
 */

/** The most screenshots one verify run persists — the phone's proof card
 *  shows them inline; beyond six the owner stops looking. */
export const MAX_VERIFY_SHOTS = 6;

/** One acceptance criterion's verdict. */
export interface VerificationCriterionProof {
  /** The criterion exactly as written under `### Acceptance criteria`. */
  readonly command: string;
  /** The judge's verdict; true when no judge ran and the shot exists. */
  readonly passed: boolean;
  /** The attachment file name (`verify-….png`); null = no screenshot. */
  readonly screenshot: string | null;
  /** A short human note (a failure reason, a judge remark); null = none. */
  readonly note: string | null;
}

/** The persisted verification report — `## Verification`'s in-memory twin. */
export interface VerificationReport {
  /** When the run happened, ISO-8601. */
  readonly testedAt: string;
  /** Who ran it (`verify@<host>`). */
  readonly tester: string;
  /** One line: the app build and the platform (`Electron 34.2.0 on win32`). */
  readonly environment: string;
  readonly criteria: readonly VerificationCriterionProof[];
  /** Auffälligkeiten — what the runner noticed beyond the criteria. */
  readonly findings: readonly string[];
  /** The walkthrough video's file name in `tickets/videos/` (`ui` proof); null = none. */
  readonly video?: string | null;
  /** The recording exceeded the per-video cap and was dropped (E11-1c): the honest line (`Video not kept: 31 MB exceeds the 25 MB limit.`) that stands where the player would. */
  readonly videoNotKept?: string;
  /** The video's chapters, one per shot criterion: the offset and the criterion. */
  readonly videoChapters?: readonly VideoChapter[];
}

export interface VideoChapter {
  /** Milliseconds from the video's start. */
  readonly atMs: number;
  readonly label: string;
}
