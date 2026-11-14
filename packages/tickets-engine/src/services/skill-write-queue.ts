/**
 * The one queue of skill writes (req-172, req-289): the Skills tab's
 * uploads and switches and the library's fetches, updates and deletions all
 * change `_meta/skills/` and commit, so they run one after another — two
 * writers never interleave their files or their commits. One instance is
 * handed to every skill service of an engine.
 */
export class SkillWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(op: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(op);
    this.tail = next;
    return next;
  }
}
