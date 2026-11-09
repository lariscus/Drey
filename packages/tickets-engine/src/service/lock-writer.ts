/** Writes `service.lock` (req-164) only when its content changed. */
import { writeServiceLock, type ServiceLock } from './service-lock';

export class LockWriter {
  private last = '';

  constructor(
    private readonly home: string,
    private readonly onError: (message: string) => void,
  ) {}

  async write(lock: ServiceLock): Promise<void> {
    const json = JSON.stringify(lock);
    if (json === this.last) {
      return;
    }
    this.last = json;
    await writeServiceLock(this.home, lock).catch((error: unknown) => this.onError(`writing service.lock failed: ${String(error)}`));
  }
}
