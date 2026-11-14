import { MAX_SKILL_BYTES } from '../core/skill-limits';
import type { GithubClient } from './github-client';
import { HttpGithubClient } from './http-github-client';
import { SkillLibraryService, type SkillLibraryDeps } from './skill-library-service';
import { SkillService, type SkillsBoard } from './skill-service';
import { SkillSourceFetcher } from './skill-source-fetcher';
import { SkillUpdateChecks } from './skill-update-checks';
import { SkillWriteQueue } from './skill-write-queue';

export interface SkillsComposition {
  readonly skills: SkillService;
  readonly library: SkillLibraryService;
}

export interface ComposeSkillsDeps {
  readonly board: SkillsBoard;
  readonly host: SkillLibraryDeps['host'];
  readonly git: SkillLibraryDeps['git'];
  /** The GitHub seam; absent = the public API over `fetch`. */
  readonly github?: GithubClient;
  /** `DREY_GITHUB_API_URL` / `DREY_GITHUB_RAW_URL` point the default client elsewhere (an e2e's local fake). */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * The skills of an engine (req-172, req-289): the Skills tab's service and
 * the library's, over one queue of skill writes and one memory of the look
 * for newer refs — so the Persona page's listing says *update available*
 * after the library looked.
 */
export function composeSkills(deps: ComposeSkillsDeps): SkillsComposition {
  const github =
    deps.github ??
    new HttpGithubClient({
      apiBase: deps.env['DREY_GITHUB_API_URL'] ?? 'https://api.github.com',
      rawBase: deps.env['DREY_GITHUB_RAW_URL'] ?? 'https://raw.githubusercontent.com',
      maxFileBytes: MAX_SKILL_BYTES,
    });
  const queue = new SkillWriteQueue();
  const checks = new SkillUpdateChecks(github);
  const { board, host, git } = deps;
  return {
    skills: new SkillService({ board, host, git, queue, checks }),
    library: new SkillLibraryService({ board, host, git, queue, checks, fetcher: new SkillSourceFetcher(github) }),
  };
}
