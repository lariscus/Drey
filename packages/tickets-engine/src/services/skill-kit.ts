import type { TicketsGit } from '../core/tickets-git';
import type { EngineHost } from './host';
import { PromptPreview } from './prompt-preview';
import { SkillCommitter } from './skill-committer';
import type { SkillFileSystem } from './skill-file-system';
import { SkillFolderReader } from './skill-folder-reader';
import { SkillLister } from './skill-lister';
import { SkillMigrator } from './skill-migrator';
import { SkillUploader } from './skill-uploader';

/** The skill classes wired over one vault's disk (req-172); the composition of `SkillService`, one per vault per call. */
export interface SkillKit {
  readonly fs: SkillFileSystem;
  readonly reader: SkillFolderReader;
  readonly lister: SkillLister;
  readonly uploader: SkillUploader;
  readonly committer: SkillCommitter;
  readonly migrator: SkillMigrator;
  readonly preview: PromptPreview;
}

export type SkillKitHost = Pick<EngineHost, 'announceChanges' | 'log'>;
export type SkillKitGit = Pick<TicketsGit, 'locate' | 'commitTree'>;

export function buildSkillKit(fs: SkillFileSystem, host: SkillKitHost, git: SkillKitGit): SkillKit {
  const reader = new SkillFolderReader(fs);
  const committer = new SkillCommitter(host, git);
  return {
    fs,
    reader,
    lister: new SkillLister(reader, fs),
    uploader: new SkillUploader(fs),
    committer,
    migrator: new SkillMigrator(fs, committer, host),
    preview: new PromptPreview(fs),
  };
}
